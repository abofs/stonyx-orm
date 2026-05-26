import config from 'stonyx/config';
import { get, makeArray } from '@stonyx/utils/object';
import type { AggregateProperty } from './aggregates.js';
import type ModelProperty from './model-property.js';

const RESERVED_KEYS = ['__name'];

function isAggregateProperty(v: unknown): v is AggregateProperty {
  return typeof v === 'object' && v !== null && (v as { __kind?: string }).__kind === 'AggregateProperty';
}

function isModelProperty(v: unknown): v is ModelProperty {
  return typeof v === 'object' && v !== null && (v as { __kind?: string }).__kind === 'ModelProperty';
}

function searchQuery(query: Record<string, unknown>, array: unknown, key?: string): unknown {
  const result = makeArray(array).find((item: unknown) => {
    for (const [prop, value] of Object.entries(query)) {
      if ((item as Record<string, unknown>)[prop] !== value) return false;

      return true;
    }
  });

  if (!result) return null;
  if (key) return (result as Record<string, unknown>)[key];

  return result;
}

function query(rawData: unknown, pathPrefix: string, subPath: unknown): unknown {
  if (!rawData) return null;

  const [path, getter, pointer] = makeArray(subPath) as [string, unknown, string | undefined];
  const fullPath = `${pathPrefix}${path}`;
  const value = get(rawData as Record<string, unknown>, fullPath);

  if (getter === undefined || getter === null) return value;

  try {
    switch (typeof getter) {
      case 'object':
        return searchQuery(getter as Record<string, unknown>, value, pointer);

      case 'function':
        return (getter as (v: unknown) => unknown)(value);

      case 'number': {
        const element = (value as unknown[])[getter];
        return pointer ? (element as Record<string, unknown>)[pointer] : element;
      }

      default:
        return (value as Record<string, unknown>)[getter as string];
    }
  } catch (error) {
    if (config.debug) console.error(`Cannot parse value for ${fullPath}.`, { getter, query }, error);
  }
}

export default class Serializer {
  map: Record<string, unknown> = {};
  path = '';
  model: Record<string, unknown>;

  constructor(model: Record<string, unknown>) {
    this.model = model;
  }

  /**
   * This method populates the record's instance with instances of
   * the ModelProperty object, while setting parsed values to the record's
   * __data property, which represents the serialized version of the data
   */
  setProperties(rawData: unknown, record: unknown, options: Record<string, unknown>): void {
    const { path, model } = this;
    const keys = Object.keys(model).filter(key => !RESERVED_KEYS.includes(key));
    const pathPrefix = path ? `${path}.` : '';
    const rec = record as Record<string, unknown>;
    const parsedData = rec.__data as Record<string, unknown>;
    const relatedRecords = rec.__relationships as Record<string, unknown>;

    for (const key of keys) {
      const subPath = options.serialize ? ((this.map as Record<string, unknown>)[key] || key) : key;
      const handler = model[key];
      const data = query(rawData, pathPrefix, subPath);

      // Skip fields not present in the update payload (undefined = not provided)
      if (data === undefined && options.update) continue;

      // Relationship handling
      if (typeof handler === 'function') {
        // Pass relationship key name to handler for pending fulfillment
        const handlerOptions = { ...options, _relationshipKey: key };
        const childRecord = handler(record, data, handlerOptions);

        // hasMany relationships use a getter so format()/toJSON() always read
        // the live registry array instead of a stale snapshot captured at
        // serialization time.  This is critical when child records are created
        // in a later async frame — the belongsTo inverse wiring pushes into
        // the shared registry array, and the getter ensures the parent sees it.
        const isHasMany = (handler as { __relationshipType?: string }).__relationshipType === 'hasMany';

        if (isHasMany) {
          // `childRecord` IS the shared registry array — define a getter that
          // always dereferences through the same array reference.
          const registryArray = childRecord as unknown[];
          Object.defineProperty(rec, key, {
            enumerable: true,
            configurable: true,
            get: () => registryArray,
            set(v: unknown) { relatedRecords[key] = v; }
          });
          Object.defineProperty(relatedRecords, key, {
            enumerable: true,
            configurable: true,
            get: () => registryArray,
            set(v: unknown) { Object.defineProperty(relatedRecords, key, { value: v, writable: true, enumerable: true, configurable: true }); }
          });
        } else {
          rec[key] = childRecord;
          relatedRecords[key] = childRecord;
        }

        continue;
      }

      // Aggregate property handling — use the rawData value, not the aggregate descriptor
      if (isAggregateProperty(handler)) {
        parsedData[key] = data;
        rec[key] = data;
        continue;
      }

      // Direct assignment handling
      if (!isModelProperty(handler)) {
        parsedData[key] = handler;
        rec[key] = handler;
        continue;
      }

      const prop = handler as { value: unknown; ignoreFirstTransform: boolean };

      Object.defineProperty(record, key, {
        enumerable: true,
        configurable: true,
        get: () => prop.value,
        set(newValue: unknown) {
          prop.ignoreFirstTransform = !options.transform;
          prop.value = newValue;
          parsedData[key] = prop.value;
        }
      });

      rec[key] = data;
    }

    if (options.update) return;

    // Serialize computed properties
    for (const [key, getter] of getComputedProperties(this.model)) {
      Object.defineProperty(record, key, {
        enumerable: true,
        get: () => (getter as () => unknown).call(record)
      });
    }

    rec.__serialized = true;
  }

  /**
   * OVERRIDE: This hook allows for data manipulation prior to serialization logic
   */
  normalize(data: unknown): unknown {
    return data;
  }
}

export function getComputedProperties(classInstance: Record<string, unknown>): [string, PropertyDescriptor['get']][] {
  const proto = Object.getPrototypeOf(classInstance);
  if (!proto || proto === Object.prototype) return [];

  return Object.entries(Object.getOwnPropertyDescriptors(proto))
    .filter(([key, descriptor]) => key !== 'constructor' && descriptor.get)
    .map(([key, descriptor]) => [key, descriptor.get]);
}
