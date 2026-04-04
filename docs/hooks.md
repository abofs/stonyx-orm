# Middleware Hooks System

The ORM provides a powerful middleware-based hook system that allows custom logic before and after CRUD operations. **Before hooks can halt operations** by returning a value.

## Architecture

**Hook Registry**: [src/hooks.js](src/hooks.js) - Stores before/after hooks in Maps
**Integration**: [src/orm-request.js](src/orm-request.js) - `_withHooks()` wrapper executes hooks
**Exports**: [src/index.js](src/index.js) - Exports `beforeHook`, `afterHook`, `clearHook`, `clearAllHooks`

## API

### `beforeHook(operation, model, handler)`

Register a before hook that runs before the operation executes.

```javascript
import { beforeHook } from '@stonyx/orm';

beforeHook('create', 'animal', (context) => {
  // Validate, transform, authorize...
  if (invalid) {
    return 400; // Halt with status code
  }
  // Return undefined to continue
});
```

**Handler return values:**
- `undefined` / no return - Operation continues
- **Any other value** - Halts operation and returns that value:
  - Integer (e.g., `403`) - HTTP status code
  - Object - JSON response body

**Returns:** Unregister function

### `afterHook(operation, model, handler)`

Register an after hook that runs after the operation completes.

```javascript
import { afterHook } from '@stonyx/orm';

afterHook('update', 'animal', (context) => {
  console.log(`Updated animal ${context.record.id}`);
  // After hooks cannot halt (operation already complete)
});
```

**Returns:** Unregister function

### `clearHook(operation, model, [type])`

Clear registered hooks for a specific operation:model.

```javascript
import { clearHook } from '@stonyx/orm';

clearHook('create', 'animal');           // Clear both before and after
clearHook('create', 'animal', 'before'); // Clear only before hooks
clearHook('create', 'animal', 'after');  // Clear only after hooks
```

### `clearAllHooks()`

Clear all registered hooks (useful for testing).

```javascript
import { clearAllHooks } from '@stonyx/orm';

afterEach(() => {
  clearAllHooks();
});
```

## Operations

- `list` - GET collection (`/animals`)
- `get` - GET single record (`/animals/1`)
- `create` - POST new record (`/animals`)
- `update` - PATCH existing record (`/animals/1`)
- `delete` - DELETE record (`/animals/1`)

## Context Object

Each hook receives a context object:

```javascript
{
  model: 'animal',           // Model name
  operation: 'create',       // Operation type
  request,                   // Express request object
  params,                    // URL params (e.g., { id: 5 })
  body,                      // Request body (POST/PATCH)
  query,                     // Query parameters
  state,                     // Request state (includes filter for access control)

  // For update/delete operations:
  oldState,                  // Deep copy of record BEFORE operation

  // For after hooks only:
  response,                  // Handler response
  record,                    // Affected record (create/update/get)
  records,                   // All records (list)
  recordId,                  // Record ID (delete only, since record no longer exists)
}
```

**Notes:**
- `oldState` is captured via `JSON.parse(JSON.stringify())` before operation executes
- For delete operations, `recordId` is available since the record may no longer exist
- `oldState` enables precise field-level change detection

## Implementation Details

**Hook Wrapper** (`src/orm-request.js`):

```javascript
_withHooks(operation, handler) {
  return async (request, state) => {
    const context = { model, operation, request, params, body, query, state };

    // Capture old state for update/delete
    if (operation === 'update' || operation === 'delete') {
      const existingRecord = store.get(this.model, getId(request.params));
      if (existingRecord) {
        context.oldState = JSON.parse(JSON.stringify(existingRecord.__data || existingRecord));
      }
    }

    // Run before hooks sequentially (can halt by returning a value)
    for (const hook of getBeforeHooks(operation, this.model)) {
      const result = await hook(context);
      if (result !== undefined) {
        return result;  // Halt - return status/response
      }
    }

    // Execute main handler
    const response = await handler(request, state);

    // Enrich context for after hooks
    context.response = response;
    context.record = /* fetched from store */;
    context.records = /* for list operations */;
    context.recordId = /* for delete operations */;

    // Run after hooks sequentially
    for (const hook of getAfterHooks(operation, this.model)) {
      await hook(context);
    }

    return response;
  };
}
```

## Usage Examples

### Validation (Halting)

```javascript
beforeHook('create', 'animal', (context) => {
  const { age } = context.body.data.attributes;
  if (age < 0) {
    return 400; // Halt with Bad Request
  }
});
```

### Custom Error Response

```javascript
beforeHook('delete', 'animal', (context) => {
  const animal = store.get('animal', context.params.id);
  if (animal.protected) {
    return { errors: [{ detail: 'Cannot delete protected animals' }] };
  }
});
```

### Change Detection with oldState

```javascript
afterHook('update', 'animal', (context) => {
  if (!context.oldState) return;

  // Detect specific field changes
  if (context.oldState.owner !== context.record.owner) {
    console.log(`Owner changed from ${context.oldState.owner} to ${context.record.owner}`);
  }
});
```

### Audit Logging

```javascript
afterHook('update', 'animal', async (context) => {
  const changes = {};
  if (context.oldState) {
    for (const [key, newValue] of Object.entries(context.record.__data)) {
      if (context.oldState[key] !== newValue) {
        changes[key] = { from: context.oldState[key], to: newValue };
      }
    }
  }

  await auditLog.create({
    operation: 'update',
    model: context.model,
    recordId: context.record.id,
    changes // { age: { from: 2, to: 3 } }
  });
});
```

### Delete Auditing

```javascript
afterHook('delete', 'animal', async (context) => {
  await auditLog.create({
    operation: 'delete',
    model: context.model,
    recordId: context.recordId,
    deletedData: context.oldState // Full snapshot
  });
});
```

## Key Differences from Event-Based System

| Feature | Event-Based (Old) | Middleware-Based (Current) |
|---------|-------------------|---------------------------|
| Execution | Parallel (fire-and-forget) | Sequential |
| Can halt operation | No | Yes (return any value) |
| Error handling | Isolated (logged) | Propagated (halts operation) |
| Middleware order | Not guaranteed | Registration order |
| Context modification | Not reliable | Reliable (sequential) |
| API | `subscribe('before:create:animal')` | `beforeHook('create', 'animal')` |

## Testing

**Location**: `test/integration/orm-test.js`
**Coverage**: Comprehensive hook tests including:
- Before/after hooks for all operations
- Halting with status codes
- Halting with custom response objects
- Sequential execution order
- Unsubscribe functionality
- clearHook functionality
