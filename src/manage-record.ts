import Orm, { store } from '@stonyx/orm';
import OrmRecord from './record.js';
import { getGlobalRegistry, getPendingRegistry, getPendingBelongsToRegistry, getBelongsToRegistry, getHasManyRegistry } from './relationships.js';
import type Serializer from './serializer.js';
import { isOrmRecord } from './utils.js';

interface CreateRecordOptions {
  isDbRecord?: boolean;
  serialize?: boolean;
  transform?: boolean;
  update?: boolean;
  _skipAutoPersist?: boolean;
  [key: string]: unknown;
}

interface PendingBelongsToEntry {
  sourceRecord: OrmRecord;
  sourceModelName: string;
  relationshipKey: string;
  relationshipId: unknown;
}

const defaultOptions: CreateRecordOptions = {
  isDbRecord: false,
  serialize: true,
  transform: true
};

let pendingIdCounter = 0;

export function createRecord(modelName: string, rawData: { [key: string]: unknown } = {}, userOptions: CreateRecordOptions = {}): OrmRecord {
  const orm = Orm.instance;
  const { initialized } = Orm;
  const options = { ...defaultOptions, ...userOptions };

  if (!initialized && !options.isDbRecord) throw new Error('ORM is not ready');

  // Guard: read-only views cannot have records created directly
  if (orm?.isView?.(modelName) && !options.isDbRecord) {
    throw new Error(`Cannot create records for read-only view '${modelName}'`);
  }

  const modelStore = store.get(modelName);
  const globalRelationships = getGlobalRegistry();
  const pendingRelationships = getPendingRegistry();

  if (!modelStore) throw new Error(`Model store for '${modelName}' is not registered. Ensure the model is defined before creating records.`);

  assignRecordId(modelName, rawData);
  const existingRecord = modelStore.get(rawData.id as number | string);

  if (existingRecord instanceof OrmRecord) {
    // Update the existing record with new data so the last entry wins
    updateRecord(existingRecord, rawData, { ...options, update: true });
    return existingRecord;
  }

  const recordClasses = orm.getRecordClasses(modelName);
  const modelClass = recordClasses.modelClass as (new (name: string) => { __name: string; [key: string]: unknown }) | undefined;
  const serializerClass = recordClasses.serializerClass as new (model: { [key: string]: unknown }) => Serializer;

  if (!modelClass) throw new Error(`A model named '${modelName}' does not exist`);

  const model = new modelClass(modelName);
  const serializer = new serializerClass(model);
  const record = new OrmRecord(model, serializer);

  record.serialize(rawData, options);
  modelStore.set(record.id as number | string, record);

  // populate global hasMany relationships
  const globalHasMany = globalRelationships.get(modelName);
  if (globalHasMany) for (const relationship of globalHasMany) relationship.push(record);

  // populate pending hasMany relationships and clear the queue
  const pendingHasMany = pendingRelationships.get(modelName)?.get(record.id);
  if (pendingHasMany) {
    for (const relationship of pendingHasMany) relationship.push(record);
    pendingHasMany.splice(0);
  }

  // FK-based inverse hasMany wiring — when a child record is created with a
  // foreign-key field (e.g. `owner: 'owner-1'` on an animal), find any parent
  // whose hasMany registry targets this model and push the child into the
  // parent's shared array.  This covers edge cases where the child is created
  // in a separate async frame without a belongsTo handler firing.
  const hasManyReg = getHasManyRegistry();
  if (hasManyReg) {
    for (const [parentModelName, targetMap] of hasManyReg) {
      const childArrayMap = targetMap.get(modelName);
      if (!childArrayMap) continue;

      // Check if rawData contains a FK field matching the parent model name
      const fkValue = rawData[parentModelName];
      if (fkValue === undefined || fkValue === null) continue;

      const parentArray = childArrayMap.get(fkValue);
      if (parentArray && !parentArray.includes(record)) {
        parentArray.push(record);
      }
    }
  }

  // Fulfill pending belongsTo relationships
  const pendingBelongsToQueue = getPendingBelongsToRegistry();
  const pendingBelongsToRaw = pendingBelongsToQueue.get(modelName)?.get(record.id);
  const pendingBelongsTo = Array.isArray(pendingBelongsToRaw) ? pendingBelongsToRaw as PendingBelongsToEntry[] : undefined;

  if (pendingBelongsTo) {
    const belongsToReg = getBelongsToRegistry();
    const pendingHasManyReg = getHasManyRegistry();

    for (const { sourceRecord, sourceModelName, relationshipKey, relationshipId } of pendingBelongsTo) {
      // Update the belongsTo relationship on the source record
      sourceRecord.__relationships[relationshipKey] = record;
      sourceRecord[relationshipKey] = record; // Also update the direct property

      // Update the belongsTo relationship registry
      const sourceModelReg = belongsToReg.get(sourceModelName);
      if (sourceModelReg) {
        const targetModelReg = sourceModelReg.get(modelName);
        if (targetModelReg) {
          targetModelReg.set(relationshipId, record);
        }
      }

      // Wire inverse hasMany if it exists
      const inverseHasMany = pendingHasManyReg.get(modelName)?.get(sourceModelName)?.get(record.id);

      if (inverseHasMany && !inverseHasMany.includes(sourceRecord)) {
        inverseHasMany.push(sourceRecord);
      }
    }

    // Clear the pending queue
    pendingBelongsTo.length = 0;
  }

  // Auto-persist to SQL — skip for DB loads (isDbRecord) and relationship resolution (_relationshipKey)
  const shouldPersist = orm?.sqlDb && !options.isDbRecord && !userOptions._relationshipKey && !options._skipAutoPersist;
  if (shouldPersist) {
    // Capture ID before persist — SQL adapters re-key pending IDs to real DB IDs,
    // but relationship registries were keyed with this original ID
    const registryId = record.id;
    const response = { data: { id: record.id } };
    orm!.sqlDb!.persist('create', modelName, { rawData }, response)
      .catch((err: unknown) => {
        orm!.emitPersistError({
          operation: 'create',
          modelName,
          recordId: record.id,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      })
      .finally(() => {
        // Evict non-memory records after persist to prevent unbounded heap growth (stonyx#81)
        if (store._memoryResolver && !store._memoryResolver(modelName)) {
          store.evictRecord(modelName, record.id, registryId);
        }
      });
  }

  return record;
}

export function updateRecord(record: OrmRecord, rawData: unknown, userOptions: CreateRecordOptions = {}): void {
  if (!rawData) throw new Error('rawData must be passed in to updateRecord call');

  // Guard: read-only views cannot be updated
  const modelName = record?.__model?.__name;
  if (modelName && Orm.instance?.isView?.(modelName)) {
    throw new Error(`Cannot update records for read-only view '${modelName}'`);
  }

  const options = { ...defaultOptions, ...userOptions, update: true };

  // Capture old state before update for SQL diff
  const oldState = record.__data ? JSON.parse(JSON.stringify(record.__data)) : {};

  record.serialize(rawData, options);

  // Auto-persist to SQL — skip for DB loads (isDbRecord) and relationship resolution (_relationshipKey)
  const orm = Orm.instance;
  const shouldPersist = orm?.sqlDb && !options.isDbRecord && !userOptions._relationshipKey && !options._skipAutoPersist;
  if (shouldPersist && modelName) {
    orm!.sqlDb!.persist('update', modelName, { record, oldState }, {}).catch((err: unknown) => {
      orm!.emitPersistError({
        operation: 'update',
        modelName,
        recordId: record.id,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    });
  }
}

/**
 * gets the next available id, based on the HIGHEST id present.
 *
 * In MySQL mode with numeric IDs, assigns a temporary pending ID.
 * MySQL's AUTO_INCREMENT provides the real ID after INSERT.
 *
 * ---------------------------------------------------------------------------
 * WAS: `Array.from(storeMap.values()).at(-1).id + 1` — the LAST INSERTED id,
 * not the maximum (abofs/stonyx-orm#203). The store is a Map, so insertion
 * order stops being ascending the moment a record is deleted and recreated, a
 * db.json is written out of order, a directory-mode store is read back in file
 * order, or a caller POSTs a high id and then a low one. After that, every
 * server-assigned id is one that is ALREADY TAKEN — and `createRecord`'s
 * last-entry-wins branch then overwrites that record IN PLACE and answers 200.
 * No error, no 409, and the store's size does not change. That is the whole
 * defect, and it is reachable from a create with NO id at all, which is the
 * most ordinary write a consumer performs.
 *
 * Covered by test/unit/assign-record-id-test.ts. Note for anyone changing this
 * function: before that file existed, the whole suite scored 951/0 both on the
 * defect and on a naive `Math.max` fix that introduced a second one. A green
 * suite is not evidence here; those assertions are.
 * ---------------------------------------------------------------------------
 */
function assignRecordId(modelName: string, rawData: { [key: string]: unknown }): void {
  // PRESENCE, not truthiness. `0` is a legal value for an `attr('number')` id,
  // and `if (rawData.id) return` silently reassigned it, handing the caller back
  // a different record than the one it named (#203).
  //
  // `''` is deliberately NOT honoured here and this is not an oversight: it is
  // the one string that means "no id". `parseInt('')` is `NaN`, a record CAN be
  // held under the key `NaN`, and orm-request.ts's body-id normalisation relies
  // on `''` staying absent — otherwise `POST {"id":""}` answers 409 against a
  // record it never named. Pinned by test/unit/assign-record-id-test.ts (AC6's
  // BOUNDARY assertions) and by access-filter-enforcement-test.ts assertion 44.
  // Widening this to `!== undefined` breaks both.
  if (rawData.id || rawData.id === 0) return;

  // In SQL mode with numeric IDs, defer to database auto-increment.
  // Use unique negative integers — they survive the number transform (parseInt preserves negatives)
  // and avoid NaN store-key collisions that string pending IDs caused.
  //
  // This early return is ABOVE the max computation on purpose: a pending
  // negative must never be a candidate for, or be perturbed by, the max path.
  // Pinned directly (AC5.3) rather than by asserting the max is unaffected —
  // that assertion could not have failed, because nothing negative ever reaches
  // the code below.
  if (Orm.instance?.sqlDb && !isStringIdModel(modelName)) {
    rawData.id = -(++pendingIdCounter);
    rawData.__pendingSqlId = true;
    return;
  }

  const storeMap = store.get(modelName);
  if (!storeMap) throw new Error(`Cannot assign record ID: model "${modelName}" not found in store`);
  const modelStore = Array.from(storeMap.values()).filter(isOrmRecord);

  // The shape of src/standalone-db.ts:134-137, and it is chosen over
  // `Math.max(...ids)` for a reason that is measurable rather than stylistic:
  // a store CAN hold a record under the key `NaN` (`{id: '   '}` is truthy, so
  // it survives the guard above and NaNs in the number transform — that is the
  // state access-filter-enforcement-test.ts assertion 44 constructs). `Math.max`
  // returns `NaN` if any operand is `NaN`, so it would assign `NaN`, land on
  // that slot and overwrite it — exactly the defect being fixed, in a new
  // disguise. This reduce cannot: non-numbers are skipped, and `NaN > max` is
  // `false`. Pinned by AC2.
  const maxId = modelStore.reduce((max: number, record) => {
    const recordId = record.id as unknown;

    return typeof recordId === 'number' && recordId > max ? recordId : max;
  }, 0);

  // THE OCCUPANCY CHECK RUNS ON THE LANDING KEY, NOT ON THE RAW CANDIDATE, and
  // the difference is a silent data loss rather than a nicety.
  //
  // `createRecord` looks the record up under `rawData.id` (:50) but WRITES it
  // under `record.id` (:69) — the value after the model's declared id transform
  // has run inside `serialize`. On a string-id model those two differ: the
  // number `1` is looked up, the record lands under the string `'1'`. A guard
  // written as `storeMap.has(rawData.id)` therefore checks a key the record will
  // never occupy, misses an occupied slot and overwrites it — measured: owner
  // '1' age 55 -> 9, store size unchanged, no error. That is abofs/stonyx-orm
  // #205's lookup-key/landing-key divergence reappearing inside #203's own fix,
  // which is why AC4 exists and why `rawData.id` is set to the LANDING key
  // below: it makes :50 and :69 agree by construction.
  //
  // Termination: with an injective id transform at most `storeMap.size`
  // candidates can be occupied. A NON-injective id type would otherwise spin
  // forever, so the loop is bounded and exits with a defined error the route can
  // report instead of hanging the request.
  //
  // Resolved ONCE, outside the loop: `getIdType` instantiates the model class,
  // so resolving it per candidate would put a model construction on every
  // iteration of a loop that exists to walk past occupied slots.
  const toStoreKey = storeKeyDeriver(modelName);

  let candidate = maxId + 1;
  let landingKey = toStoreKey(candidate);
  let attempts = 0;

  while (storeMap.has(landingKey)) {
    if (++attempts > storeMap.size) {
      throw new Error(`Cannot assign record ID: no free id available for model "${modelName}"`);
    }

    candidate += 1;
    landingKey = toStoreKey(candidate);
  }

  rawData.id = landingKey;
}

/**
 * Returns the derivation that maps an id VALUE to the store KEY a record
 * carrying it will actually be filed under — the model's declared id transform,
 * the same one `serialize` runs at createRecord:68 before the `.set` at :69.
 */
function storeKeyDeriver(modelName: string): (value: number) => number | string {
  const idType = getIdType(modelName);
  const transform = idType ? Orm.instance?.transforms?.[idType] : undefined;

  if (typeof transform !== 'function') return value => value;

  return value => transform(value) as number | string;
}

function getIdType(modelName: string): string | undefined {
  const modelClass = Orm.instance?.getRecordClasses(modelName).modelClass as (new (name: string) => { [key: string]: unknown }) | undefined;
  if (!modelClass) return undefined;

  const model = new modelClass(modelName);

  return (model.id as { type?: string } | undefined)?.type;
}

function isStringIdModel(modelName: string): boolean {
  return getIdType(modelName) === 'string';
}
