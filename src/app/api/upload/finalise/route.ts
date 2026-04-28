import { NextResponse } from 'next/server';
import { CosmosClient } from '@azure/cosmos';

const endpoint = process.env.COSMOS_ENDPOINT!;
const key = process.env.COSMOS_KEY!;
const databaseId = process.env.COSMOS_DATABASE_ID!;
const containerId = process.env.COSMOS_CONTAINER_ID!;

// Initialize Cosmos Client
const client = new CosmosClient({ endpoint, key });
const container = client.database(databaseId).container(containerId);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomId, fileName, blobUrl, sizeBytes, mimeType } = body;

    console.log(`[finalise] Received: roomId=${roomId} fileName=${fileName} blobUrl=${blobUrl} mimeType=${mimeType} sizeBytes=${sizeBytes}`);

    if (!roomId || !fileName || !blobUrl) {
      console.error(`[finalise] Missing required fields — roomId=${roomId} fileName=${fileName} blobUrl=${blobUrl}`);
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const newFile = {
      name: fileName,
      blobUrl: blobUrl,
      sizeBytes: sizeBytes,
      mimeType: mimeType,
      uploadedAt: new Date().toISOString()
    };

    // Point-read to check if the room already exists
    console.log(`[finalise] Point-reading Cosmos DB for roomId=${roomId} (id=${roomId}, partitionKey=${roomId})`);
    const { resource: existingRoom, statusCode } = await container.item(roomId, roomId).read();
    console.log(`[finalise] Cosmos point-read statusCode=${statusCode} existingRoom=${existingRoom ? 'found' : 'not found'}`);

    if (statusCode === 404 || !existingRoom) {
      console.log(`[finalise] Room does not exist — creating new document for roomId=${roomId}`);
      const { resource: createdItem, statusCode: createStatus } = await container.items.create({
        id: roomId,
        roomId: roomId,
        files: [newFile],
        createdAt: new Date().toISOString()
      });
      console.log(`[finalise] Cosmos create statusCode=${createStatus} id=${createdItem?.id}`);
      return NextResponse.json({ success: true, room: createdItem });
    } else {
      console.log(`[finalise] Room exists with ${existingRoom.files?.length ?? 0} file(s) — appending`);
      existingRoom.files.push(newFile);
      const { resource: updatedItem, statusCode: replaceStatus } = await container.item(roomId, roomId).replace(existingRoom);
      console.log(`[finalise] Cosmos replace statusCode=${replaceStatus} id=${updatedItem?.id} files=${updatedItem?.files?.length}`);
      return NextResponse.json({ success: true, room: updatedItem });
    }

  } catch (error: any) {
    console.error('[finalise] Cosmos DB error:', error?.message, error?.code, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}