/**
 * POST /api/upload/generate-sas
 *
 * Implements the Valet Key Pattern for secure, direct-to-Azure-Blob uploads.
 *
 * Flow:
 *   1. Frontend sends file metadata (roomId, fileName, mimeType).
 *   2. This handler generates a short-lived, write-only Blob SAS token scoped
 *      to a single blob path.
 *   3. Frontend receives { sasUrl, blobName } and PUTs the file directly to
 *      Azure Blob Storage — the binary data never passes through this server.
 *   4. After the PUT succeeds, the frontend calls POST /api/upload/finalize
 *      (future route) to register the file in Cosmos DB room-metadata.
 *
 * Security properties of the generated SAS:
 *   - Blob-scoped (not container-scoped) — one token per file.
 *   - Permissions: cw (Create + Write only) — no read, no delete, no list.
 *   - HTTPS-only.
 *   - Content-Type locked to the requested mimeType — mismatched PUTs are rejected.
 *   - 15-minute expiry window with a 1-minute clock-skew buffer.
 *   - Blob name includes a UUID, so URLs are unguessable.
 *
 * Required environment variables:
 *   AZURE_STORAGE_ACCOUNT_NAME   e.g. bridgedroprodxxxxxx
 *   AZURE_STORAGE_ACCOUNT_KEY    Primary or secondary access key
 *   AZURE_STORAGE_CONTAINER_NAME bridgedrop-media  (defaults to this value)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  StorageSharedKeyCredential,
  BlobSASPermissions,
  BlobSASSignatureValues,
  generateBlobSASQueryParameters,
  SASProtocol,
} from '@azure/storage-blob';

// ---------------------------------------------------------------------------
// Credential — module-level singleton.
// StorageSharedKeyCredential is stateless and safe to share across requests.
// ---------------------------------------------------------------------------
const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
const containerName =
  process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'bridgedrop-media';

const sharedKeyCredential = new StorageSharedKeyCredential(
  accountName,
  accountKey
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SasRequestBody {
  roomId: string;
  fileName: string;
  mimeType: string;
}

interface SasResponseBody {
  /** Complete URL the browser PUTs to. Includes the SAS token as a query string. */
  sasUrl: string;
  /**
   * Blob path relative to the container (e.g. "ABC123/uuid-photo.jpg").
   * Pass this to POST /api/upload/finalize so the server can build the
   * permanent read URL and write it into Cosmos DB.
   */
  blobName: string;
  /** ISO 8601 expiry — the frontend can show a countdown or retry prompt. */
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strips path separators and limits length to prevent directory traversal
 * and overly long blob names.
 */
function sanitiseFileName(raw: string): string {
  const stripped = raw.replace(/[/\\]/g, '').trim();
  return stripped.slice(0, 200) || 'file';
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let body: Partial<SasRequestBody>;

  try {
    body = (await req.json()) as Partial<SasRequestBody>;
  } catch {
    return NextResponse.json(
      { error: 'Request body must be valid JSON.' },
      { status: 400 }
    );
  }

  const { roomId, fileName, mimeType } = body;

  if (!roomId || !/^[A-Za-z0-9]{6}$/.test(roomId)) {
    return NextResponse.json(
      { error: 'roomId must be a 6-character alphanumeric string.' },
      { status: 400 }
    );
  }
  if (!fileName || typeof fileName !== 'string') {
    return NextResponse.json({ error: 'fileName is required.' }, { status: 400 });
  }
  if (!mimeType || typeof mimeType !== 'string') {
    return NextResponse.json({ error: 'mimeType is required.' }, { status: 400 });
  }

  // Blob name: "<ROOMID>/<uuid>-<safe-filename>"
  // Scoping by roomId groups room files together in the container.
  // The UUID makes the URL unguessable and prevents collisions.
  const safeFileName = sanitiseFileName(fileName);
  const blobName = `${roomId.toUpperCase()}/${crypto.randomUUID()}-${safeFileName}`;

  const startsOn = new Date(Date.now() - 60_000);       // 1-min clock-skew buffer
  const expiresOn = new Date(Date.now() + 15 * 60_000); // 15-min upload window

  const sasValues: BlobSASSignatureValues = {
    containerName,
    blobName,
    // c = Create new blobs, w = Write blob data.
    // No r (read), d (delete), or l (list) — write-only valet key.
    permissions: BlobSASPermissions.parse('cw'),
    startsOn,
    expiresOn,
    protocol: SASProtocol.Https,
    // Locking contentType means the storage service rejects any PUT whose
    // Content-Type header does not exactly match — prevents MIME-type confusion.
    contentType: mimeType,
  };

  try {
    const sasToken = generateBlobSASQueryParameters(
      sasValues,
      sharedKeyCredential
    ).toString();

    const sasUrl = `https://${accountName}.blob.core.windows.net/${containerName}/${encodeURIComponent(blobName)}?${sasToken}`;

    const responseBody: SasResponseBody = {
      sasUrl,
      blobName,
      expiresAt: expiresOn.toISOString(),
    };

    // 201 Created — a new upload credential has been provisioned.
    return NextResponse.json(responseBody, { status: 201 });
  } catch (err) {
    console.error('[POST /api/upload/generate-sas]', err);
    return NextResponse.json(
      { error: 'Failed to generate upload token.' },
      { status: 500 }
    );
  }
}
