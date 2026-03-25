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

  const sql = `INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${placeholders.join(', ')})`;

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
