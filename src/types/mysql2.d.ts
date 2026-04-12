declare module 'mysql2/promise' {
  interface PoolOptions {
    host: string;
    user: string;
    password: string;
    database: string;
    port?: number;
    waitForConnections?: boolean;
    connectionLimit?: number;
    queueLimit?: number;
    enableKeepAlive?: boolean;
    keepAliveInitialDelay?: number;
    [key: string]: string | number | boolean | undefined;
  }

  interface ExecuteResult {
    insertId: number;
    affectedRows: number;
    changedRows: number;
    fieldCount: number;
    info: string;
    serverStatus: number;
    warningStatus: number;
  }

  interface FieldPacket {
    name: string;
    type: number;
    length: number;
  }

  type RowDataPacket = Record<string, string | number | boolean | null>;

  interface Pool {
    execute(sql: string, params?: unknown[]): Promise<[RowDataPacket[] | ExecuteResult, FieldPacket[]]>;
    query(sql: string, params?: unknown[]): Promise<[RowDataPacket[] | ExecuteResult, FieldPacket[]]>;
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
