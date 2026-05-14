/**
 * Maps ORM attribute types to DynamoDB scalar attribute types.
 * DynamoDB DocumentClient auto-marshalls JS objects, so most values
 * are sent as their native JS types.  This map is used by the
 * schema-introspector and startup provisioner for table/GSI creation.
 */

export type DynamoScalarType = 'S' | 'N' | 'BOOL';

/**
 * DynamoDB attribute-type string for a given ORM attr type.
 * - string            → S
 * - number / float    → N  (stored as Number; DocumentClient handles it)
 * - boolean           → BOOL
 * - date              → S  (ISO-8601 string — enables range queries)
 * - timestamp         → N  (milliseconds since epoch)
 * - passthrough/trim/etc → S  (safe default)
 *
 * For key schema declarations only `S` and `N` are valid; BOOL
 * is legal for attributes but never for a PK/SK.
 */
const typeMap: Record<string, DynamoScalarType> = {
  string: 'S',
  number: 'N',
  float: 'N',
  boolean: 'BOOL',
  date: 'S',
  timestamp: 'N',
  passthrough: 'S',
  trim: 'S',
  uppercase: 'S',
  ceil: 'N',
  floor: 'N',
  round: 'N',
};

/**
 * Returns the DynamoDB attribute type for a given ORM type string.
 * Defaults to 'S' for any unknown/custom type.
 */
export function getDynamoType(attrType: string): DynamoScalarType {
  return typeMap[attrType] ?? 'S';
}

/**
 * Returns the DynamoDB key type ('S' | 'N') for use in KeySchema.
 * BOOL cannot be a key attribute; anything that maps to BOOL falls back to 'S'.
 */
export function getDynamoKeyType(attrType: string): 'S' | 'N' {
  const t = getDynamoType(attrType);
  return t === 'N' ? 'N' : 'S';
}

export default typeMap;
