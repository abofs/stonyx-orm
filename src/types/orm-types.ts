import type { AggregateProperty } from '../aggregates.js';

export interface OrmDbConfig {
  file: string;
  schema: string;
  mode: string;
  directory: string;
  autosave: string;
  saveInterval: string | number;
}

export interface OrmMysqlConfig {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
  migrationsDir?: string;
  migrationsTable?: string;
  [key: string]: unknown;
}

export interface OrmPostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
  migrationsDir?: string;
  migrationsTable?: string;
  [key: string]: unknown;
}

export interface OrmPaths {
  model: string;
  serializer: string;
  transform: string;
  view?: string;
  access?: string;
  [key: string]: string | undefined;
}

export interface OrmRestServerConfig {
  enabled: string;
  route: string;
  metaRoute: boolean;
}

export interface OrmDynamoDBConfig {
  region?: string;
  endpoint?: string;
  tablePrefix?: string;
  [key: string]: unknown;
}

export interface OrmSection {
  db: OrmDbConfig;
  paths: OrmPaths;
  restServer: OrmRestServerConfig;
  mysql?: OrmMysqlConfig;
  postgres?: OrmPostgresConfig;
  timescale?: OrmPostgresConfig;
  dynamodb?: OrmDynamoDBConfig;
  logColor?: string;
  logMethod?: string;
  [key: string]: unknown;
}

export interface OrmConfig {
  rootPath: string;
  orm: OrmSection;
  [key: string]: unknown;
}

export interface SourceRecord {
  __model: { __name: string; [key: string]: unknown };
  __data?: Record<string, unknown>;
  __relationships?: Record<string, unknown>;
  id: string | number;
  [key: string]: unknown;
}

export interface OrmRecord {
  id: string | number;
  __model?: { __name: string };
  __data: Record<string, unknown> & { id?: string | number; __pendingSqlId?: boolean };
  __relationships: Record<string, unknown>;
  toJSON?(options?: { fields?: Set<string>; baseUrl?: string }): Record<string, unknown>;
  [key: string]: unknown;
}

export interface ForeignKeyDef {
  references: string;
  column: string;
}

export interface HypertableConfig {
  timeColumn: string;
  chunkInterval?: string;
  compress?: {
    segmentBy?: string;
    orderBy?: string;
    after?: string;
  };
}

export interface ModelSchema {
  table: string;
  idType: string;
  columns: Record<string, string>;
  foreignKeys: Record<string, ForeignKeyDef>;
  relationships: {
    belongsTo: Record<string, string | null>;
    hasMany: Record<string, string | null>;
  };
  vectorColumns?: Record<string, number>;
  hypertable?: HypertableConfig;
  memory: boolean;
}

export interface ViewSchema {
  viewName: string;
  source: string;
  groupBy?: string;
  columns: Record<string, string>;
  foreignKeys: Record<string, ForeignKeyDef>;
  aggregates: Record<string, AggregateProperty>;
  relationships: {
    belongsTo: Record<string, string | null>;
    hasMany: Record<string, string | null>;
  };
  isView: boolean;
  memory: boolean;
}

/**
 * Typed relationship registry maps.
 * Each key in Orm.relationships stores a different nested Map structure.
 */
/** Relationship registry map types — source → target → recordId → value */
export type HasManyMap = Map<string, Map<string, Map<unknown, unknown[]>>>;
export type BelongsToMap = Map<string, Map<string, Map<unknown, unknown>>>;
export type GlobalMap = Map<string, unknown[][]>;
export type PendingMap = Map<string, Map<unknown, unknown[][]>>;
export type PendingBelongsToMap = Map<string, Map<unknown, unknown[]>>;

export interface RelationshipMaps {
  hasMany: HasManyMap;
  belongsTo: BelongsToMap;
  global: GlobalMap;
  pending: PendingMap;
  pendingBelongsTo: PendingBelongsToMap;
}

export interface SnapshotEntry {
  table?: string;
  idType?: string;
  columns?: Record<string, string>;
  foreignKeys?: Record<string, ForeignKeyDef>;
  vectorColumns?: Record<string, number>;
  hypertable?: HypertableConfig;
  isView?: boolean;
  viewName?: string;
  source?: string;
  viewQuery?: string;
}
