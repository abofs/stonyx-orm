declare module 'pg' {
  interface PoolConfig {
    host?: string;
    user?: string;
    password?: string;
    database?: string;
    port?: number;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  }

  type RowData = Record<string, string | number | boolean | null>;

  interface QueryResult {
    rows: RowData[];
    rowCount: number;
    fields?: { name: string; dataTypeID: number }[];
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
