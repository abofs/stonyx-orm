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

/** Context object passed to before/after hook handlers. */
export interface HookContext {
  /** Model name (e.g. 'user', 'animal'). */
  model: string;
  /** Operation name: 'create', 'update', 'delete', 'get', or 'list'. */
  operation: string;
  /** The incoming HTTP request object. */
  request?: unknown;
  /** URL route parameters (e.g. { id: '42' }). */
  params?: Record<string, string>;
  /** Parsed request body for create/update operations. */
  body?: Record<string, unknown>;
  /** URL query string parameters. */
  query?: Record<string, string>;
  /** Mutable state bag shared across hooks within a single request. */
  state?: Record<string, unknown>;
  /** Previous record state (available in update hooks). */
  oldState?: unknown;
  /** Target record ID for single-record operations. */
  recordId?: string | number;
  /** Response data (available in after hooks). */
  response?: unknown;
  /** The affected record (available in after hooks for create/update/delete). */
  record?: unknown;
  /** The affected records (available in after hooks for list operations). */
  records?: unknown[];
  [key: string]: unknown;
}

type HookHandler = (context: HookContext) => unknown | Promise<unknown>;

// Map of "operation:model" -> handler[]
const beforeHooks: Map<string, HookHandler[]> = new Map();
const afterHooks: Map<string, HookHandler[]> = new Map();

/**
 * Register a before hook middleware that runs before the operation executes.
 *
 * @param operation - Operation name: 'create', 'update', 'delete', 'get', or 'list'
 * @param model - Model name (e.g., 'user', 'animal')
 * @param handler - Middleware function (context) => any
 *   - Return undefined to continue to next hook/handler
 *   - Return any value to halt operation (integer = HTTP status, object = response body)
 * @returns Unsubscribe function
 */
export function beforeHook(operation: string, model: string, handler: HookHandler): () => void {
  const key = `${operation}:${model}`;
  if (!beforeHooks.has(key)) {
    beforeHooks.set(key, []);
  }
  const hooks = beforeHooks.get(key);
  if (hooks) hooks.push(handler);

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
 * @param operation - Operation name
 * @param model - Model name
 * @param handler - Middleware function (context) => void
 * @returns Unsubscribe function
 */
export function afterHook(operation: string, model: string, handler: HookHandler): () => void {
  const key = `${operation}:${model}`;
  if (!afterHooks.has(key)) {
    afterHooks.set(key, []);
  }
  const hooks = afterHooks.get(key);
  if (hooks) hooks.push(handler);

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
 */
export function getBeforeHooks(operation: string, model: string): HookHandler[] {
  const key = `${operation}:${model}`;
  return beforeHooks.get(key) || [];
}

/**
 * Get all after hooks for an operation:model combination.
 */
export function getAfterHooks(operation: string, model: string): HookHandler[] {
  const key = `${operation}:${model}`;
  return afterHooks.get(key) || [];
}

/**
 * Clear registered hooks for a specific operation:model.
 *
 * @param operation - Operation name
 * @param model - Model name
 * @param type - 'before' or 'after' (if omitted, clears both)
 */
export function clearHook(operation: string, model: string, type?: 'before' | 'after'): void {
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
export function clearAllHooks(): void {
  beforeHooks.clear();
  afterHooks.clear();
}
