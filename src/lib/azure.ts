/**
 * Lazy Azure client factory.
 *
 * Why: Next.js evaluates route module scope at build time (during `next build`
 * and during `next dev` startup). If we instantiate clients or read env vars
 * at module scope, missing secrets crash the build — which breaks our GitHub
 * Actions CI pipeline since secrets are only injected at runtime.
 *
 * The fix: defer all env access and client construction until the first
 * incoming request actually needs them. Once constructed, cache the client
 * in a module-scoped singleton so we don't reconnect on every request.
 *
 * Behaviour summary:
 *   - Build time:  these getters are never called → no env access → no crash.
 *   - First request: env is read, clients are created, references cached.
 *   - Subsequent requests: cached clients are returned (same as a top-level
 *     singleton — no perf regression).
 *   - Missing env: throws inside the handler, surfaces as a clean 500 to the
 *     caller via the route's existing try/catch.
 */

import { CosmosClient, type Container } from '@azure/cosmos';
import {
  BlobServiceClient,
  type ContainerClient,
} from '@azure/storage-blob';

// ---------------------------------------------------------------------------
// Constants — kept here so route files don't need to duplicate them.
// ---------------------------------------------------------------------------

export const DATABASE_ID = 'bridgedrop-db';
export const COSMOS_CONTAINER_ID = 'room-metadata';
export const STORAGE_CONTAINER_NAME = 'bridgedrop-media';

// ---------------------------------------------------------------------------
// Cached singletons — populated on first request, reused thereafter.
// ---------------------------------------------------------------------------

let cosmosContainerCache: Container | null = null;
let storageContainerCache: ContainerClient | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Thrown at runtime inside the handler, never at build/import time.
    // Routes catch this and surface a 500; the message identifies which
    // env var is missing without leaking secrets.
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Public getters — call these from inside handler functions only.
// ---------------------------------------------------------------------------

/**
 * Returns the Cosmos `room-metadata` container client, creating the
 * underlying CosmosClient on first call.
 */
export function getCosmosContainer(): Container {
  if (cosmosContainerCache) return cosmosContainerCache;

  const endpoint = readEnv('AZURE_COSMOS_ENDPOINT');
  const key = readEnv('AZURE_COSMOS_KEY');

  const client = new CosmosClient({ endpoint, key });
  cosmosContainerCache = client.database(DATABASE_ID).container(COSMOS_CONTAINER_ID);
  return cosmosContainerCache;
}

/**
 * Returns the `bridgedrop-media` blob container client, creating the
 * underlying BlobServiceClient on first call.
 */
export function getStorageContainerClient(): ContainerClient {
  if (storageContainerCache) return storageContainerCache;

  const connectionString = readEnv('AZURE_STORAGE_CONNECTION_STRING');
  const service = BlobServiceClient.fromConnectionString(connectionString);
  storageContainerCache = service.getContainerClient(STORAGE_CONTAINER_NAME);
  return storageContainerCache;
}