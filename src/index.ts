/*
 * Copyright 2025 Stone Costa
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Model from './model.js';
import View from './view.js';
import Serializer from './serializer.js';

import attr from './attr.js';
import belongsTo from './belongs-to.js';
import hasMany from './has-many.js';
import { createRecord, updateRecord } from './manage-record.js';
import { count, avg, sum, min, max } from './aggregates.js';

export { default } from './main.js';
export { store, relationships } from './main.js';
export type { PersistErrorDetail } from './main.js';
export type { AccessContext, AccessFunction, AccessMethod, AccessOperation } from './types/orm-types.js'; // access() contract (#202)
export type { LinkageFilter } from './types/orm-types.js'; // linkage verdict contract (#234)
// The request-scoped linkage-verdict factory (#234). PUBLIC on purpose: the
// README tells a consumer serializing a `Record` outside the REST layer to pass
// their own resolved `linkage` option, and without an exported factory the only
// way to follow that advice is to write a SECOND reading of `access()` in
// consumer code -- the exact "unreviewed second authorization vocabulary" that
// src/access-verdict.ts exists to prevent, reproduced where no reviewer sees it
// drift. Give them the one interpreter instead of an invitation to fork it.
export { createLinkageFilter } from './access-verdict.js';
export { Model, View, Serializer }; // base classes
export { attr, belongsTo, hasMany, createRecord, updateRecord }; // helpers
export { count, avg, sum, min, max }; // aggregate helpers
export { beforeHook, afterHook, clearHook, clearAllHooks } from './hooks.js'; // middleware hooks

// Store API:
// store.get(model, id)   -- sync, memory-only
// store.find(model, id)  -- async, SQL for memory:false models
// store.findAll(model)   -- async, all records
// store.query(model, conditions) -- async, always hits SQL
//
// Data-layer auto-persist (memory + SQL persistence):
// createRecord(model, data)  -- sync, auto-persists to SQL (fire-and-forget)
// updateRecord(record, data) -- sync, auto-persists to SQL (fire-and-forget)
// store.remove(model, id)    -- sync, auto-persists delete to SQL (fire-and-forget)
