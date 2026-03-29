const typeMap = {
  string: 'VARCHAR(255)',
  number: 'INTEGER',
  float: 'DOUBLE PRECISION',
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

export function getPostgresType(attrType, transformFn) {
  if (typeMap[attrType]) return typeMap[attrType];
  if (transformFn?.postgresType) return transformFn.postgresType;
  return 'JSONB';
}

export default typeMap;
