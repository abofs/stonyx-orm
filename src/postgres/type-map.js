const typeMap = {
  string: 'VARCHAR(255)',
  number: 'INTEGER',
  float: 'REAL',
  boolean: 'BOOLEAN',
  date: 'TIMESTAMPTZ',
  timestamp: 'BIGINT',
  passthrough: 'TEXT',
  trim: 'VARCHAR(255)',
  uppercase: 'VARCHAR(255)',
  ceil: 'INTEGER',
  floor: 'INTEGER',
  round: 'INTEGER',
};

/**
 * Resolves a Stonyx ORM attribute type to a PostgreSQL column type.
 *
 * For built-in types, returns the mapped PostgreSQL type directly.
 *
 * For custom transforms (e.g. an `animal` transform that maps strings to ints):
 *   - If the transform function exports a `pgType` property, that value is used.
 *   - Otherwise, if `mysqlType` is defined, it is mapped to a PG equivalent.
 *   - Otherwise, defaults to JSONB. Values are JSON-stringified on write and
 *     JSON-parsed on read by PostgreSQL natively.
 */
export function getPgType(attrType, transformFn) {
  if (typeMap[attrType]) return typeMap[attrType];
  if (transformFn?.pgType) return transformFn.pgType;
  if (transformFn?.mysqlType) return mysqlTypeToPg(transformFn.mysqlType);

  return 'JSONB';
}

/**
 * Returns a vector column type for the given dimensions.
 * @param {number} dimensions - Vector dimensionality (e.g. 768, 1536)
 * @returns {string}
 */
export function getVectorType(dimensions) {
  return `vector(${dimensions})`;
}

function mysqlTypeToPg(mysqlType) {
  const upper = mysqlType.toUpperCase();
  if (upper === 'TINYINT(1)') return 'BOOLEAN';
  if (upper === 'INT' || upper === 'INT AUTO_INCREMENT') return 'INTEGER';
  if (upper === 'DATETIME') return 'TIMESTAMPTZ';
  if (upper === 'JSON') return 'JSONB';
  return mysqlType;
}

export default typeMap;
