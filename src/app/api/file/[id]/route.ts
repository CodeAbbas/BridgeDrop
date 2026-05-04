/**
 * /api/file/[id]
 *
 * Completes the CRUD surface for BridgeDrop's file documents:
 *   - PATCH  → rename a file (updates the `name` field in Cosmos).
 *   - DELETE → remove a file (deletes the blob from Storage, then the doc from Cosmos).
 *
 * Both handlers require:
 *   - Path param  [id]      — the Cosmos document id (UUID).
 *   - Query param ?roomId=  — the partition key (6-char alphanumeric room code).
 *
 * The (id, roomId) pair is the effective auth model. The id is an unguessable
 * v4 UUID and the roomId is the shared room code. Knowing one without the
 * other yields nothing.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getCosmosContainer,
  getStorageContainerClient,
  STORAGE_CONTAINER_NAME,
} from '@/lib/azure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOM_ID_PATTERN = /^[A-Za-z0-9]{6}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILENAME_LENGTH = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileDocument {
  id: string;
  roomId: string;
  name: string;
  blobUrl: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: string;
}

interface PatchRequestBody {
  name: string;
}

interface DeleteSuccess {
  id: string;
  deleted: true;
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
  return stripped.slice(0, MAX_FILENAME_LENGTH);
}

function extractBlobName(blobUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(blobUrl);
  } catch {
    return null;
  }
  const expectedPrefix = `/${STORAGE_CONTAINER_NAME}/`;
  if (!url.pathname.startsWith(expectedPrefix)) return null;

  const encodedPath = url.pathname.slice(expectedPrefix.length);
  if (encodedPath.length === 0) return null;

  return encodedPath
    .split('/')
    .map((seg) => decodeURIComponent(seg))
    .join('/');
}

function validateIdentity(
  rawId: string,
  rawRoomId: string | null,
):
  | { ok: true; id: string; roomId: string }
  | { ok: false; status: number; error: string } {
  if (typeof rawId !== 'string' || !UUID_PATTERN.test(rawId)) {
    return { ok: false, status: 400, error: 'Invalid file id (must be a UUID).' };
  }
  if (typeof rawRoomId !== 'string' || !ROOM_ID_PATTERN.test(rawRoomId)) {
    return {
      ok: false,
      status: 400,
      error: 'roomId query parameter is required and must be 6 alphanumeric characters.',
    };
  }
  return { ok: true, id: rawId, roomId: rawRoomId.toUpperCase() };
}

// ---------------------------------------------------------------------------
// PATCH — rename a file
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<FileDocument | ErrorResponse>> {
  // --- 1. Validate identity ----------------------------------------------
  const { id: rawId } = await params;
  const validation = validateIdentity(rawId, req.nextUrl.searchParams.get('roomId'));
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }
  const { id, roomId } = validation;

  // --- 2. Parse and validate body ----------------------------------------
  let body: Partial<PatchRequestBody>;
  try {
    body = (await req.json()) as Partial<PatchRequestBody>;
  } catch {
    return NextResponse.json(
      { error: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json(
      { error: 'name is required and must be a non-empty string.' },
      { status: 400 },
    );
  }
  const sanitisedName = sanitiseFileName(body.name);
  if (sanitisedName.length === 0) {
    return NextResponse.json(
      { error: 'name became empty after sanitisation.' },
      { status: 400 },
    );
  }

  // --- 3. Atomic partial update -----------------------------------------
  try {
    // Lazy client init.
    const cosmosContainer = getCosmosContainer();
    const { resource } = await cosmosContainer
      .item(id, roomId)
      .patch<FileDocument>([
        { op: 'replace', path: '/name', value: sanitisedName },
      ]);

    if (!resource) {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }

    return NextResponse.json(
      {
        id: resource.id,
        roomId: resource.roomId,
        name: resource.name,
        blobUrl: resource.blobUrl,
        sizeBytes: resource.sizeBytes,
        mimeType: resource.mimeType,
        uploadedAt: resource.uploadedAt,
      },
      { status: 200 },
    );
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }
    console.error('[file-patch] Cosmos error:', {
      id,
      roomId,
      code,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Failed to rename file.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove a file (blob + doc)
// ---------------------------------------------------------------------------

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<DeleteSuccess | ErrorResponse>> {
  // --- 1. Validate identity ----------------------------------------------
  const { id: rawId } = await params;
  const validation = validateIdentity(rawId, req.nextUrl.searchParams.get('roomId'));
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }
  const { id, roomId } = validation;

  // Lazy client init for both backends, up front so we fail fast on
  // misconfiguration rather than after deleting half the data.
  let cosmosContainer;
  let storageContainerClient;
  try {
    cosmosContainer = getCosmosContainer();
    storageContainerClient = getStorageContainerClient();
  } catch (err) {
    console.error('[file-delete] Client init failed:', err);
    return NextResponse.json(
      { error: 'Failed to delete file.' },
      { status: 500 },
    );
  }

  // --- 2. Read the document so we know which blob to delete --------------
  let document: FileDocument;
  try {
    const { resource, statusCode } = await cosmosContainer
      .item(id, roomId)
      .read<FileDocument>();

    if (!resource || statusCode === 404) {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }
    document = resource;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }
    console.error('[file-delete] Cosmos read failed:', {
      id,
      roomId,
      code,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Failed to look up file metadata.' },
      { status: 500 },
    );
  }

  // --- 3. Delete the blob first ------------------------------------------
  // Order matters: blob -> Cosmos.
  //   - If blob delete fails, we abort with the document still intact.
  //   - If blob delete succeeds but Cosmos fails (step 4), we have an orphan
  //     record. The read endpoint skips unparseable/missing blobs gracefully,
  //     and a retry will clean up: deleteIfExists is idempotent.
  const blobName = extractBlobName(document.blobUrl);
  if (blobName) {
    try {
      const blobClient = storageContainerClient.getBlobClient(blobName);
      await blobClient.deleteIfExists();
    } catch (err) {
      console.error('[file-delete] Blob deletion failed:', {
        id,
        blobName,
        message: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { error: 'Failed to delete blob from storage.' },
        { status: 500 },
      );
    }
  } else {
    console.warn('[file-delete] Document has unparseable blobUrl; deleting doc only:', id);
  }

  // --- 4. Delete the Cosmos document -------------------------------------
  try {
    await cosmosContainer.item(id, roomId).delete();
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) {
      return NextResponse.json({ id, deleted: true }, { status: 200 });
    }
    console.error('[file-delete] Cosmos delete failed:', {
      id,
      roomId,
      code,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error:
          'Blob removed but failed to delete metadata. Retry the delete to clean up.',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ id, deleted: true }, { status: 200 });
}