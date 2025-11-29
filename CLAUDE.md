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

### Project Structure

```
stonyx-orm/
├── src/
│   ├── index.js                  # Main exports
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
│   ├── setup-rest-server.js      # REST integration
│   ├── orm-request.js            # CRUD request handler
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

GET endpoints support sideloading related records:

```javascript
// Request with includes
GET /animals/1?include=owner,traits

// Response structure
{
  data: { type: 'animal', id: 1, attributes: {...}, relationships: {...} },
  included: [
    { type: 'owner', id: 'angela', attributes: {...}, relationships: {...} },
    { type: 'trait', id: 1, attributes: {...}, relationships: {...} },
    { type: 'trait', id: 2, attributes: {...}, relationships: {...} }
  ]
}
```

**How It Works:**
1. Query param parsed by `parseInclude()` → `['owner', 'traits']`
2. `collectIncludedRecords()` traverses `record.__relationships`
3. Deduplication by type+id using Map<type, Set<id>>
4. Each included record converted via `toJSON()`
5. Response built with `{ data, included }` structure

**Key Files:**
- [src/include-parser.js](src/include-parser.js) - Parsing logic
- [src/include-collector.js](src/include-collector.js) - Collection and deduplication
- [src/orm-request.js](src/orm-request.js) - Request handler integration

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
6. **Convention over Configuration**: Auto-discovery by naming

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

## Key Insights

**Strengths:**
- Zero-config REST API generation
- Clean declarative model definitions
- Automatic relationship management
- File-based (no database setup needed)
- Flexible serialization for messy data

**Use Cases:**
- Rapid prototyping
- Small to medium applications
- Third-party API consumption with normalization
- Development/testing environments
- Applications needing quick REST APIs

**Dependencies:**
- `stonyx` - Main framework (peer)
- `@stonyx/utils` - File/string utilities
- `@stonyx/cron` - Scheduled tasks
- `@stonyx/rest-server` - REST API

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
- [src/orm-request.js](src/orm-request.js) - Request handling

---

## Quick Reference

**Import the ORM:**
```javascript
import { Orm, Model, Serializer, attr, hasMany, belongsTo, createRecord, updateRecord, store } from '@stonyx/orm';
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

---

This guide provides the foundation for understanding stonyx-orm's architecture, patterns, and usage. Refer to test files for concrete examples and the source code for implementation details.
