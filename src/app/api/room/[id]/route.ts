/**
 * GET /api/room/[id]
 *
 * Retrieves room metadata from Cosmos DB (SQL API).
 * The room document holds the list of files a sender uploaded, including
 * each file's pre-signed read URL so the receiver can download from Blob Storage.
 *
 * Document TTL is controlled by the Cosmos DB container default (24 h).
 * Rooms that have expired are treated as 404.
 *
 * ── APIM ROUTING STUB ────────────────────────────────────────────────────────
 * If this route will be fronted by Azure API Management, replace the Cosmos DB
 * logic below with a thin forwarding call:
 *
 *   const apimUrl = `${process.env.APIM_BASE_URL}/room/${roomId}`;
 *   const upstream = await fetch(apimUrl, {
 *     headers: {
 *       'Ocp-Apim-Subscription-Key': process.env.APIM_SUBSCRIPTION_KEY!,
 *     },
 *     next: { revalidate: 0 }, // always fresh
 *   });
 *   return NextResponse.json(await upstream.json(), { status: upstream.status });
 *
 * In that model APIM handles auth, rate-limiting, caching, and routing to the
 * Cosmos DB backend; this handler only owns the HTTP boundary.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Required environment variables:
 *   COSMOS_ENDPOINT        https://<account>.documents.azure.com:443/
 *   COSMOS_KEY             Primary or secondary master key
 *   COSMOS_DATABASE_ID     bridgedrop-db  (matches Terraform output)
 *   COSMOS_CONTAINER_ID    room-metadata  (matches Terraform output)
 */

import { NextRequest, NextResponse } from 'next/server';
import { CosmosClient } from '@azure/cosmos';

// ---------------------------------------------------------------------------
// Client — module-level singleton; reused across warm Lambda/container invocations.
// ---------------------------------------------------------------------------
const cosmosClient = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT!,
  key: process.env.COSMOS_KEY!,
});

const roomContainer = cosmosClient
  .database(process.env.COSMOS_DATABASE_ID ?? 'bridgedrop-db')
  .container(process.env.COSMOS_CONTAINER_ID ?? 'room-metadata');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a single file entry inside a room document. */
export interface RoomFile {
  name: string;
  sizeBytes: number;
  mimeType: string;
  /** Pre-signed read URL (SAS) or permanent public URL, depending on access model. */
  blobUrl: string;
}

/**
 * Cosmos DB document schema for the `room-metadata` container.
 * id == roomId so every lookup is a direct point-read (1 RU, O(1)).
 */
interface RoomDocument {
  id: string;
  roomId: string; // partition key — /roomId
  files: RoomFile[];
  createdAt: number; // unix ms
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const roomId = id.toUpperCase();

  if (!/^[A-Z0-9]{6}$/.test(roomId)) {
    return NextResponse.json(
      { error: 'Invalid room ID. Must be exactly 6 alphanumeric characters.' },
      { status: 400 }
    );
  }

  try {
    // Point read: O(1), cheapest Cosmos DB operation possible.
    // Works because we store documents with id === roomId (the partition key).
    const { resource } = await roomContainer
      .item(roomId, roomId)
      .read<RoomDocument>();

    if (!resource) {
      return NextResponse.json(
        { error: 'Room not found or has expired.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ files: resource.files });
  } catch (err: unknown) {
    // Cosmos SDK throws an object with a numeric `code` on 404/409/etc.
    const cosmosErr = err as { code?: number };

    if (cosmosErr.code === 404) {
      return NextResponse.json(
        { error: 'Room not found or has expired.' },
        { status: 404 }
      );
    }

    console.error('[GET /api/room/[id]]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
