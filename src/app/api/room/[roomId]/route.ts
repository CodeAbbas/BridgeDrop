/**
 * GET /api/room/[roomId]
 *
 * Returns all files uploaded to a room, with short-lived read-only SAS
 * tokens appended to each blobUrl so the receiver UI can download from the
 * private storage container.
 *
 * Each SAS pins a Content-Disposition response header (Azure's `rscd`
 * SAS parameter) so clicking a download link triggers a Save As dialog with
 * the original filename, rather than opening the file in a new browser tab.
 *
 * Inline previews (<img>, <video>, <audio>) keep working with the same URL
 * because browsers ignore Content-Disposition on sub-resource fetches —
 * the attachment directive only matters for top-level navigation.
 *
 * Response shape (matches the BridgeDrop frontend's setReceivedFiles call):
 *   {
 *     files: [
 *       { id, name, blobUrl, sizeBytes, mimeType, uploadedAt },
 *       ...
 *     ]
 *   }
 *
 * Security properties of the read SAS tokens minted here:
 *   - Read-only ('r') — no write, delete, or list.
 *   - HTTPS-only.
 *   - 1-hour expiry with a small clock-skew buffer.
 *   - Blob-scoped (one SAS per file).
 *   - Content-Disposition pinned in the signature — clients can't strip it.
 *
 * Required environment variables:
 *   AZURE_COSMOS_ENDPOINT
 *   AZURE_COSMOS_KEY
 *   AZURE_STORAGE_CONNECTION_STRING  (reused from /api/upload/generate-sas)
 */

import { NextRequest, NextResponse } from 'next/server';
import { CosmosClient, type Container } from '@azure/cosmos';
import {
  BlobServiceClient,
  BlobSASPermissions,
  SASProtocol,
} from '@azure/storage-blob';

// Both SDKs use Node crypto — not Edge-compatible.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Configuration — module-level singletons.
// ---------------------------------------------------------------------------

const DATABASE_ID = 'bridgedrop-db';
const CONTAINER_ID = 'room-metadata';
const STORAGE_CONTAINER_NAME = 'bridgedrop-media';
const ROOM_ID_PATTERN = /^[A-Za-z0-9]{6}$/;
const READ_SAS_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLOCK_SKEW_MS = 5 * 60 * 1000;    // 5-minute backdate

const cosmosEndpoint = process.env.AZURE_COSMOS_ENDPOINT;
const cosmosKey = process.env.AZURE_COSMOS_KEY;
const storageConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

if (!cosmosEndpoint || !cosmosKey) {
  throw new Error('AZURE_COSMOS_ENDPOINT and AZURE_COSMOS_KEY must be set.');
}
if (!storageConnectionString) {
  throw new Error('AZURE_STORAGE_CONNECTION_STRING must be set.');
}

const cosmosClient = new CosmosClient({
  endpoint: cosmosEndpoint,
  key: cosmosKey,
});
const cosmosContainer: Container = cosmosClient
  .database(DATABASE_ID)
  .container(CONTAINER_ID);

const blobServiceClient = BlobServiceClient.fromConnectionString(storageConnectionString);
const storageContainerClient = blobServiceClient.getContainerClient(STORAGE_CONTAINER_NAME);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Document shape stored by /api/upload/finalise. */
interface FileDocument {
  id: string;
  roomId: string;
  name: string;
  blobUrl: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: string;
}

/** Response shape — same as FileDocument but with a SAS-signed blobUrl. */
interface ResponseFile {
  id: string;
  name: string;
  blobUrl: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: string;
}

interface RoomResponse {
  files: ResponseFile[];
}

interface ErrorResponse {
  error: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the blob name (path within the container) from a clean blob URL.
 * Returns null if the URL doesn't match the expected storage account/container.
 */
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

/**
 * Builds an RFC 6266 / RFC 5987-compliant Content-Disposition header value
 * that triggers a Save As dialog with the original filename intact, even
 * for non-ASCII filenames.
 *
 * Emits BOTH `filename="..."` (ASCII fallback for legacy clients) and
 * `filename*=UTF-8''...` (modern clients, all current major browsers).
 *
 * Defensive against:
 *   - Control characters (0x00-0x1F, 0x7F) — stripped from ASCII fallback.
 *   - Quote and backslash injection — escaped per RFC 6266 quoted-string rules.
 *   - Non-ASCII characters — replaced with '_' in fallback, percent-encoded
 *     in the UTF-8 form via encodeURIComponent.
 *
 * Examples:
 *   "report.pdf"
 *     -> attachment; filename="report.pdf"; filename*=UTF-8''report.pdf
 *   "rapport français.pdf"
 *     -> attachment; filename="rapport fran_ais.pdf";
 *        filename*=UTF-8''rapport%20fran%C3%A7ais.pdf
 */
function buildContentDisposition(fileName: string): string {
  // ASCII fallback path: drop control chars, replace non-printable-ASCII
  // with '_', then escape quotes and backslashes per RFC 6266.
  const asciiFallback = fileName
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '\\$&');

  // Modern path: percent-encode the full UTF-8 filename.
  const utf8Encoded = encodeURIComponent(fileName);

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}

/**
 * Mints a read-only SAS URL for a single blob with a Content-Disposition
 * pin so navigation triggers a download. Returns null if the blob name
 * can't be parsed from the stored URL (treat the document as corrupt).
 */
async function signReadUrl(blobUrl: string, fileName: string): Promise<string | null> {
  const blobName = extractBlobName(blobUrl);
  if (!blobName) return null;

  const blobClient = storageContainerClient.getBlobClient(blobName);

  // `contentDisposition` is baked into the SAS signature as the `rscd`
  // parameter — Azure Storage adds it as the response header at fetch time
  // and the client cannot strip or modify it without invalidating the SAS.
  return blobClient.generateSasUrl({
    permissions: BlobSASPermissions.parse('r'),
    startsOn: new Date(Date.now() - CLOCK_SKEW_MS),
    expiresOn: new Date(Date.now() + READ_SAS_TTL_MS),
    protocol: SASProtocol.Https,
    contentDisposition: buildContentDisposition(fileName),
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
): Promise<NextResponse<RoomResponse | ErrorResponse>> {
  // --- 1. Resolve & validate route param ----------------------------------
  const { roomId: rawRoomId } = await params;

  if (typeof rawRoomId !== 'string' || !ROOM_ID_PATTERN.test(rawRoomId)) {
    return NextResponse.json(
      { error: 'Invalid Room ID. Must be 6 alphanumeric characters.' },
      { status: 400 },
    );
  }
  const roomId = rawRoomId.toUpperCase();

  // --- 2. Query Cosmos ---------------------------------------------------
  let documents: FileDocument[];
  try {
    const { resources } = await cosmosContainer.items
      .query<FileDocument>(
        {
          query: 'SELECT c.id, c.roomId, c.name, c.blobUrl, c.sizeBytes, c.mimeType, c.uploadedAt FROM c WHERE c.roomId = @roomId ORDER BY c.uploadedAt ASC',
          parameters: [{ name: '@roomId', value: roomId }],
        },
        { partitionKey: roomId },
      )
      .fetchAll();
    documents = resources;
  } catch (err) {
    console.error('[room-get] Cosmos query failed:', {
      roomId,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Failed to fetch room metadata.' },
      { status: 500 },
    );
  }

  if (documents.length === 0) {
    return NextResponse.json({ files: [] }, { status: 200 });
  }

  // --- 3. Mint read-only SAS URLs with download disposition ---------------
  const signed = await Promise.all(
    documents.map(async (doc): Promise<ResponseFile | null> => {
      try {
        const signedUrl = await signReadUrl(doc.blobUrl, doc.name);
        if (!signedUrl) {
          console.warn('[room-get] Skipping doc with unparsable blobUrl:', doc.id);
          return null;
        }
        return {
          id: doc.id,
          name: doc.name,
          blobUrl: signedUrl,
          sizeBytes: doc.sizeBytes,
          mimeType: doc.mimeType,
          uploadedAt: doc.uploadedAt,
        };
      } catch (err) {
        console.error('[room-get] SAS signing failed for doc:', doc.id, err);
        return null;
      }
    }),
  );

  const files = signed.filter((f): f is ResponseFile => f !== null);

  return NextResponse.json({ files }, { status: 200 });
}