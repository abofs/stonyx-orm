/**
 * DynamoDB connection factory.
 *
 * Dynamically imports @aws-sdk/client-dynamodb and @aws-sdk/lib-dynamodb
 * so these are optional peerDependencies (matching the pg/mysql2 pattern).
 */

export interface DynamoDBConfig {
  region?: string;
  endpoint?: string;
  [key: string]: unknown;
}

// Type aliases — declared loose so we don't need to import the real SDK types
// at compile time (they're optional peer deps).
export type DocumentClient = {
  send(command: unknown): Promise<unknown>;
};

export type DynamoDBClientConstructor = new (options: unknown) => { config: unknown };
export type DocumentClientFromFn = { from(client: unknown): DocumentClient };

/**
 * Create a DynamoDBDocumentClient from the given config.
 * Uses dynamic import so @aws-sdk/* are optional peer deps.
 */
export async function createDocumentClient(dbConfig: DynamoDBConfig): Promise<DocumentClient> {
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb' as string) as {
    DynamoDBClient: DynamoDBClientConstructor;
  };
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb' as string) as {
    DynamoDBDocumentClient: DocumentClientFromFn;
  };

  const clientOptions: Record<string, unknown> = {};
  if (dbConfig.region) clientOptions.region = dbConfig.region;
  if (dbConfig.endpoint) clientOptions.endpoint = dbConfig.endpoint;

  const rawClient = new DynamoDBClient(clientOptions);
  return DynamoDBDocumentClient.from(rawClient);
}

/**
 * Nullify the document client reference (DynamoDB connections are HTTP-based
 * and stateless — no explicit pool close needed, but we clear the reference).
 */
export function destroyDocumentClient(_client: DocumentClient | null): null {
  return null;
}
