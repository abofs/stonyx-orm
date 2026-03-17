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
export { Model, View, Serializer }; // base classes
export { attr, belongsTo, hasMany, createRecord, updateRecord }; // helpers
export { count, avg, sum, min, max }; // aggregate helpers
export { beforeHook, afterHook, clearHook, clearAllHooks } from './hooks.js'; // middleware hooks

// Store API:
// store.get(model, id)   — sync, memory-only
// store.find(model, id)  — async, MySQL for memory:false models
// store.findAll(model)   — async, all records
// store.query(model, conditions) — async, always hits MySQL