import { NextRequest, NextResponse } from 'next/server';
import {
  BlobServiceClient,
  BlobSASPermissions,
  SASProtocol,
  type BlockBlobClient,
} from '@azure/storage-blob';

// The @azure/storage-blob SDK is not Edge-compatible — force Node.js runtime.
export const runtime = 'nodejs';
// SAS generation must run per-request; never cache this handler's response.
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Configuration — module-level singletons.
// BlobServiceClient is thread-safe and intended to be reused across requests.
// ---------------------------------------------------------------------------

const CONTAINER_NAME = 'bridgedrop-media';
const SAS_TTL_MS = 60 * 60 * 1000; 
const CLOCK_SKEW_MS = 60 * 1000; 
const MAX_FILENAME_LENGTH = 200;
const ROOM_ID_PATTERN = /^[A-Za-z0-9]{6}$/;

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

if (!connectionString) {
  throw new Error(
    'AZURE_STORAGE_CONNECTION_STRING is not set. Configure it in your environment or App Service application settings.',
  );
}

const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SasRequestBody {
  roomId: string;
  fileName: string;
  mimeType: string;
}

interface SasSuccessResponse {
  /** Full URL the browser PUTs to. The SAS token is appended as a query string. */
  sasUrl: string;
  /** Clean, signature-free URL to persist in Cosmos DB and use for downloads. */
  blobUrl: string;
  /** Blob path relative to the container (e.g. "ABC123/uuid-photo.jpg"). */
  blobName: string;
  /** ISO 8601 expiry — useful for client-side countdowns / retry prompts. */
  expiresAt: string;
}

interface ErrorResponse {
  error: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitiseFileName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[/\\\x00-\x1f]/g, '').trim();
  return stripped.slice(0, MAX_FILENAME_LENGTH) || 'file';
}

/**
 * Validates the parsed request body. Returns the typed body on success or
 * an error message on failure.
 */
function validateBody(
  body: Partial<SasRequestBody>,
): { ok: true; data: SasRequestBody } | { ok: false; error: string } {
  const { roomId, fileName, mimeType } = body;

  if (typeof roomId !== 'string' || !ROOM_ID_PATTERN.test(roomId)) {
    return { ok: false, error: 'roomId must be a 6-character alphanumeric string.' };
  }
  if (typeof fileName !== 'string' || fileName.trim().length === 0) {
    return { ok: false, error: 'fileName is required and must be a non-empty string.' };
  }
  if (typeof mimeType !== 'string' || mimeType.trim().length === 0) {
    return { ok: false, error: 'mimeType is required and must be a non-empty string.' };
  }
  return { ok: true, data: { roomId, fileName, mimeType } };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
): Promise<NextResponse<SasSuccessResponse | ErrorResponse>> {
  // --- 1. Parse JSON ------------------------------------------------------
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }

  // --- 2. Validate shape --------------------------------------------------
  const validation = validateBody(rawBody as Partial<SasRequestBody>);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const { roomId, fileName, mimeType } = validation.data;

  // --- 3. Build collision-resistant blob name -----------------------------
  const safeFileName = sanitiseFileName(fileName);
  const blobName = `${roomId.toUpperCase()}/${crypto.randomUUID()}-${safeFileName}`;

  // --- 4. Generate SAS ----------------------------------------------------
  const startsOn = new Date(Date.now() - CLOCK_SKEW_MS);
  const expiresOn = new Date(Date.now() + SAS_TTL_MS);

  try {
    const blockBlobClient: BlockBlobClient = containerClient.getBlockBlobClient(blobName);
    const sasUrl = await blockBlobClient.generateSasUrl({
      permissions: BlobSASPermissions.parse('cw'),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
      contentType: mimeType,
    });
    const blobUrl = blockBlobClient.url;

    const responseBody: SasSuccessResponse = {
      sasUrl,
      blobUrl,
      blobName,
      expiresAt: expiresOn.toISOString(),
    };

    return NextResponse.json(responseBody, { status: 201 });
  } catch (err) {
    console.error('[generate-sas] Failed to generate SAS token:', {
      roomId,
      blobName,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Failed to generate upload token.' },
      { status: 500 },
    );
  }
}