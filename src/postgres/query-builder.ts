interface QueryResult {
  sql: string;
  values: unknown[];
}

interface VectorSearchOptions {
  limit?: number;
  where?: Record<string, unknown>;
}

interface HybridSearchOptions {
  limit?: number;
  where?: Record<string, unknown>;
}

const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export function validateIdentifier(name: string, context: string = 'identifier'): string {
  if (!name || typeof name !== 'string' || !SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Invalid SQL ${context}: "${name}". Identifiers must match ${SAFE_IDENTIFIER}`);
  }

  return name;
}

export function buildInsert(table: string, data: Record<string, unknown>): QueryResult {
  validateIdentifier(table, 'table name');

  const keys = Object.keys(data);
  keys.forEach(k => validateIdentifier(k, 'column name'));

  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const values = keys.map(k => data[k]);

  const sql = `INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING "id"`;

  return { sql, values };
}

export function buildUpdate(table: string, id: unknown, data: Record<string, unknown>): QueryResult {
  validateIdentifier(table, 'table name');

  const keys = Object.keys(data);
  keys.forEach(k => validateIdentifier(k, 'column name'));

  const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`);
  const values: unknown[] = [...keys.map(k => data[k]), id];

  const sql = `UPDATE "${table}" SET ${setClauses.join(', ')} WHERE "id" = $${keys.length + 1}`;

  return { sql, values };
}

export function buildDelete(table: string, id: unknown): QueryResult {
  validateIdentifier(table, 'table name');

  return {
    sql: `DELETE FROM "${table}" WHERE "id" = $1`,
    values: [id],
  };
}

export function buildSelect(table: string, conditions?: Record<string, unknown>): QueryResult {
  validateIdentifier(table, 'table name');

  if (!conditions || Object.keys(conditions).length === 0) {
    return { sql: `SELECT * FROM "${table}"`, values: [] };
  }

  const keys = Object.keys(conditions);
  keys.forEach(k => validateIdentifier(k, 'column name'));

  const whereClauses = keys.map((k, i) => `"${k}" = $${i + 1}`);
  const values = keys.map(k => conditions[k]);

  const sql = `SELECT * FROM "${table}" WHERE ${whereClauses.join(' AND ')}`;

  return { sql, values };
}

/**
 * Build a vector similarity search query using cosine distance (<=>).
 */
export function buildVectorSearch(table: string, vectorColumn: string, queryVector: number[], options: VectorSearchOptions = {}): QueryResult {
  validateIdentifier(table, 'table name');
  validateIdentifier(vectorColumn, 'column name');

  const { limit = 10, where } = options;
  const values: unknown[] = [];
  let paramIndex = 1;

  // Vector parameter as a formatted string for pgvector
  const vectorStr = `[${queryVector.join(',')}]`;
  values.push(vectorStr);
  const vectorParam = `$${paramIndex++}`;

  const whereClauses: string[] = [];
  if (where) {
    for (const [k, v] of Object.entries(where)) {
      validateIdentifier(k, 'column name');
      whereClauses.push(`"${k}" = $${paramIndex++}`);
      values.push(v);
    }
  }

  const whereStr = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';
  values.push(limit);

  const sql = `SELECT *, ("${vectorColumn}" <=> ${vectorParam}::vector) AS distance FROM "${table}"${whereStr} ORDER BY "${vectorColumn}" <=> ${vectorParam}::vector LIMIT $${paramIndex}`;

  return { sql, values };
}

/**
 * Build a hybrid search query combining vector similarity with text filtering.
 * Uses cosine distance for vector ranking and ILIKE for text matching.
 */
export function buildHybridSearch(table: string, vectorColumn: string, queryVector: number[], textColumn: string, textQuery: string, options: HybridSearchOptions = {}): QueryResult {
  validateIdentifier(table, 'table name');
  validateIdentifier(vectorColumn, 'column name');
  validateIdentifier(textColumn, 'column name');

  const { limit = 10, where } = options;
  const values: unknown[] = [];
  let paramIndex = 1;

  const vectorStr = `[${queryVector.join(',')}]`;
  values.push(vectorStr);
  const vectorParam = `$${paramIndex++}`;

  values.push(`%${textQuery}%`);
  const textParam = `$${paramIndex++}`;

  const whereClauses: string[] = [`"${textColumn}" ILIKE ${textParam}`];
  if (where) {
    for (const [k, v] of Object.entries(where)) {
      validateIdentifier(k, 'column name');
      whereClauses.push(`"${k}" = $${paramIndex++}`);
      values.push(v);
    }
  }

  values.push(limit);

  const sql = `SELECT *, ("${vectorColumn}" <=> ${vectorParam}::vector) AS distance FROM "${table}" WHERE ${whereClauses.join(' AND ')} ORDER BY "${vectorColumn}" <=> ${vectorParam}::vector LIMIT $${paramIndex}`;

  return { sql, values };
}
