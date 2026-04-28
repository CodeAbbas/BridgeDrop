import { NextResponse } from 'next/server';
import { CosmosClient } from '@azure/cosmos';

// Initialize Cosmos configuration
const endpoint = process.env.COSMOS_ENDPOINT!;
const key = process.env.COSMOS_KEY!;
const databaseId = process.env.COSMOS_DATABASE_ID!;
const containerId = process.env.COSMOS_CONTAINER_ID!;

// Singleton client to prevent exhausting connection pools
const client = new CosmosClient({ endpoint, key });
const container = client.database(databaseId).container(containerId);

// In Next.js 16+, params is a Promise
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const roomId = resolvedParams.id.toUpperCase();

    console.log(`[room GET] Request for roomId=${roomId}`);

    if (!roomId || roomId.length !== 6) {
      console.warn(`[room GET] Invalid Room ID: "${roomId}"`);
      return NextResponse.json({ error: 'Invalid Room ID' }, { status: 400 });
    }

    // O(1) point-read — id and partition key are both roomId
    console.log(`[room GET] Point-reading Cosmos DB: id=${roomId} partitionKey=${roomId}`);
    const { resource: room, statusCode } = await container.item(roomId, roomId).read();
    console.log(`[room GET] Cosmos statusCode=${statusCode} room=${room ? `found (${room.files?.length ?? 0} files)` : 'not found'}`);

    if (statusCode === 404 || !room) {
      console.warn(`[room GET] Room ${roomId} not found or TTL-expired (statusCode=${statusCode})`);
      return NextResponse.json({ error: 'Room not found or expired' }, { status: 404 });
    }

    console.log(`[room GET] Returning ${room.files?.length ?? 0} file(s) for room ${roomId}`);
    return NextResponse.json({ success: true, files: room.files }, { status: 200 });

  } catch (error: any) {
    console.error(`[room GET] Cosmos DB error:`, error?.message, error?.code, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}