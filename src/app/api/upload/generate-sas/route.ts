/**
 * POST /api/upload/generate-sas
 *
 * Implements the Valet Key Pattern for BridgeDrop's direct-to-Blob uploads.
 *
 * Flow:
 *   1. Frontend sends file metadata (roomId, fileName, mimeType).
 *   2. This handler mints a short-lived, write-only Service SAS URL scoped
 *      to a single blob path inside the `bridgedrop-media` container.
 *   3. Frontend PUTs the file directly to Azure Blob Storage using `sasUrl`
 *      — bytes never touch this Next.js server.
 *   4. Frontend later calls /api/upload/finalise with `blobUrl` to register
 *      the upload in Cosmos DB room metadata.
 *
 * Security properties of the generated SAS:
 *   - Blob-scoped, not container-scoped (one token per file).
 *   - Permissions: cw (Create + Write only) — no read, delete, or list.
 *   - HTTPS-only.
 *   - Content-Type pinned to the declared mimeType.
 *   - 1-hour expiry with a small clock-skew buffer on the start time.
 *   - Blob name carries a UUID, so URLs are unguessable.
 *   - File name sanitised to block path-traversal attempts.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  BlobSASPermissions,
  SASProtocol,
  type BlockBlobClient,
} from '@azure/storage-blob';
import { getStorageContainerClient } from '@/lib/azure';

// The @azure/storage-blob SDK is not Edge-compatible — force Node.js runtime.
export const runtime = 'nodejs';
// SAS generation must run per-request; never cache this handler's response.
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SAS_TTL_MS = 60 * 60 * 1000;      // 1 hour
const CLOCK_SKEW_MS = 60 * 1000;        // 1-minute backdate on startsOn
const MAX_FILENAME_LENGTH = 200;
const ROOM_ID_PATTERN = /^[A-Za-z0-9]{6}$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SasRequestBody {
  roomId: string;
  fileName: string;
  mimeType: string;
}

interface SasSuccessResponse {
  sasUrl: string;
  blobUrl: string;
  blobName: string;
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
    // Lazy client init — env access happens here, not at module load.
    const containerClient = getStorageContainerClient();
    const blockBlobClient: BlockBlobClient = containerClient.getBlockBlobClient(blobName);

    // 'cw' = Create + Write. Azure requires BOTH for a fresh-blob PUT;
    // 'w' alone fails on first upload with AuthorizationPermissionMismatch.
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
    console.error('[generate-sas] Failed:', {
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