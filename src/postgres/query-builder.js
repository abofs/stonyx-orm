const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export function validateIdentifier(name, context = 'identifier') {
  if (!name || typeof name !== 'string' || !SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Invalid SQL ${context}: "${name}". Identifiers must match ${SAFE_IDENTIFIER}`);
  }

  return name;
}

export function buildInsert(table, data) {
  validateIdentifier(table, 'table name');

  const keys = Object.keys(data);
  keys.forEach(k => validateIdentifier(k, 'column name'));

  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const values = keys.map(k => data[k]);

  const sql = `INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING "id"`;

  return { sql, values };
}

export function buildUpdate(table, id, data) {
  validateIdentifier(table, 'table name');

  const keys = Object.keys(data);
  keys.forEach(k => validateIdentifier(k, 'column name'));

  const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`);
  const values = [...keys.map(k => data[k]), id];

  const sql = `UPDATE "${table}" SET ${setClauses.join(', ')} WHERE "id" = $${keys.length + 1}`;

  return { sql, values };
}

export function buildDelete(table, id) {
  validateIdentifier(table, 'table name');

  return {
    sql: `DELETE FROM "${table}" WHERE "id" = $1`,
    values: [id],
  };
}

export function buildSelect(table, conditions) {
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
 * @param {string} table - Table name
 * @param {string} vectorColumn - Name of the vector column
 * @param {number[]} queryVector - The query vector
 * @param {Object} [options]
 * @param {number} [options.limit=10] - Number of results to return
 * @param {Object} [options.where] - Additional WHERE conditions
 * @returns {{ sql: string, values: any[] }}
 */
export function buildVectorSearch(table, vectorColumn, queryVector, options = {}) {
  validateIdentifier(table, 'table name');
  validateIdentifier(vectorColumn, 'column name');

  const { limit = 10, where } = options;
  const values = [];
  let paramIndex = 1;

  // Vector parameter as a formatted string for pgvector
  const vectorStr = `[${queryVector.join(',')}]`;
  values.push(vectorStr);
  const vectorParam = `$${paramIndex++}`;

  let whereClauses = [];
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
 * @param {string} table - Table name
 * @param {string} vectorColumn - Vector column name
 * @param {number[]} queryVector - The query vector
 * @param {string} textColumn - Column to search text in
 * @param {string} textQuery - Text to search for
 * @param {Object} [options]
 * @param {number} [options.limit=10]
 * @param {Object} [options.where] - Additional WHERE conditions
 * @returns {{ sql: string, values: any[] }}
 */
export function buildHybridSearch(table, vectorColumn, queryVector, textColumn, textQuery, options = {}) {
  validateIdentifier(table, 'table name');
  validateIdentifier(vectorColumn, 'column name');
  validateIdentifier(textColumn, 'column name');

  const { limit = 10, where } = options;
  const values = [];
  let paramIndex = 1;

  const vectorStr = `[${queryVector.join(',')}]`;
  values.push(vectorStr);
  const vectorParam = `$${paramIndex++}`;

  values.push(`%${textQuery}%`);
  const textParam = `$${paramIndex++}`;

  let whereClauses = [`"${textColumn}" ILIKE ${textParam}`];
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
