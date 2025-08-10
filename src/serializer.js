import config from 'stonyx/config';
import { makeArray } from '@stonyx/utils/object';
import { get, getComputedProperties } from '@stonyx/orm/utils';

const RESERVED_KEYS = ['__name'];

function searchQuery(query, array, key) {
  const result = makeArray(array).find(item => {
    for (const [ prop, value ] of Object.entries(query)) {
      if (item[prop] !== value) return false;

      return true;
    }
  });

  if (!result) return null;
  if (key) return result[key];

  return result;
}

function query(rawData, pathPrefix, subPath) {
  if (!rawData) return null;

  const [ path, getter, pointer ] = makeArray(subPath);
  const fullPath = `${pathPrefix}${path}`;
  const value = get(rawData, fullPath);

  if (getter === undefined || getter === null) return value;

  try {
    switch(typeof getter) {
      case 'object':
        return searchQuery(getter, value, pointer);

      case 'function':
        return getter(value);

      case 'number':
        const element = value[getter];
        return pointer ? element[pointer] : element;

      default: 
        return value[getter];
    }
  } catch (error) {
    if (config.debug) console.error(`Cannot parse value for ${fullPath}.`, { getter, query }, error);
  }
}

export default class BaseSerializer {
  map = {};
  path = '';

  constructor(model) {
    this.model = model;
  }

  /**
   * This method populates the record's instance with instances of
   * the ModelProperty object, while setting parsed values to the record's
   * __data property, which represents the serialized version of the data
   */
  setProperties(rawData, record) {
    const { path, model } = this;
    const keys = Object.keys(model).filter(key => !RESERVED_KEYS.includes(key));
    const pathPrefix = path ? `${path}.` : '';
    const { __data:parsedData } = record;
    const { postTransform } = model;

    for (const key of keys) {
      const subPath = this.map[key] || key;
      const handler = model[key];
      const data = query(rawData, pathPrefix, subPath);

      // Relationship handling
      if (typeof handler === 'function') {
        const childRecord = handler(data);
        record[key] = childRecord
        parsedData[key] = Array.isArray(childRecord) 
          ? childRecord.map(record => record.serialize())
          : childRecord.serialize();

        continue;
      }

      // Direct assignment handling
      if (handler?.constructor?.name !== 'ModelProperty') {
        parsedData[key] = handler;
        record[key] = handler;
        continue;
      }

      // We access modelProperty.value twice due to getter/setter in ModelProperty class
      handler.value = data;
      let transformedValue = handler.value;

      if (postTransform) transformedValue = postTransform(transformedValue);

      parsedData[key] = transformedValue;
      record[key] = handler;
    }

    // Serialize computed properties
    for (const [key, method] of getComputedProperties(this.model)) {
      const value = method.bind(parsedData)();
      
      parsedData[key] = value;
      record[key] = value;
    }

    record.__serialized = true;
  }

  /**
   * OVERRIDE: This hook allows for data manipulation prior to serialization logic
   */
  normalize(data) {
    return data;
  }
}
