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

import BaseModel from './model.js';
import BaseSerializer from './serializer.js';

import Orm, { store, relationships } from './main.js';
import attr from './attr.js';
import belongsTo from './belongs-to.js';
import hasMany from './has-many.js';
import createRecord from './create-record.js';

export default Orm;
export { BaseModel, BaseSerializer }; // base classes
export { attr, belongsTo, hasMany, createRecord, store, relationships }; // helpers