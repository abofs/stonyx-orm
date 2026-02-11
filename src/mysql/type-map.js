const typeMap = {
  string: 'VARCHAR(255)',
  number: 'INT',
  float: 'FLOAT',
  boolean: 'TINYINT(1)',
  date: 'DATETIME',
  timestamp: 'BIGINT',
  passthrough: 'TEXT',
  trim: 'VARCHAR(255)',
  uppercase: 'VARCHAR(255)',
  ceil: 'INT',
  floor: 'INT',
  round: 'INT',
};

/**
 * Resolves a Stonyx ORM attribute type to a MySQL column type.
 *
 * For built-in types, returns the mapped MySQL type directly.
 *
 * For custom transforms (e.g. an `animal` transform that maps strings to ints):
 *   - If the transform function exports a `mysqlType` property, that value is used.
 *     Example: `const transform = (v) => codeMap[v]; transform.mysqlType = 'INT'; export default transform;`
 *   - Otherwise, defaults to JSON. Values are JSON-stringified on write and
 *     JSON-parsed on read. This handles primitives and plain objects correctly.
 *     Class instances will be reduced to plain objects — if a custom transform
 *     produces class instances, it must declare a `mysqlType` and handle
 *     serialization itself.
 */
export function getMysqlType(attrType, transformFn) {
  if (typeMap[attrType]) return typeMap[attrType];
  if (transformFn?.mysqlType) return transformFn.mysqlType;

  return 'JSON';
}

export default typeMap;
