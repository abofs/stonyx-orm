declare module 'mysql2/promise' {
  interface PoolOptions {
    host: string;
    user: string;
    password: string;
    database: string;
    port?: number;
    [key: string]: unknown;
  }

  interface QueryResult {
    [index: number]: unknown;
  }

  interface Pool {
    execute(sql: string, params?: unknown[]): Promise<[unknown[], unknown]>;
    query(sql: string, params?: unknown[]): Promise<[unknown[], unknown]>;
    end(): Promise<void>;
    getConnection(): Promise<PoolConnection>;
  }

  interface PoolConnection extends Pool {
    release(): void;
    beginTransaction(): Promise<void>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
  }

  export function createPool(options: PoolOptions): Pool;
}
