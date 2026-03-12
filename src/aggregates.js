export class AggregateProperty {
  constructor(aggregateType, relationship, field) {
    this.aggregateType = aggregateType;
    this.relationship = relationship;
    this.field = field;
    this.mysqlFunction = aggregateType.toUpperCase();
    this.resultType = aggregateType === 'avg' ? 'float' : 'number';
  }

  compute(relatedRecords) {
    if (!relatedRecords || !Array.isArray(relatedRecords) || relatedRecords.length === 0) {
      if (this.aggregateType === 'min' || this.aggregateType === 'max') return null;
      return 0;
    }

    switch (this.aggregateType) {
      case 'count':
        return relatedRecords.length;

      case 'sum':
        return relatedRecords.reduce((acc, record) => {
          const val = parseFloat(record?.__data?.[this.field] ?? record?.[this.field]);
          return acc + (isNaN(val) ? 0 : val);
        }, 0);

      case 'avg': {
        let sum = 0;
        let count = 0;
        for (const record of relatedRecords) {
          const val = parseFloat(record?.__data?.[this.field] ?? record?.[this.field]);
          if (!isNaN(val)) {
            sum += val;
            count++;
          }
        }
        return count === 0 ? 0 : sum / count;
      }

      case 'min': {
        let min = null;
        for (const record of relatedRecords) {
          const val = parseFloat(record?.__data?.[this.field] ?? record?.[this.field]);
          if (!isNaN(val) && (min === null || val < min)) min = val;
        }
        return min;
      }

      case 'max': {
        let max = null;
        for (const record of relatedRecords) {
          const val = parseFloat(record?.__data?.[this.field] ?? record?.[this.field]);
          if (!isNaN(val) && (max === null || val > max)) max = val;
        }
        return max;
      }

      default:
        return null;
    }
  }
}

export function count(relationship) {
  return new AggregateProperty('count', relationship);
}

export function avg(relationship, field) {
  return new AggregateProperty('avg', relationship, field);
}

export function sum(relationship, field) {
  return new AggregateProperty('sum', relationship, field);
}

export function min(relationship, field) {
  return new AggregateProperty('min', relationship, field);
}

export function max(relationship, field) {
  return new AggregateProperty('max', relationship, field);
}
