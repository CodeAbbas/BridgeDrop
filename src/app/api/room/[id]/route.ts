import { NextResponse } from 'next/server';
import { CosmosClient } from '@azure/cosmos';
import { StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } from '@azure/storage-blob';

// Cosmos DB config
const endpoint = process.env.COSMOS_ENDPOINT!;
const key = process.env.COSMOS_KEY!;
const databaseId = process.env.COSMOS_DATABASE_ID!;
const containerId = process.env.COSMOS_CONTAINER_ID!;

// Blob Storage config (Needed for signing the download links)
const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME!;

const client = new CosmosClient({ endpoint, key });
const container = client.database(databaseId).container(containerId);
const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const roomId = resolvedParams.id.toUpperCase();

    if (!roomId || roomId.length !== 6) {
      return NextResponse.json({ error: 'Invalid Room ID' }, { status: 400 });
    }

    // 1. Fetch the metadata from Cosmos DB
    const { resource: room, statusCode } = await container.item(roomId, roomId).read();

    if (statusCode === 404 || !room) {
      return NextResponse.json({ error: 'Room not found or expired' }, { status: 404 });
    }

    // 2. Generate Read-Only SAS Tokens for every file in the room
    const filesWithSecureLinks = room.files.map((file: any) => {
      // Extract just the filename from the end of the blobUrl
      const urlObj = new URL(file.blobUrl);
      const blobName = decodeURIComponent(urlObj.pathname.replace(`/${containerName}/`, ''));

      // Create a Read-Only (r) token valid for 1 hour
      const sasOptions = {
        containerName,
        blobName,
        permissions: BlobSASPermissions.parse("r"), 
        startsOn: new Date(new Date().valueOf() - 5 * 60 * 1000),
        expiresOn: new Date(new Date().valueOf() + 3600 * 1000),
      };

      const sasToken = generateBlobSASQueryParameters(sasOptions, sharedKeyCredential).toString();
      
      return {
        ...file,
        // Append the token to the URL so the frontend can bypass the Private block
        blobUrl: `${file.blobUrl}?${sasToken}` 
      };
    });

    return NextResponse.json({ success: true, files: filesWithSecureLinks }, { status: 200 });

  } catch (error: any) {
    console.error(`Cosmos DB GET Error for room:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}