declare module 'pg' {
  interface PoolConfig {
    host?: string;
    user?: string;
    password?: string;
    database?: string;
    port?: number;
    [key: string]: unknown;
  }

  interface QueryResult {
    rows: Record<string, unknown>[];
    rowCount: number;
    fields?: { name: string }[];
  }

  export class Pool {
    constructor(config?: PoolConfig);
    query(sql: string, params?: unknown[]): Promise<QueryResult>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }

  export class PoolClient {
    query(sql: string, params?: unknown[]): Promise<QueryResult>;
    release(): void;
  }
}
