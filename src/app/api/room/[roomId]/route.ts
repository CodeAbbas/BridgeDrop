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
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  BlobSASPermissions,
  SASProtocol,
} from '@azure/storage-blob';
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
const READ_SAS_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLOCK_SKEW_MS = 5 * 60 * 1000;    // 5-minute backdate

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
 */
function buildContentDisposition(fileName: string): string {
  const asciiFallback = fileName
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '\\$&');

  const utf8Encoded = encodeURIComponent(fileName);

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
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
    // Lazy client init.
    const cosmosContainer = getCosmosContainer();
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

  // Empty room is a valid 200 response, not a 404 — the room may exist
  // but no files have been uploaded yet.
  if (documents.length === 0) {
    return NextResponse.json({ files: [] }, { status: 200 });
  }

  // --- 3. Mint read-only SAS URLs with download disposition ---------------
  // Init the storage client once for the whole batch rather than per-file.
  let storageContainerClient;
  try {
    storageContainerClient = getStorageContainerClient();
  } catch (err) {
    console.error('[room-get] Failed to init storage client:', err);
    return NextResponse.json(
      { error: 'Failed to fetch room metadata.' },
      { status: 500 },
    );
  }

  const signed = await Promise.all(
    documents.map(async (doc): Promise<ResponseFile | null> => {
      try {
        const blobName = extractBlobName(doc.blobUrl);
        if (!blobName) {
          console.warn('[room-get] Skipping doc with unparsable blobUrl:', doc.id);
          return null;
        }

        const blobClient = storageContainerClient.getBlobClient(blobName);

        // `contentDisposition` is baked into the SAS signature as the `rscd`
        // parameter — Azure Storage adds it as the response header at fetch
        // time and the client cannot strip or modify it without invalidating
        // the SAS.
        const signedUrl = await blobClient.generateSasUrl({
          permissions: BlobSASPermissions.parse('r'),
          startsOn: new Date(Date.now() - CLOCK_SKEW_MS),
          expiresOn: new Date(Date.now() + READ_SAS_TTL_MS),
          protocol: SASProtocol.Https,
          contentDisposition: buildContentDisposition(doc.name),
        });

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