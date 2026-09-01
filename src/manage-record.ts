import Orm, { store } from '@stonyx/orm';
import OrmRecord from './record.js';
import { getGlobalRegistry, getPendingRegistry, getPendingBelongsToRegistry, getBelongsToRegistry, getHasManyRegistry } from './relationships.js';
import type Serializer from './serializer.js';
import { isOrmRecord, maxNumericId, NO_FREE_ID_ERROR } from './utils.js';

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
  // record it never named.
  //
  // WHAT WIDENING THIS TO `!== undefined` ACTUALLY DOES, measured rather than
  // asserted: `{id: ''}` early-returns, `parseInt('')` NaNs it, and the record
  // lands on the store's `NaN` slot and OVERWRITES whatever is there — #203's
  // own defect class. It does NOT turn access-filter-enforcement-test.ts
  // assertion 44 red; an earlier revision of this comment claimed it did, which
  // converted an unknown into a false assurance. AC6's BOUNDARY assertions are
  // what catch it, and they only do so because they seed the `NaN` slot first.
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

  // ONE COPY of the max-numeric-id reduce, in src/utils.ts. There were three
  // (here, StandaloneDB.create, and the #203 test helper) and `docs/
  // improvements.md`'s WET Code category prescribes the extraction. What that
  // helper must NOT be is `Math.max(...ids)`; the reason is measured and it is
  // documented at the helper rather than duplicated here. Pinned by AC2.
  const maxId = maxNumericId(modelStore);

  // THE OCCUPANCY CHECK RUNS ON THE LANDING KEY, NOT ON THE RAW CANDIDATE, and
  // the difference is a silent data loss rather than a nicety.
  //
  // `createRecord` looks the record up under `rawData.id` (:50) but WRITES it
  // under `record.id` (:69) — the value after the model's declared id transform
  // has run inside `serialize`. When the transform is not the identity those two
  // differ, so a guard written as `storeMap.has(rawData.id)` checks a key the
  // record will never occupy, misses an occupied slot and overwrites it —
  // measured on an `uppercase`-id model: the guard checks `owner-1`, the record
  // lands under `OWNER-1`, store size unchanged, no error. That is
  // abofs/stonyx-orm#205's lookup-key/landing-key divergence reappearing inside
  // #203's own fix, which is why AC4 exists and why `rawData.id` is set to the
  // LANDING key below.
  //
  // THE SCOPE OF THAT CLAIM, stated rather than implied. Setting `rawData.id` to
  // the landing key makes :50 and :69 agree for every IDEMPOTENT id transform —
  // `number`, `float`, `string`, `passthrough`, `uppercase`, `trim`. It does NOT
  // make them agree for `date` or `timestamp`: `transforms.date` returns a NEW
  // object every call and a `Map` keys by identity, so `storeMap.has(landingKey)`
  // is always `false` there and the occupancy check is vacuous. `dev` is broken
  // for those types too — this is not a regression — but no comment here may
  // claim a property it was not measured to have (#212 § AC5).
  //
  // Resolved ONCE, outside the walk: `getIdType` instantiates the model class,
  // so resolving it per candidate would put a model construction on every
  // iteration of a loop that exists to walk past occupied slots.
  const toStoreKey = storeKeyDeriver(modelName);

  // DOES THIS MODEL FILE ITS RECORDS UNDER STRING KEYS? Decided by RUNNING the
  // model's own id transform once, not by matching a type NAME against a list:
  // `Orm.instance.transforms` (main.ts:70) is a public, MUTABLE instance
  // property, so any enumeration of "the string-ish types" written here would be
  // wrong the moment a consumer registers one.
  const stringKeyed = typeof toStoreKey(maxId + 1) === 'string';

  // THE CANDIDATE FOR A STRING-KEYED MODEL IS NOT A BARE NUMBER, and this is
  // abofs/stonyx-orm#209 — which is REOPENED — not aesthetics.
  //
  // `orm-request.ts`'s `coerceId` (:322) resolves a NUMERIC-LOOKING string to a
  // NUMBER on every id-bearing surface, while a model declaring
  // `id = attr('string')` files under the STRING key. So a server-assigned `'1'`
  // produces a record that is created and then NOT ADDRESSABLE. Measured over
  // the route, owner store `{'1': ...}`:
  //
  //   GET    /owners/1       -> 404      (the record exists)
  //   DELETE /owners/1       -> 404
  //   GET    /owners/owner-1 -> 200
  //
  // and `_withHooks` (:1185) hands an after-`create` hook
  // `context.record === undefined` for the same reason. `dev` assigned `'bob1'`,
  // which is not numeric-looking, so `dev` has neither problem: a bare-number
  // candidate would move #209 from "a caller supplied a numeric-looking id" onto
  // the DEFAULT path for every server-assigned create on every string-id model.
  // Prefixing with the model name keeps #209's population exactly as narrow as
  // it already was, without touching the one shared coercion or the assertion
  // that pins #209 open. Pinned by AC3.
  const toCandidate = stringKeyed
    ? (value: number) => `${modelName}-${value}`
    : (value: number) => value;

  // `maxId + 1` is the id AC1 pins: strictly greater than every numeric key
  // present. IT IS NOT ALWAYS AVAILABLE, and that gap was a live denial of
  // service. Float64 has no integer successor at or above 2^53, so
  // `maxId + 1 === maxId` for every `maxId >= 9007199254740992` and `+ 1` inside
  // the walk is a NO-OP there. One record filed under that key — which an
  // unauthenticated `POST {"id":9007199254740992}` puts there, and which reaches
  // even a filter-protected collection through has-many.ts:65 (#207), a channel
  // GATE 0 does not cover — made the walk unable to advance, so it exhausted its
  // budget and threw on EVERY subsequent server-assigned create, permanently,
  // until that record was deleted. Measured over the route: 200, then 500 for
  // every no-id create. `dev` answers 200.
  //
  // So a store holding one adversarial record must not disable its collection.
  // When "above the max" is not a usable strategy the walk RESTARTS FROM 1: the
  // store holds at most `size` keys, so one of `1 .. size + 1` is always free
  // under an injective id transform. Pinned by AC7.
  const start = maxId + 1;
  let landingKey = firstFreeKey(storeMap, toStoreKey, toCandidate, start);

  // THE RESTART, and it is the whole of the ceiling fix. Killing mutation:
  // delete this block -> AC7 goes red (the route answers 409 instead of the
  // created resource).
  if (landingKey === NO_FREE_KEY && start !== 1) {
    landingKey = firstFreeKey(storeMap, toStoreKey, toCandidate, 1);
  }

  if (landingKey === NO_FREE_KEY) {
    // Reachable only with a NON-INJECTIVE id transform — see `firstFreeKey`.
    // `createHandler` matches this message and answers 409 rather than letting it
    // reach express's default handler, which serialises a stack trace with
    // absolute install paths outside NODE_ENV=production (the hazard
    // orm-request.ts:553-558 exists to name). Pinned by AC8.
    throw new Error(`${NO_FREE_ID_ERROR} for model "${modelName}"`);
  }

  rawData.id = landingKey;
}

// Returned instead of a key so that "no key" cannot be confused with a transform
// that legitimately produced `undefined` or `null`.
const NO_FREE_KEY = Symbol('no free store key');

/**
 * The first store key at or above `start` that no record occupies, walking
 * candidate ids upward, or `NO_FREE_KEY` if the walk cannot reach one.
 */
function firstFreeKey(
  storeMap: Map<number | string, unknown>,
  toStoreKey: (value: number | string) => number | string,
  toCandidate: (value: number) => number | string,
  start: number
): number | string | typeof NO_FREE_KEY {
  let candidate = start;
  let landingKey = toStoreKey(toCandidate(candidate));
  let attempts = 0;

  while (storeMap.has(landingKey)) {
    // THE BOUND IS EXACTLY TIGHT, not conservative: this walk tries
    // `storeMap.size + 1` DISTINCT candidates against at most `storeMap.size`
    // occupied keys, so under an injective `toStoreKey` it provably cannot fire.
    // Under a non-injective one it provably terminates — and that is a reachable
    // consumer state rather than a hypothesis: `transforms.boolean`
    // (transforms.ts:4) collapses every candidate onto `true`/`false`, and
    // `Orm.instance.transforms` (main.ts:70) is public and MUTABLE, so a consumer
    // can register an arbitrary non-injective transform and name it as an id
    // type. Without this, a no-id create spins forever inside a synchronous store
    // walk and pins a worker, which is worse than either collision policy. Its
    // EXISTENCE and its THRESHOLD are both pinned by AC8: deleting it makes AC8
    // HANG rather than fail, and weakening it to fire on the first collision
    // makes AC8.1 red.
    if (++attempts > storeMap.size) return NO_FREE_KEY;

    // NOTE FOR ANYONE ADDING A SECOND EXIT HERE. A `candidate + 1 === candidate`
    // float-saturation check was written, measured, and REMOVED: with the
    // restart-from-1 above in place, deleting the saturation check leaves the
    // whole suite green, because the budget reaches the same `NO_FREE_KEY` one
    // pass later and the restart still answers. An unkillable guard in a change
    // whose deliverable is falsifiable coverage is exactly what this story exists
    // to stop shipping. `+ 1` being a no-op at 2^53 costs `size` extra `Map.has`
    // calls on that one path and changes no outcome.
    candidate += 1;
    landingKey = toStoreKey(toCandidate(candidate));
  }

  return landingKey;
}

/**
 * Returns the derivation that maps an id VALUE to the store KEY a record
 * carrying it will actually be filed under — the model's declared id transform,
 * the same one `serialize` runs at createRecord:68 before the `.set` at :69.
 */
function storeKeyDeriver(modelName: string): (value: number | string) => number | string {
  const idType = getIdType(modelName);
  const transform = idType ? Orm.instance?.transforms?.[idType] : undefined;

  // SURVIVOR, RETAINED, with its reachability condition stated rather than left
  // silent — `docs/project-structure.md` § "unkillable code reads as coverage and
  // is not" is the standing rule and it applies outside orm-request.ts too.
  //
  // No mutation in this repo can kill this branch, and that is STRUCTURAL rather
  // than an untested gap: `Model` declares `id = attr('number')` (model.ts:15) so
  // every registered model has an id type; `ModelProperty` refuses a type with no
  // registered transform (model-property.ts:4) so a declared type always
  // resolves; and `getIdType` can therefore only return `undefined` when
  // `getRecordClasses` yields no `modelClass` — in which case `createRecord`
  // throws at :62 a few lines later regardless, so no record is ever filed
  // through this branch.
  //
  // BECOMES REACHABLE if a model can be declared without an `id` property, if a
  // store map can exist for a model with no registered class, or if
  // `createRecord` stops constructing the model class. Kept rather than deleted
  // because the alternative on that path is a `transform is not a function`
  // TypeError, and because identity is exactly what `createRecord` would file
  // under when no transform exists — the two agree, which is the property AC4 is
  // about.
  if (typeof transform !== 'function') return value => value;

  return value => {
    try {
      return transform(value) as number | string;
    } catch {
      // `uppercase` and `trim` (transforms.ts:11-12) call a string method on the
      // value directly, so a NUMERIC candidate throws `value?.toUpperCase is not
      // a function`. On `dev` they never saw one — `lastRecord.id + 1` on a
      // string id is a string — so feeding them a number here would regress a
      // legal, registered id type into an uncaught 500. The retry feeds the
      // string form, which is the shape an id actually arrives in off a JSON body
      // or a URL param. A transform that throws on BOTH shapes still propagates.
      // Pinned by AC9.
      return transform(String(value)) as number | string;
    }
  };
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
