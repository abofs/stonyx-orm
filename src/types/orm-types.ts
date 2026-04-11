import type { AggregateProperty } from '../aggregates.js';

export interface SourceRecord {
  __model: { __name: string; [key: string]: unknown };
  __data?: Record<string, unknown>;
  __relationships?: Record<string, unknown>;
  id: unknown;
  [key: string]: unknown;
}

export interface OrmRecord {
  id: string | number | unknown;
  __model?: { __name: string };
  __data: Record<string, unknown> & { id?: unknown; __pendingSqlId?: boolean };
  __relationships: Record<string, unknown>;
  toJSON?(options?: { fields?: Set<string>; baseUrl?: string }): unknown;
  [key: string]: unknown;
}

export interface ForeignKeyDef {
  references: string;
  column: string;
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

export interface SnapshotEntry {
  table?: string;
  idType?: string;
  columns?: Record<string, string>;
  foreignKeys?: Record<string, ForeignKeyDef>;
  vectorColumns?: Record<string, number>;
  isView?: boolean;
  viewName?: string;
  source?: string;
  viewQuery?: string;
}
