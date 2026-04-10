type AggregateType = 'count' | 'avg' | 'sum' | 'min' | 'max';

interface AggregateRecord {
  __data?: Record<string, unknown>;
  [key: string]: unknown;
}

export class AggregateProperty {
  aggregateType: AggregateType;
  relationship: string | undefined;
  field: string | undefined;
  mysqlFunction: string;
  resultType: 'float' | 'number';

  constructor(aggregateType: AggregateType, relationship?: string, field?: string) {
    this.aggregateType = aggregateType;
    this.relationship = relationship;
    this.field = field;
    this.mysqlFunction = aggregateType.toUpperCase();
    this.resultType = aggregateType === 'avg' ? 'float' : 'number';
  }

  compute(relatedRecords: AggregateRecord[]): number | null {
    if (!relatedRecords || !Array.isArray(relatedRecords) || relatedRecords.length === 0) {
      if (this.aggregateType === 'min' || this.aggregateType === 'max') return null;
      return 0;
    }

    switch (this.aggregateType) {
      case 'count':
        return relatedRecords.length;

      case 'sum':
        return relatedRecords.reduce((acc, record) => {
          const val = parseFloat(record?.__data?.[this.field!] as string ?? record?.[this.field!] as string);
          return acc + (isNaN(val) ? 0 : val);
        }, 0);

      case 'avg': {
        let sum = 0;
        let count = 0;
        for (const record of relatedRecords) {
          const val = parseFloat(record?.__data?.[this.field!] as string ?? record?.[this.field!] as string);
          if (!isNaN(val)) {
            sum += val;
            count++;
          }
        }
        return count === 0 ? 0 : sum / count;
      }

      case 'min': {
        let min: number | null = null;
        for (const record of relatedRecords) {
          const val = parseFloat(record?.__data?.[this.field!] as string ?? record?.[this.field!] as string);
          if (!isNaN(val) && (min === null || val < min)) min = val;
        }
        return min;
      }

      case 'max': {
        let max: number | null = null;
        for (const record of relatedRecords) {
          const val = parseFloat(record?.__data?.[this.field!] as string ?? record?.[this.field!] as string);
          if (!isNaN(val) && (max === null || val > max)) max = val;
        }
        return max;
      }

      default:
        return null;
    }
  }
}

export function count(relationship: string): AggregateProperty {
  return new AggregateProperty('count', relationship);
}

export function avg(relationshipOrField: string, field?: string): AggregateProperty {
  if (field !== undefined) {
    return new AggregateProperty('avg', relationshipOrField, field);
  }
  return new AggregateProperty('avg', undefined, relationshipOrField);
}

export function sum(relationshipOrField: string, field?: string): AggregateProperty {
  if (field !== undefined) {
    return new AggregateProperty('sum', relationshipOrField, field);
  }
  return new AggregateProperty('sum', undefined, relationshipOrField);
}

export function min(relationshipOrField: string, field?: string): AggregateProperty {
  if (field !== undefined) {
    return new AggregateProperty('min', relationshipOrField, field);
  }
  return new AggregateProperty('min', undefined, relationshipOrField);
}

export function max(relationshipOrField: string, field?: string): AggregateProperty {
  if (field !== undefined) {
    return new AggregateProperty('max', relationshipOrField, field);
  }
  return new AggregateProperty('max', undefined, relationshipOrField);
}
