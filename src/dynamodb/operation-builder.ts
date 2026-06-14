/**
 * DynamoDB operation parameter builders.
 *
 * Each function returns a plain-object "params" bag that can be passed
 * directly to the corresponding DocumentClient command
 * (PutCommand, GetCommand, UpdateCommand, DeleteCommand, ScanCommand, QueryCommand).
 *
 * All functions are pure — no SDK imports here; the caller wraps params
 * in the appropriate Command class.
 */

export interface PutItemParams {
  TableName: string;
  Item: Record<string, unknown>;
  ConditionExpression?: string;
}

export interface GetItemParams {
  TableName: string;
  Key: Record<string, unknown>;
}

export interface UpdateItemParams {
  TableName: string;
  Key: Record<string, unknown>;
  UpdateExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
  ReturnValues: string;
}

export interface DeleteItemParams {
  TableName: string;
  Key: Record<string, unknown>;
}

export interface ScanParams {
  TableName: string;
  FilterExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
  ExclusiveStartKey?: Record<string, unknown>;
}

export interface QueryParams {
  TableName: string;
  IndexName: string;
  KeyConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
  ExclusiveStartKey?: Record<string, unknown>;
}

/**
 * PutItem — optionally with a condition expression.
 *
 * Pass conditionExpression = 'attribute_not_exists(id)' to enforce uniqueness.
 */
export function buildPutItem(
  tableName: string,
  item: Record<string, unknown>,
  conditionExpression?: string,
): PutItemParams {
  const params: PutItemParams = { TableName: tableName, Item: item };
  if (conditionExpression) params.ConditionExpression = conditionExpression;
  return params;
}

/**
 * GetItem by primary key.
 */
export function buildGetItem(
  tableName: string,
  key: Record<string, unknown>,
): GetItemParams {
  return { TableName: tableName, Key: key };
}

/**
 * UpdateItem with a SET expression built from the `updates` object.
 * Only the supplied attributes are updated (diff-based call site).
 */
export function buildUpdateItem(
  tableName: string,
  key: Record<string, unknown>,
  updates: Record<string, unknown>,
): UpdateItemParams {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const setClauses: string[] = [];

  for (const [attr, val] of Object.entries(updates)) {
    const nameAlias = `#${attr}`;
    const valAlias = `:${attr}`;
    names[nameAlias] = attr;
    values[valAlias] = val;
    setClauses.push(`${nameAlias} = ${valAlias}`);
  }

  return {
    TableName: tableName,
    Key: key,
    UpdateExpression: `SET ${setClauses.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: 'NONE',
  };
}

/**
 * DeleteItem by primary key.
 */
export function buildDeleteItem(
  tableName: string,
  key: Record<string, unknown>,
): DeleteItemParams {
  return { TableName: tableName, Key: key };
}

/**
 * ScanCommand params.
 * If conditions are supplied they are rendered as a FilterExpression using AND.
 */
export function buildScan(
  tableName: string,
  conditions?: Record<string, unknown>,
  exclusiveStartKey?: Record<string, unknown>,
): ScanParams {
  const params: ScanParams = { TableName: tableName };

  if (exclusiveStartKey) params.ExclusiveStartKey = exclusiveStartKey;

  if (conditions && Object.keys(conditions).length > 0) {
    const validEntries = Object.entries(conditions).filter(
      ([, val]) => val !== undefined && val !== null,
    );

    if (validEntries.length > 0) {
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const clauses: string[] = [];

      for (const [attr, val] of validEntries) {
        const nameAlias = `#${attr}`;
        const valAlias = `:${attr}`;
        names[nameAlias] = attr;
        values[valAlias] = val;
        clauses.push(`${nameAlias} = ${valAlias}`);
      }

      params.FilterExpression = clauses.join(' AND ');
      params.ExpressionAttributeNames = names;
      params.ExpressionAttributeValues = values;
    }
  }

  return params;
}

/**
 * QueryCommand params for a GSI.
 * keyConditions must be in the form { attrName: value } and will be rendered
 * as equality expressions joined by AND.
 */
export function buildQuery(
  tableName: string,
  indexName: string,
  keyConditions: Record<string, unknown>,
  exclusiveStartKey?: Record<string, unknown>,
): QueryParams {
  const validEntries = Object.entries(keyConditions).filter(
    ([, val]) => val !== undefined && val !== null,
  );

  if (validEntries.length === 0) {
    throw new Error('buildQuery: all keyCondition values are undefined/null');
  }

  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const clauses: string[] = [];

  for (const [attr, val] of validEntries) {
    const nameAlias = `#${attr}`;
    const valAlias = `:${attr}`;
    names[nameAlias] = attr;
    values[valAlias] = val;
    clauses.push(`${nameAlias} = ${valAlias}`);
  }

  const params: QueryParams = {
    TableName: tableName,
    IndexName: indexName,
    KeyConditionExpression: clauses.join(' AND '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };

  if (exclusiveStartKey) params.ExclusiveStartKey = exclusiveStartKey;

  return params;
}
