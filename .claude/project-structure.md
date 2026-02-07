# Stonyx-ORM Guide for Claude

## Project Overview

**stonyx-orm** is a lightweight Object-Relational Mapping (ORM) library designed specifically for the Stonyx framework. It provides structured data modeling, relationship management, serialization, and persistence to JSON files, with optional REST API integration.

## Core Problem It Solves

1. **Data Modeling**: Clean, type-safe model definitions with attributes and relationships
2. **Data Serialization**: Transforms messy third-party data into structured model instances
3. **Relationship Management**: Automatic bidirectional relationships (hasMany, belongsTo)
4. **Data Persistence**: File-based JSON storage with auto-save
5. **REST API Generation**: Auto-generated RESTful endpoints with access control
6. **Data Transformation**: Custom type conversion and formatting
7. **Middleware Hooks**: Before/after hooks for all CRUD operations with halting capability

---

## Architecture Overview

### Key Components

1. **Orm** ([src/main.js](src/main.js)) - Singleton that initializes and manages the entire system
2. **Store** ([src/store.js](src/store.js)) - In-memory storage (nested Maps: `Map<modelName, Map<recordId, record>>`)
3. **Model** ([src/model.js](src/model.js)) - Base class for all models
4. **Record** ([src/record.js](src/record.js)) - Individual model instances
5. **Serializer** ([src/serializer.js](src/serializer.js)) - Maps raw data to model format
6. **DB** ([src/db.js](src/db.js)) - JSON file persistence layer
7. **Relationships** ([src/has-many.js](src/has-many.js), [src/belongs-to.js](src/belongs-to.js)) - Relationship handlers
8. **Include Parser** ([src/include-parser.js](src/include-parser.js)) - Parses include query params
9. **Include Collector** ([src/include-collector.js](src/include-collector.js)) - Collects and deduplicates included records
10. **Hooks** ([src/hooks.js](src/hooks.js)) - Middleware-based hook registry for CRUD lifecycle

### Project Structure

```
stonyx-orm/
├── src/
│   ├── index.js                  # Main exports (includes hook functions)
│   ├── main.js                   # Orm class
│   ├── model.js                  # Base Model
│   ├── record.js                 # Record instances
│   ├── serializer.js             # Base Serializer
│   ├── store.js                  # In-memory storage
│   ├── db.js                     # JSON persistence
│   ├── attr.js                   # Attribute helper (Proxy-based)
│   ├── has-many.js               # One-to-many relationships
│   ├── belongs-to.js             # Many-to-one relationships
│   ├── relationships.js          # Relationship registry
│   ├── manage-record.js          # createRecord/updateRecord
│   ├── model-property.js         # Transform handler
│   ├── transforms.js             # Built-in transforms
│   ├── hooks.js                  # Middleware hook registry
│   ├── setup-rest-server.js      # REST integration
│   ├── orm-request.js            # CRUD request handler with hooks
│   └── meta-request.js           # Meta endpoint (dev only)
├── config/
│   └── environment.js            # Default configuration
├── test/
│   ├── integration/              # Integration tests
│   ├── unit/                     # Unit tests
│   └── sample/                   # Test fixtures
│       ├── models/               # Example models
│       ├── serializers/          # Example serializers
│       ├── transforms/           # Custom transforms
│       ├── access/               # Access control
│       ├── db-schema.js          # DB schema
│       └── payload.js            # Test data
└── package.json
```

---

## Usage Patterns

### 1. Model Definition

Models extend `Model` and use decorators for attributes and relationships:

```javascript
// test/sample/models/animal.js
import { Model, attr, belongsTo, hasMany } from '@stonyx/orm';

export default class AnimalModel extends Model {
  // Attributes with type transforms
  type = attr('animal');      // Custom transform
  age = attr('number');       // Built-in transform
  size = attr('string');

  // Relationships
  owner = belongsTo('owner'); // Many-to-one
  traits = hasMany('trait');  // One-to-many

  // Computed properties
  get tag() {
    return `${this.owner.id}'s ${this.size} animal`;
  }
}
```

**Key Points:**
- Use `attr(type)` for simple attributes
- Use `belongsTo(modelName)` for many-to-one
- Use `hasMany(modelName)` for one-to-many
- Getters work as computed properties
- Relationships auto-establish bidirectionally

### 2. Serializers (Data Transformation)

Serializers map raw data paths to model properties:

```javascript
// test/sample/serializers/animal.js
import { Serializer } from '@stonyx/orm';

export default class AnimalSerializer extends Serializer {
  map = {
    // Nested path mapping
    age: 'details.age',
    size: 'details.c',
    owner: 'details.location.owner',

    // Custom transformation function
    traits: ['details', ({ x:color }) => {
      const traits = [{ id: 1, type: 'habitat', value: 'farm' }];
      if (color) traits.push({ id: 2, type: 'color', value: color });
      return traits;
    }]
  }
}
```

**Key Points:**
- `map` object defines field mappings
- Supports nested paths (`'details.age'`)
- Custom functions for complex transformations
- Handlers receive raw data subset

### 3. Custom Transforms

Transforms convert data types:

```javascript
// test/sample/transforms/animal.js
const codeEnumMap = { 'dog': 1, 'cat': 2, 'bird': 3 };

export default function(value) {
  return codeEnumMap[value] || 0;
}
```

**Built-in Transforms:**
- Type: `boolean`, `number`, `float`, `string`, `date`, `timestamp`
- Math: `round`, `ceil`, `floor`
- String: `trim`, `uppercase`
- Utility: `passthrough`

### 4. CRUD Operations

```javascript
import { createRecord, updateRecord, store } from '@stonyx/orm';

// Create
createRecord('owner', { id: 'bob', age: 30 });

// Read
const owner = store.get('owner', 'bob');
const allOwners = store.get('owner');

// Update
updateRecord(owner, { age: 31 });
// Or direct: owner.age = 31;

// Delete
store.remove('owner', 'bob');
```

### 5. Database Schema

The DB schema is a Model defining top-level collections:

```javascript
// test/sample/db-schema.js
import { Model, hasMany } from '@stonyx/orm';

export default class DBModel extends Model {
  owners = hasMany('owner');
  animals = hasMany('animal');
  traits = hasMany('trait');
}
```

### 6. Persistence

```javascript
import Orm from '@stonyx/orm';

// Save to file
await Orm.db.save();

// Data auto-serializes to JSON file
// Reload using createRecord with serialize:false, transform:false
```

### 7. Access Control

```javascript
// test/sample/access/global-access.js
export default class GlobalAccess {
  models = ['owner', 'animal']; // or '*' for all

  access(request) {
    // Deny specific access
    if (request.url.endsWith('/owner/angela')) return false;

    // Filter collections
    if (request.url.endsWith('/owner')) {
      return record => record.id !== 'angela';
    }

    // Grant CRUD permissions
    return ['read', 'create', 'update', 'delete'];
  }
}
```

### 8. REST API (Auto-generated)

```javascript
// Endpoints auto-generated for models:
// GET    /owners          - List all
// GET    /owners/:id       - Get one
// POST   /animals          - Create
// PATCH  /animals/:id      - Update
// DELETE /animals/:id      - Delete
```

### 9. Include Parameter (Sideloading)

GET endpoints support sideloading related records with **nested relationship traversal**:

```javascript
// Single-level includes
GET /animals/1?include=owner,traits

// Nested includes (NEW!)
GET /animals/1?include=owner.pets,owner.company

// Deep nesting (3+ levels)
GET /scenes/e001-s001?include=slides.dialogue.character

// Response structure (unchanged)
{
  data: { type: 'animal', id: 1, attributes: {...}, relationships: {...} },
  included: [
    { type: 'owner', id: 'angela', ... },
    { type: 'animal', id: 7, ... },    // owner's other pets
    { type: 'animal', id: 11, ... },   // owner's other pets
    { type: 'company', id: 'acme', ... } // owner's company (if requested)
  ]
}
```

**How Nested Includes Work:**
1. Query param parsed into path segments: `owner.pets` → `[['owner'], ['owner', 'pets'], ['traits']]`
2. `traverseIncludePath()` recursively traverses relationships depth-first
3. Deduplication still by type+id (no duplicates in included array)
4. Gracefully handles null/missing relationships at any depth
5. Each included record gets full `toJSON()` representation

**Key Functions:**
- `parseInclude()` - Splits comma-separated includes and parses nested paths
- `traverseIncludePath()` - Recursively traverses relationship paths
- `collectIncludedRecords()` - Orchestrates traversal and deduplication
- All implemented in [src/orm-request.js](src/orm-request.js)

---

## Configuration

Located in [config/environment.js](config/environment.js), overridable via environment variables:

```javascript
config.orm = {
  paths: {
    model: './models',
    serializer: './serializers',
    transform: './transforms',
    access: './access'
  },
  db: {
    autosave: 'false',
    file: 'db.json',
    saveInterval: 3600,
    schema: './config/db-schema.js'
  },
  restServer: {
    enabled: 'true',
    route: '/'
  }
}
```

---

## Design Patterns

1. **Singleton**: Orm, Store, DB classes
2. **Proxy**: `attr()` uses Proxies for type-safe access
3. **Registry**: Relationships in nested Maps
4. **Factory**: `createRecord()` function
5. **Observer**: Auto-save via Cron
6. **Middleware**: Hook system with halting capability
7. **Convention over Configuration**: Auto-discovery by naming

**Naming Conventions:**
- Models: `{PascalCase}Model` (e.g., `AnimalModel`)
- Serializers: `{PascalCase}Serializer` (e.g., `AnimalSerializer`)
- Transforms: Original filename (e.g., `animal.js`)

---

## Testing

**Test Runner**: QUnit with bootstrap
**Bootstrap**: [stonyx-bootstrap.cjs](stonyx-bootstrap.cjs) - Configures paths for test environment

**Test Structure:**
- **Integration**: [test/integration/orm-test.js](test/integration/orm-test.js) - Full pipeline test
- **Unit**: [test/unit/transforms/](test/unit/transforms/) - Transform tests
- **Sample**: [test/sample/](test/sample/) - Test fixtures

**Key Test Data:**
- [test/sample/payload.js](test/sample/payload.js) - Raw vs serialized data
- Demonstrates transformation from messy external data to clean models

---

## Common Workflows

### Making Updates to Models

1. Read existing model in [test/sample/models/](test/sample/models/)
2. Understand attribute types and relationships
3. Check if serializer exists in [test/sample/serializers/](test/sample/serializers/)
4. Update model definition
5. Update serializer if data mapping changes
6. Run tests: `npm test`

### Adding New Features

1. Check [src/index.js](src/index.js) for exports
2. Understand Store pattern in [src/store.js](src/store.js)
3. Review Record lifecycle in [src/record.js](src/record.js)
4. Add feature following existing patterns
5. Update integration tests

### Debugging Issues

1. Check Store contents: `store.get(modelName)`
2. Verify relationships: `relationships.registry`
3. Test serialization: Create record and inspect `record.__data`
4. Check transform application in [src/model-property.js](src/model-property.js)
5. Review test fixtures for expected behavior

---

## Middleware Hooks System

The ORM provides a powerful middleware-based hook system that allows custom logic before and after CRUD operations. **Before hooks can halt operations** by returning a value.

### Architecture

**Hook Registry**: [src/hooks.js](src/hooks.js) - Stores before/after hooks in Maps
**Integration**: [src/orm-request.js](src/orm-request.js) - `_withHooks()` wrapper executes hooks
**Exports**: [src/index.js](src/index.js) - Exports `beforeHook`, `afterHook`, `clearHook`, `clearAllHooks`

### API

#### `beforeHook(operation, model, handler)`

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

#### `afterHook(operation, model, handler)`

Register an after hook that runs after the operation completes.

```javascript
import { afterHook } from '@stonyx/orm';

afterHook('update', 'animal', (context) => {
  console.log(`Updated animal ${context.record.id}`);
  // After hooks cannot halt (operation already complete)
});
```

**Returns:** Unregister function

#### `clearHook(operation, model, [type])`

Clear registered hooks for a specific operation:model.

```javascript
import { clearHook } from '@stonyx/orm';

clearHook('create', 'animal');           // Clear both before and after
clearHook('create', 'animal', 'before'); // Clear only before hooks
clearHook('create', 'animal', 'after');  // Clear only after hooks
```

#### `clearAllHooks()`

Clear all registered hooks (useful for testing).

```javascript
import { clearAllHooks } from '@stonyx/orm';

afterEach(() => {
  clearAllHooks();
});
```

### Operations

- `list` - GET collection (`/animals`)
- `get` - GET single record (`/animals/1`)
- `create` - POST new record (`/animals`)
- `update` - PATCH existing record (`/animals/1`)
- `delete` - DELETE record (`/animals/1`)

### Context Object

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

### Implementation Details

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

### Usage Examples

#### Validation (Halting)

```javascript
beforeHook('create', 'animal', (context) => {
  const { age } = context.body.data.attributes;
  if (age < 0) {
    return 400; // Halt with Bad Request
  }
});
```

#### Custom Error Response

```javascript
beforeHook('delete', 'animal', (context) => {
  const animal = store.get('animal', context.params.id);
  if (animal.protected) {
    return { errors: [{ detail: 'Cannot delete protected animals' }] };
  }
});
```

#### Change Detection with oldState

```javascript
afterHook('update', 'animal', (context) => {
  if (!context.oldState) return;

  // Detect specific field changes
  if (context.oldState.owner !== context.record.owner) {
    console.log(`Owner changed from ${context.oldState.owner} to ${context.record.owner}`);
  }
});
```

#### Audit Logging

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

#### Delete Auditing

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

### Key Differences from Event-Based System

| Feature | Event-Based (Old) | Middleware-Based (Current) |
|---------|-------------------|---------------------------|
| Execution | Parallel (fire-and-forget) | Sequential |
| Can halt operation | No | Yes (return any value) |
| Error handling | Isolated (logged) | Propagated (halts operation) |
| Middleware order | Not guaranteed | Registration order |
| Context modification | Not reliable | Reliable (sequential) |
| API | `subscribe('before:create:animal')` | `beforeHook('create', 'animal')` |

### Testing

**Location**: `test/integration/orm-test.js`
**Coverage**: Comprehensive hook tests including:
- Before/after hooks for all operations
- Halting with status codes
- Halting with custom response objects
- Sequential execution order
- Unsubscribe functionality
- clearHook functionality

---

## Critical Files for Common Tasks

**Understanding Core Behavior:**
- [src/main.js](src/main.js) - Initialization flow
- [src/store.js](src/store.js) - Record storage/retrieval
- [src/manage-record.js](src/manage-record.js) - CRUD operations

**Understanding Relationships:**
- [src/relationships.js](src/relationships.js) - Registry system
- [src/has-many.js](src/has-many.js) - One-to-many logic
- [src/belongs-to.js](src/belongs-to.js) - Many-to-one logic

**Understanding Data Flow:**
- [src/serializer.js](src/serializer.js) - Raw → Model mapping
- [src/model-property.js](src/model-property.js) - Transform application
- [src/transforms.js](src/transforms.js) - Built-in transforms

**Understanding REST API:**
- [src/setup-rest-server.js](src/setup-rest-server.js) - Endpoint registration
- [src/orm-request.js](src/orm-request.js) - Request handling with hooks

**Understanding Hooks:**
- [src/hooks.js](src/hooks.js) - Hook registry (beforeHooks, afterHooks Maps)
- [src/orm-request.js](src/orm-request.js) - `_withHooks()` wrapper

---

## Key Insights

**Strengths:**
- Zero-config REST API generation
- Clean declarative model definitions
- Automatic relationship management
- File-based (no database setup needed)
- Flexible serialization for messy data
- Middleware hooks with halting capability

**Use Cases:**
- Rapid prototyping
- Small to medium applications
- Third-party API consumption with normalization
- Development/testing environments
- Applications needing quick REST APIs

**Dependencies:**
- `stonyx` - Main framework (peer)
- `@stonyx/utils` - File/string utilities
- `@stonyx/events` - Pub/sub event system (optional, not used for hooks)
- `@stonyx/cron` - Scheduled tasks (used by DB for auto-save)
- `@stonyx/rest-server` - REST API

---

## Quick Reference

**Import the ORM:**
```javascript
import {
  Orm, Model, Serializer, attr, hasMany, belongsTo,
  createRecord, updateRecord, store,
  beforeHook, afterHook, clearHook, clearAllHooks
} from '@stonyx/orm';
```

**Initialize:**
```javascript
const orm = new Orm({ dbType: 'json' });
await orm.init();
```

**Access Database:**
```javascript
await Orm.db.save();
```

**Common Operations:**
```javascript
// Create
const record = createRecord('modelName', data);

// Read
const record = store.get('modelName', id);
const all = store.get('modelName');

// Update
updateRecord(record, newData);

// Delete
store.remove('modelName', id);
```

**Register Hooks:**
```javascript
// Before hook (can halt)
const unsubscribe = beforeHook('create', 'animal', (ctx) => {
  if (invalid) return 400;
});

// After hook
afterHook('update', 'animal', (ctx) => {
  console.log('Updated:', ctx.record.id);
});

// Cleanup
unsubscribe();           // Remove specific hook
clearHook('create', 'animal'); // Clear all hooks for operation
clearAllHooks();         // Clear everything
```

---

This guide provides the foundation for understanding stonyx-orm's architecture, patterns, and usage. Refer to test files for concrete examples and the source code for implementation details.
