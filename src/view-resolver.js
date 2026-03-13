import Orm, { createRecord, store } from '@stonyx/orm';
import { AggregateProperty } from './aggregates.js';
import { get } from '@stonyx/utils/object';

export default class ViewResolver {
  constructor(viewName) {
    this.viewName = viewName;
  }

  async resolveAll() {
    const orm = Orm.instance;
    const { modelClass: viewClass } = orm.getRecordClasses(this.viewName);

    if (!viewClass) return [];

    const source = viewClass.source;
    if (!source) return [];

    const sourceRecords = await store.findAll(source);
    if (!sourceRecords || sourceRecords.length === 0) {
      return [];
    }

    const resolveMap = viewClass.resolve || {};
    const viewInstance = new viewClass(this.viewName);
    const aggregateFields = {};
    const regularFields = {};

    // Categorize fields on the view instance
    for (const [key, value] of Object.entries(viewInstance)) {
      if (key.startsWith('__')) continue;
      if (key === 'id') continue;

      if (value instanceof AggregateProperty) {
        aggregateFields[key] = value;
      } else if (typeof value !== 'function') {
        // Regular attr or direct value — not a relationship handler
        regularFields[key] = value;
      }
    }

    const groupByField = viewClass.groupBy;

    if (groupByField) {
      return this._resolveGroupBy(sourceRecords, groupByField, aggregateFields, regularFields, resolveMap, viewClass);
    }

    return this._resolvePerRecord(sourceRecords, aggregateFields, regularFields, resolveMap, viewClass);
  }

  _resolvePerRecord(sourceRecords, aggregateFields, regularFields, resolveMap, viewClass) {
    const results = [];

    for (const sourceRecord of sourceRecords) {
      const rawData = { id: sourceRecord.id };

      // Compute aggregate fields from source record's relationships
      for (const [key, aggProp] of Object.entries(aggregateFields)) {
        const relatedRecords = sourceRecord.__relationships?.[aggProp.relationship]
          || sourceRecord[aggProp.relationship];
        const relArray = Array.isArray(relatedRecords) ? relatedRecords : [];
        rawData[key] = aggProp.compute(relArray);
      }

      // Apply resolve map entries
      for (const [key, resolver] of Object.entries(resolveMap)) {
        if (typeof resolver === 'function') {
          rawData[key] = resolver(sourceRecord);
        } else if (typeof resolver === 'string') {
          rawData[key] = get(sourceRecord.__data || sourceRecord, resolver)
            ?? get(sourceRecord, resolver);
        }
      }

      // Map regular attr fields from source record if not already set
      for (const key of Object.keys(regularFields)) {
        if (rawData[key] !== undefined) continue;

        const sourceValue = sourceRecord.__data?.[key] ?? sourceRecord[key];
        if (sourceValue !== undefined) {
          rawData[key] = sourceValue;
        }
      }

      // Set belongsTo source relationship
      const viewInstanceForRel = new viewClass(this.viewName);
      for (const [key, value] of Object.entries(viewInstanceForRel)) {
        if (typeof value === 'function' && key !== 'id') {
          // This is a relationship handler — pass the source record id
          rawData[key] = sourceRecord.id;
        }
      }

      // Clear existing record from store to allow re-resolution
      const viewStore = store.get(this.viewName);
      if (viewStore?.has(rawData.id)) {
        viewStore.delete(rawData.id);
      }

      const record = createRecord(this.viewName, rawData, { isDbRecord: true });
      results.push(record);
    }

    return results;
  }

  _resolveGroupBy(sourceRecords, groupByField, aggregateFields, regularFields, resolveMap, viewClass) {
    // Group source records by the groupBy field value
    const groups = new Map();
    for (const record of sourceRecords) {
      const key = record.__data?.[groupByField] ?? record[groupByField];
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(record);
    }

    const results = [];

    for (const [groupKey, groupRecords] of groups) {
      const rawData = { id: groupKey };

      // Compute aggregate fields
      for (const [key, aggProp] of Object.entries(aggregateFields)) {
        if (aggProp.relationship === undefined) {
          // Field-level aggregate — compute over group records directly
          rawData[key] = aggProp.compute(groupRecords);
        } else {
          // Relationship aggregate — flatten related records across all group members
          const allRelated = [];
          for (const record of groupRecords) {
            const relatedRecords = record.__relationships?.[aggProp.relationship]
              || record[aggProp.relationship];
            if (Array.isArray(relatedRecords)) {
              allRelated.push(...relatedRecords);
            }
          }
          rawData[key] = aggProp.compute(allRelated);
        }
      }

      // Apply resolve map entries — functions receive the group array
      for (const [key, resolver] of Object.entries(resolveMap)) {
        if (typeof resolver === 'function') {
          rawData[key] = resolver(groupRecords);
        } else if (typeof resolver === 'string') {
          // String path — take value from first record in group
          const first = groupRecords[0];
          rawData[key] = get(first.__data || first, resolver)
            ?? get(first, resolver);
        }
      }

      // Map regular attr fields from first record if not already set
      for (const key of Object.keys(regularFields)) {
        if (rawData[key] !== undefined) continue;
        const first = groupRecords[0];
        const sourceValue = first.__data?.[key] ?? first[key];
        if (sourceValue !== undefined) {
          rawData[key] = sourceValue;
        }
      }

      // Clear existing record from store to allow re-resolution
      const viewStore = store.get(this.viewName);
      if (viewStore?.has(rawData.id)) {
        viewStore.delete(rawData.id);
      }

      const record = createRecord(this.viewName, rawData, { isDbRecord: true });
      results.push(record);
    }

    return results;
  }

  async resolveOne(id) {
    const all = await this.resolveAll();
    return all.find(record => {
      return record.id === id || record.id == id;
    });
  }
}
