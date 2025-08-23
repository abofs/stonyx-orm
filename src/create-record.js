import Orm, { store } from '@stonyx/orm';
import Record from './record.js';

export default function createRecord(modelName, rawData={}) {
  const orm = Orm.instance;

  if (!orm.initialized) throw new Error('ORM is not ready');

  const modelStore = store.get(modelName);

  if (modelStore.has(rawData.id)) return modelStore.get(rawData.id);

  const { modelClass, serializerClass } = orm.getRecordClasses(modelName);

  if (!modelClass) throw new Error(`A model named '${modelName}' does not exist`);

  const model = new modelClass(modelName);
  const serializer = new serializerClass(model);
  const record = new Record(model, serializer);

  record.serialize(rawData);
  modelStore.set(record.id, record);
  
  return record;
}