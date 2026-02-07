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

/**
 * Middleware-based hooks registry for ORM operations.
 * Unlike event-based hooks, middleware hooks run sequentially and can halt operations.
 */

// Map of "operation:model" -> handler[]
const beforeHooks = new Map();
const afterHooks = new Map();

/**
 * Register a before hook middleware that runs before the operation executes.
 *
 * @param {string} operation - Operation name: 'create', 'update', 'delete', 'get', or 'list'
 * @param {string} model - Model name (e.g., 'user', 'animal')
 * @param {Function} handler - Middleware function (context) => any
 *   - Return undefined to continue to next hook/handler
 *   - Return any value to halt operation (integer = HTTP status, object = response body)
 * @returns {Function} Unsubscribe function
 */
export function beforeHook(operation, model, handler) {
  const key = `${operation}:${model}`;
  if (!beforeHooks.has(key)) {
    beforeHooks.set(key, []);
  }
  beforeHooks.get(key).push(handler);

  // Return unsubscribe function
  return () => {
    const hooks = beforeHooks.get(key);
    if (hooks) {
      const index = hooks.indexOf(handler);
      if (index > -1) hooks.splice(index, 1);
    }
  };
}

/**
 * Register an after hook middleware that runs after the operation completes.
 * After hooks cannot halt operations (they run after completion).
 *
 * @param {string} operation - Operation name
 * @param {string} model - Model name
 * @param {Function} handler - Middleware function (context) => void
 * @returns {Function} Unsubscribe function
 */
export function afterHook(operation, model, handler) {
  const key = `${operation}:${model}`;
  if (!afterHooks.has(key)) {
    afterHooks.set(key, []);
  }
  afterHooks.get(key).push(handler);

  // Return unsubscribe function
  return () => {
    const hooks = afterHooks.get(key);
    if (hooks) {
      const index = hooks.indexOf(handler);
      if (index > -1) hooks.splice(index, 1);
    }
  };
}

/**
 * Get all before hooks for an operation:model combination.
 * @param {string} operation
 * @param {string} model
 * @returns {Function[]}
 */
export function getBeforeHooks(operation, model) {
  const key = `${operation}:${model}`;
  return beforeHooks.get(key) || [];
}

/**
 * Get all after hooks for an operation:model combination.
 * @param {string} operation
 * @param {string} model
 * @returns {Function[]}
 */
export function getAfterHooks(operation, model) {
  const key = `${operation}:${model}`;
  return afterHooks.get(key) || [];
}

/**
 * Clear registered hooks for a specific operation:model.
 *
 * @param {string} operation - Operation name
 * @param {string} model - Model name
 * @param {string} [type] - 'before' or 'after' (if omitted, clears both)
 */
export function clearHook(operation, model, type) {
  const key = `${operation}:${model}`;
  if (!type || type === 'before') {
    beforeHooks.set(key, []);
  }
  if (!type || type === 'after') {
    afterHooks.set(key, []);
  }
}

/**
 * Clear all hooks (useful for testing).
 */
export function clearAllHooks() {
  beforeHooks.clear();
  afterHooks.clear();
}
