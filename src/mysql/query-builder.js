export function buildInsert(table, data) {
  const keys = Object.keys(data);
  const placeholders = keys.map(() => '?');
  const values = keys.map(k => data[k]);

  const sql = `INSERT INTO \`${table}\` (${keys.map(k => `\`${k}\``).join(', ')}) VALUES (${placeholders.join(', ')})`;

  return { sql, values };
}

export function buildUpdate(table, id, data) {
  const keys = Object.keys(data);
  const setClauses = keys.map(k => `\`${k}\` = ?`);
  const values = [...keys.map(k => data[k]), id];

  const sql = `UPDATE \`${table}\` SET ${setClauses.join(', ')} WHERE \`id\` = ?`;

  return { sql, values };
}

export function buildDelete(table, id) {
  return {
    sql: `DELETE FROM \`${table}\` WHERE \`id\` = ?`,
    values: [id],
  };
}

export function buildSelect(table, conditions) {
  if (!conditions || Object.keys(conditions).length === 0) {
    return { sql: `SELECT * FROM \`${table}\``, values: [] };
  }

  const keys = Object.keys(conditions);
  const whereClauses = keys.map(k => `\`${k}\` = ?`);
  const values = keys.map(k => conditions[k]);

  const sql = `SELECT * FROM \`${table}\` WHERE ${whereClauses.join(' AND ')}`;

  return { sql, values };
}
