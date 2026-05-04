/**
 * POST /api/upload/finalise
 *
 * Records an uploaded file's metadata in Cosmos DB after the browser has
 * successfully PUT it to Azure Blob Storage via a Valet Key SAS token.
 *
 * Document model — one document per file:
 *   {
 *     id:         <uuid>,             // Cosmos document id
 *     roomId:     "ABC123",            // partition key
 *     name:       "photo.jpg",         // original filename
 *     blobUrl:    "https://<acct>.blob.core.windows.net/bridgedrop-media/ABC123/<uuid>-photo.jpg",
 *     sizeBytes:  1048576,
 *     mimeType:   "image/jpeg",
 *     uploadedAt: "2026-05-04T12:34:56.789Z"
 *   }
 *
 * Why one-doc-per-file (not one-doc-per-room with a files[] array):
 *   - Inserts are atomic. Concurrent uploads in the same room can't lose
 *     each other through read-modify-write races.
 *   - Each file gets its own TTL if needed.
 *   - Queries by roomId are still single-partition (efficient).
 *
 * Required environment variables:
 *   AZURE_COSMOS_ENDPOINT  e.g. https://bridgedrop-prod-cosmos.documents.azure.com:443/
 *   AZURE_COSMOS_KEY       Primary master key from the Azure Portal
 */

import { NextRequest, NextResponse } from 'next/server';
import { CosmosClient, type Container } from '@azure/cosmos';

// @azure/cosmos uses Node crypto — not Edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Configuration — module-level singletons for connection pooling.
// ---------------------------------------------------------------------------

const DATABASE_ID = 'bridgedrop-db';
const CONTAINER_ID = 'room-metadata';
const STORAGE_CONTAINER_NAME = 'bridgedrop-media';
const ROOM_ID_PATTERN = /^[A-Za-z0-9]{6}$/;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

const cosmosEndpoint = process.env.AZURE_COSMOS_ENDPOINT;
const cosmosKey = process.env.AZURE_COSMOS_KEY;

if (!cosmosEndpoint || !cosmosKey) {
  // Fail fast on cold start so misconfiguration shows up in boot logs.
  throw new Error(
    'AZURE_COSMOS_ENDPOINT and AZURE_COSMOS_KEY must be set in the environment.',
  );
}

const cosmosClient = new CosmosClient({
  endpoint: cosmosEndpoint,
  key: cosmosKey,
});
const container: Container = cosmosClient
  .database(DATABASE_ID)
  .container(CONTAINER_ID);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FinaliseRequestBody {
  roomId: string;
  fileName: string;
  blobUrl: string;
  sizeBytes: number;
  mimeType: string;
}

/** Shape persisted in Cosmos — exported so the read endpoint can share it. */
export interface FileDocument {
  id: string;
  roomId: string;
  name: string;
  blobUrl: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: string;
}

interface ErrorResponse {
  error: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates that `blobUrl` actually points at our storage container under the
 * caller's roomId prefix. Without this, anyone could finalise an arbitrary
 * URL and pollute another room's metadata.
 */
function isValidBlobUrl(rawUrl: string, roomId: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (!url.hostname.endsWith('.blob.core.windows.net')) return false;

  // Path must be /<container>/<ROOMID>/<rest>
  const expectedPrefix = `/${STORAGE_CONTAINER_NAME}/${roomId.toUpperCase()}/`;
  if (!url.pathname.startsWith(expectedPrefix)) return false;

  // Reject any query string — clean URLs only (no SAS tokens persisted).
  if (url.search.length > 0) return false;

  return true;
}

function validateBody(
  body: Partial<FinaliseRequestBody>,
): { ok: true; data: FinaliseRequestBody } | { ok: false; error: string } {
  const { roomId, fileName, blobUrl, sizeBytes, mimeType } = body;

  if (typeof roomId !== 'string' || !ROOM_ID_PATTERN.test(roomId)) {
    return { ok: false, error: 'roomId must be a 6-character alphanumeric string.' };
  }
  if (typeof fileName !== 'string' || fileName.trim().length === 0) {
    return { ok: false, error: 'fileName is required and must be a non-empty string.' };
  }
  if (typeof blobUrl !== 'string' || !isValidBlobUrl(blobUrl, roomId)) {
    return {
      ok: false,
      error: 'blobUrl must be an HTTPS URL pointing at the expected storage container and room prefix.',
    };
  }
  if (
    typeof sizeBytes !== 'number' ||
    !Number.isFinite(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > MAX_FILE_SIZE_BYTES
  ) {
    return {
      ok: false,
      error: `sizeBytes must be a positive number not exceeding ${MAX_FILE_SIZE_BYTES} bytes.`,
    };
  }
  if (typeof mimeType !== 'string' || mimeType.trim().length === 0) {
    return { ok: false, error: 'mimeType is required and must be a non-empty string.' };
  }

  return {
    ok: true,
    data: {
      roomId: roomId.toUpperCase(),
      fileName: fileName.trim(),
      blobUrl,
      sizeBytes,
      mimeType: mimeType.trim(),
    },
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
): Promise<NextResponse<FileDocument | ErrorResponse>> {
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

  // --- 2. Validate --------------------------------------------------------
  const validation = validateBody(rawBody as Partial<FinaliseRequestBody>);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const { roomId, fileName, blobUrl, sizeBytes, mimeType } = validation.data;

  // --- 3. Build document --------------------------------------------------
  const doc: FileDocument = {
    id: crypto.randomUUID(),
    roomId,
    name: fileName,
    blobUrl,
    sizeBytes,
    mimeType,
    uploadedAt: new Date().toISOString(),
  };

  // --- 4. Insert into Cosmos ---------------------------------------------
  try {
    const { resource, statusCode } = await container.items.create<FileDocument>(doc);

    if (!resource) {
      // Cosmos succeeded but returned no body — treat as a server error.
      console.error('[finalise] Cosmos returned no resource; statusCode=', statusCode);
      return NextResponse.json(
        { error: 'Failed to persist file metadata.' },
        { status: 500 },
      );
    }

    // Strip Cosmos system fields (_rid, _self, _etag, _attachments, _ts)
    // so the response matches the FileDocument contract exactly.
    const cleaned: FileDocument = {
      id: resource.id,
      roomId: resource.roomId,
      name: resource.name,
      blobUrl: resource.blobUrl,
      sizeBytes: resource.sizeBytes,
      mimeType: resource.mimeType,
      uploadedAt: resource.uploadedAt,
    };

    return NextResponse.json(cleaned, { status: 200 });
  } catch (err) {
    // Cosmos errors carry a numeric `code`. 409 = duplicate id (extremely
    // unlikely with UUIDv4 but possible). Other codes = internal failure.
    const code = (err as { code?: number }).code;
    console.error('[finalise] Cosmos write failed:', {
      roomId,
      docId: doc.id,
      code,
      message: err instanceof Error ? err.message : String(err),
    });

    if (code === 409) {
      return NextResponse.json(
        { error: 'A document with this id already exists. Please retry.' },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to persist file metadata.' },
      { status: 500 },
    );
  }
}