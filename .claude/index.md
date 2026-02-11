# Stonyx-ORM Guide for Claude

## Detailed Guides

- [Usage Patterns](usage-patterns.md) — Model definitions, serializers, transforms, CRUD, DB schema, persistence, access control, REST API, and include parameters
- [Middleware Hooks System](hooks.md) — Before/after hooks for CRUD operations, halting, context object, change detection, and testing

---

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
8. **Include Logic** (inline in [src/orm-request.js](src/orm-request.js)) - Parses include query params, traverses relationships, collects and deduplicates included records
9. **Hooks** ([src/hooks.js](src/hooks.js)) - Middleware-based hook registry for CRUD lifecycle
10. **MySQL Driver** ([src/mysql/mysql-db.js](src/mysql/mysql-db.js)) - MySQL persistence, migrations, schema introspection. Loads records in topological order. `_rowToRawData()` converts TINYINT(1) → boolean, remaps FK columns, strips timestamps.

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
│   ├── orm-request.js            # CRUD request handler with hooks + includes
│   ├── meta-request.js           # Meta endpoint (dev only)
│   ├── migrate.js                # JSON DB mode migration (file <-> directory)
│   ├── commands.js               # CLI commands (db:migrate-*, etc.)
│   ├── utils.js                  # Pluralize wrapper for dasherized names
│   ├── exports/
│   │   └── db.js                 # Convenience re-export of DB instance
│   └── mysql/
│       ├── mysql-db.js           # MySQL driver (CRUD persistence, record loading)
│       ├── connection.js         # mysql2 connection pool
│       ├── query-builder.js      # SQL builders (INSERT/UPDATE/DELETE/SELECT)
│       ├── schema-introspector.js # Model-to-MySQL schema introspection
│       ├── migration-generator.js # Schema diff and .sql migration generation
│       ├── migration-runner.js   # Migration apply/rollback with transactions
│       └── type-map.js           # ORM attr types -> MySQL column types
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
    mode: 'file', // 'file' (single db.json) or 'directory' (one file per collection)
    directory: 'db', // directory name for collection files when mode is 'directory'
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

## Storage Modes

The ORM supports two storage modes, configured via `db.mode`:

- **`'file'`** (default): All data is stored in a single `db.json` file.
- **`'directory'`**: Each collection is stored as a separate file in the configured directory — `{directory}/{collection}.json` (e.g., `db/animals.json`, `db/owners.json`). The main `db.json` is kept as a skeleton with empty arrays.

**Migration CLI commands:**
- `stonyx-db-file-to-directory` — Splits a single `db.json` into per-collection files in the directory.
- `stonyx-db-directory-to-file` — Merges per-collection files back into a single `db.json`.

**Mode validation:** On startup, the ORM warns if the configured mode doesn't match the actual file state (e.g., mode is `'file'` but a `db/` directory exists, or mode is `'directory'` but no directory is found).

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

**Test Runner**: QUnit via `stonyx test` (auto-bootstraps and runs `test/**/*-test.js`)

**Test Structure:**
- **Integration**: [test/integration/orm-test.js](test/integration/orm-test.js) - Full pipeline test
- **Unit**: [test/unit/transforms/](test/unit/transforms/) - Transform tests
- **Sample**: [test/sample/](test/sample/) - Test fixtures

**Key Test Data:**
- [test/sample/payload.js](test/sample/payload.js) - Raw vs serialized data
- Demonstrates transformation from messy external data to clean models

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
- `@stonyx/events` - Pub/sub event system (event names initialized on startup; hooks use separate middleware-based registry)
- `@stonyx/cron` - Scheduled tasks (used by DB for auto-save)
- `@stonyx/rest-server` - REST API
- `mysql2` - Optional peer dependency for MySQL mode

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
