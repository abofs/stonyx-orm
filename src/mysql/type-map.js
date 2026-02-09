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

export function getMysqlType(attrType) {
  return typeMap[attrType] || 'TEXT';
}

export default typeMap;
