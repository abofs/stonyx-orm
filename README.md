# @stonyx/orm

A lightweight ORM for Stonyx projects, featuring model definitions, serializers, relationships, transforms, and optional REST server integration.
`@stonyx/orm` provides a structured way to define models, manage relationships, and persist data in JSON files. It also allows integration with the Stonyx REST server for automatic route setup and access control.

## Highlights

- **Automatic Loading**: Models, serializers, transforms, and access classes are auto-registered from their configured directories.
- **Models**: Define attributes with type-safe proxies (`attr`) and relationships (`hasMany`, `belongsTo`).
- **Serializers**: Map raw data into model-friendly structures, including nested properties.
- **Transforms**: Apply custom transformations on data values automatically.
- **DB Integration**: Optional file-based persistence with auto-save support.
- **REST Server Integration**: Automatic route setup with customizable access control.

## Installation

```bash
npm install @stonyx/orm
````

## Usage example

This module is part of the **Stonyx framework**. To use it, first configure the `restServer` key in your `environment.js` file:

```js
const {
  ORM_ACCESS_PATH,
  ORM_MODEL_PATH,
  ORM_REST_ROUTE,
  ORM_SERIALIZER_PATH,
  ORM_TRANSFORM_PATH,
  ORM_USE_REST_SERVER,
  DB_AUTO_SAVE,
  DB_FILE,
  DB_SCHEMA_PATH,
  DB_SAVE_INTERVAL
} = process;

export default {
  orm: {
    logColor: 'white',
    logMethod: 'db',
    
    db: {
      autosave: DB_AUTO_SAVE ?? 'false',
      file: DB_FILE ?? 'db.json',
      saveInterval: DB_SAVE_INTERVAL ?? 3600, // 1 hour
      schema: DB_SCHEMA_PATH ?? './config/db-schema.js'
    },
    paths: {
      access: ORM_ACCESS_PATH ?? './access',
      model: ORM_MODEL_PATH ?? './models',
      serializer: ORM_SERIALIZER_PATH ?? './serializers',
      transform: ORM_TRANSFORM_PATH ?? './transforms'
    },
    restServer: {
      enabled: ORM_USE_REST_SERVER ?? 'true',
      route: ORM_REST_ROUTE ?? '/'
    }
  }
};
```

Then initialize the Stonyx framework, which auto-initializes all of its modules, including `@stonyx/rest-server`:

```js
import Stonyx from 'stonyx';
import config from './config/environment.js';

new Stonyx(config);
```

For further framework initialization instructions, see the [Stonyx repository](https://github.com/abofs/stonyx).

## Models

Define a model with attributes and relationships:

```js
import { Model, attr, hasMany, belongsTo } from '@stonyx/orm';

export default class OwnerModel extends Model {
  id = attr('string');
  age = attr('number');
  pets = hasMany('animal');

  get totalPets() {
    return this.pets.length;
  }
}
```

## Serializers

Based on the following sample payload structure which represents a poorly structure third-party data source:

```js
export default {
  animals: [
    { id: 1, type: 'dog', details: { age: 2, c: 'small', x: 'black', location: { type: 'farm', owner: 'angela' }}},
    //...
  ]
}
```

Map raw data to model fields:

```js
import { Serializer } from '@stonyx/orm';

export default class AnimalSerializer extends Serializer {
  map = {
    age: 'details.age',
    size: 'details.c',
    color: 'details.x',
    owner: 'details.location.owner'
  }
}
```

## Relationships

### belongsTo

```js
import { belongsTo } from '@stonyx/orm';

class AnimalModel extends Model {
  owner = belongsTo('owner');
}
```

### hasMany

```js
import { hasMany } from '@stonyx/orm';

class OwnerModel extends Model {
  pets = hasMany('animal');
}
```

## Transforms

Apply custom transforms on field values:

```js
import { ANIMALS } from '../constants.js';

export default function(value) {
  return ANIMALS.indexOf(value) || 0;
}
```

## Database (DB) Integration

The ORM can automatically save records to a JSON file with optional auto-save intervals.

```js
import Orm from '@stonyx/orm';

const orm = new Orm();
await orm.init();

// Access the DB record
const dbRecord = Orm.db;
```

Configuration options are in `config/environment.js`:

* `DB_AUTO_SAVE`: Whether to auto-save.
* `DB_FILE`: File path to store data.
* `DB_SAVE_INTERVAL`: Interval in seconds for auto-save.
* `DB_SCHEMA_PATH`: Path to DB schema.

## REST Server Integration

The ORM can automatically register REST routes using your access classes.

```js
import setupRestServer from '@stonyx/orm/setup-rest-server';

await setupRestServer('/', './access');
```

Access classes define models and provide custom filtering/authorization logic:

```js
export default class GlobalAccess {
  models = ['owner', 'animal'];

  access(request) {
    if (request.url.endsWith('/owner/angela')) return false;
    return ['read', 'create', 'update', 'delete'];
  }
}
```

### Include Parameter (Sideloading Relationships)

The ORM supports JSON API-compliant relationship sideloading via the `include` query parameter. This reduces the need for multiple API requests by embedding related records in a single response.

#### Basic Usage

```javascript
// Fetch animal with owner and traits included
GET /animals/1?include=owner,traits

// Response:
{
  "data": {
    "type": "animal",
    "id": 1,
    "attributes": { "age": 2, "size": "small" },
    "relationships": {
      "owner": { "data": { "type": "owner", "id": "angela" } },
      "traits": { "data": [
        { "type": "trait", "id": 1 },
        { "type": "trait", "id": 2 }
      ]}
    }
  },
  "included": [
    {
      "type": "owner",
      "id": "angela",
      "attributes": { "age": 36, "gender": "female" },
      "relationships": { "pets": { "data": [...] } }
    },
    {
      "type": "trait",
      "id": 1,
      "attributes": { "type": "habitat", "value": "farm" },
      "relationships": {}
    },
    {
      "type": "trait",
      "id": 2,
      "attributes": { "type": "color", "value": "black" },
      "relationships": {}
    }
  ]
}
```

#### Features

- **Comma-separated relationship names:** `?include=owner,traits`
- **Nested relationship traversal:** `?include=owner.pets,owner.company` (supports multi-level nesting)
- **Works with collections and single records:** Both GET endpoints support includes
- **Automatic deduplication:** Each unique record (by type+id) appears only once in included array
- **Invalid relationships ignored:** Invalid relationship names are silently skipped
- **Backward compatible:** Omit the include parameter for original behavior (no included array)

#### Examples

```javascript
// Single resource with single include
GET /owners/gina?include=pets

// Single resource with multiple includes
GET /animals/1?include=owner,traits

// Nested includes (NEW!)
GET /animals/1?include=owner.pets

// Deep nesting (3+ levels)
GET /scenes/e001-s001?include=slides.dialogue.character

// Collection with includes (deduplicates automatically)
GET /animals?include=owner

// Combining nested and non-nested includes
GET /owners?include=pets.traits,company

// No include parameter (backward compatible)
GET /animals/1
// Returns: { data: {...} } // No included array
```

**How Nested Includes Work:**
1. Query param parsed into path segments: `owner.pets` → `['owner', 'pets']`
2. Recursively traverses relationships depth-first
3. Deduplication still by type+id (no duplicates in included array)
4. Gracefully handles null/missing relationships at any depth
5. Each included record gets full `toJSON()` representation

#### Limitations

- Only available on GET endpoints (not POST/PATCH)

## Lifecycle Hooks

The ORM provides a powerful event-driven hook system that allows you to run custom logic before and after CRUD operations. Hooks are perfect for validation, transformation, side effects, authorization, and auditing.

### Overview

Hooks are implemented using the `@stonyx/events` package and emit events at key points in the request lifecycle:

- **Before hooks**: Run before the operation executes (validation, authorization)
- **After hooks**: Run after the operation completes (logging, notifications, cache invalidation)

### Event Naming Convention

Events follow the pattern: `{timing}:{operation}:{modelName}`

**Operations:**
- `list` - GET collection (`/animals`)
- `get` - GET single record (`/animals/1`)
- `create` - POST new record (`/animals`)
- `update` - PATCH existing record (`/animals/1`)
- `delete` - DELETE record (`/animals/1`)

**Examples:**
- `before:create:animal` - Before creating an animal
- `after:list:owner` - After fetching owner collection
- `before:update:trait` - Before updating a trait

### Hook Context Object

Each hook receives a context object with comprehensive information:

```javascript
{
  model: 'animal',           // Model name
  operation: 'create',       // Operation type
  request,                   // Express request object
  params,                    // URL params (e.g., { id: 5 })
  body,                      // Request body (POST/PATCH)
  query,                     // Query parameters
  state,                     // Request state object
  record,                    // Record instance (after hooks, single operations)
  records,                   // Record array (after hooks, list operations)
  response,                  // Response data (after hooks)
}
```

### Usage Examples

#### Basic Hook Registration

```javascript
import { subscribe } from '@stonyx/events';

// Validation before creating
subscribe('before:create:animal', async (context) => {
  const { age } = context.body.data.attributes;
  if (age < 0) {
    throw new Error('Age must be positive');
  }
});

// Logging after updates
subscribe('after:update:animal', async (context) => {
  console.log(`Animal ${context.record.id} was updated`);
});
```

#### Data Transformation

```javascript
// Normalize data before saving
subscribe('before:create:owner', async (context) => {
  const attrs = context.body.data.attributes;
  if (attrs.email) {
    attrs.email = attrs.email.toLowerCase().trim();
  }
});
```

#### Side Effects

```javascript
// Send notification after animal is adopted
subscribe('after:update:animal', async (context) => {
  if (context.record.owner !== context.body.data.attributes.owner) {
    await sendNotification({
      type: 'adoption',
      animalId: context.record.id,
      newOwner: context.record.owner
    });
  }
});

// Cache invalidation
subscribe('after:delete:animal', async (context) => {
  await cache.invalidate(`owner:${context.params.id}:pets`);
});
```

#### Authorization

```javascript
// Additional access control
subscribe('before:delete:animal', async (context) => {
  const user = context.state.currentUser;
  const animal = store.get('animal', context.params.id);

  if (animal.owner !== user.id && !user.isAdmin) {
    throw new Error('Unauthorized to delete this animal');
  }
});
```

#### Auditing

```javascript
// Audit log for all changes
const auditOperations = ['create', 'update', 'delete'];

for (const operation of auditOperations) {
  subscribe(`after:${operation}:animal`, async (context) => {
    await auditLog.create({
      operation: context.operation,
      model: context.model,
      recordId: context.record?.id,
      userId: context.state.currentUser?.id,
      timestamp: new Date(),
      changes: context.body
    });
  });
}
```

#### Error Handling

Hook errors are isolated and won't break the operation:

```javascript
subscribe('after:create:animal', async (context) => {
  try {
    await sendWelcomeEmail(context.record.owner);
  } catch (error) {
    // Error is logged but doesn't fail the create operation
    console.error('Failed to send welcome email:', error);
  }
});
```

### Hook Lifecycle Management

#### Unsubscribing

```javascript
// Get unsubscribe function
const unsubscribe = subscribe('before:create:animal', handler);

// Later, remove the hook
unsubscribe();
```

#### Clearing All Hooks for an Event

```javascript
import { clear } from '@stonyx/events';

// Remove all hooks for this event
clear('before:create:animal');
```

#### One-time Hooks

```javascript
import { once } from '@stonyx/events';

// Run only on the next create
once('after:create:animal', async (context) => {
  console.log('First animal created!');
});
```

### Advanced Patterns

#### Conditional Hooks

```javascript
subscribe('before:update:animal', async (context) => {
  // Only validate if age is being updated
  if ('age' in context.body.data.attributes) {
    const { age } = context.body.data.attributes;
    if (age < 0 || age > 50) {
      throw new Error('Invalid age range');
    }
  }
});
```

#### Cross-Model Hooks

```javascript
// Update owner's pet count when animal is created
subscribe('after:create:animal', async (context) => {
  const owner = store.get('owner', context.record.owner);
  if (owner) {
    owner.petCount = (owner.petCount || 0) + 1;
  }
});
```

#### Batch Operations

```javascript
// Track batch operations
let batchContext = null;

subscribe('before:list:animal', async (context) => {
  if (context.query.batch) {
    batchContext = { startTime: Date.now() };
  }
});

subscribe('after:list:animal', async (context) => {
  if (batchContext) {
    console.log(`Batch operation completed in ${Date.now() - batchContext.startTime}ms`);
    console.log(`Returned ${context.records.length} records`);
    batchContext = null;
  }
});
```

### Hook Execution Order

1. **Before hooks** fire first (all subscribers in parallel)
2. **Main operation** executes
3. **After hooks** fire last (all subscribers in parallel)

Multiple hooks for the same event run in parallel and independently - one hook's error won't affect others.

### Best Practices

1. **Keep hooks focused**: Each hook should do one thing well
2. **Use async/await**: All hooks are async for consistency
3. **Handle errors gracefully**: Don't let hook errors break operations
4. **Document side effects**: Make it clear what each hook does
5. **Test hooks independently**: Write unit tests for hook logic
6. **Avoid heavy operations**: Keep hooks fast to maintain performance
7. **Use descriptive names**: Name hook handlers clearly for debugging

### Testing Hooks

```javascript
import { subscribe, emit } from '@stonyx/events';

// Test hook behavior
test('validation hook rejects negative age', async () => {
  let error;

  subscribe('before:create:animal', async (context) => {
    if (context.body.data.attributes.age < 0) {
      throw new Error('Age must be positive');
    }
  });

  try {
    await emit('before:create:animal', {
      model: 'animal',
      operation: 'create',
      body: { data: { attributes: { age: -5 } } }
    });
  } catch (e) {
    error = e;
  }

  assert.ok(error, 'Hook threw error for negative age');
});
```

## Exported Helpers

| Export          | Description                                                             |
| --------------- | ----------------------------------------------------------------------- |
| `attr`          | Define model attributes with type-safe proxy.                           |
| `belongsTo`     | Define a one-to-one relationship.                                       |
| `hasMany`       | Define a one-to-many relationship.                                      |
| `createRecord`  | Instantiate a record with proper serialization and relationships.       |
| `store`         | Singleton store for all model instances.                                |
| `relationships` | Access all relationships (`hasMany`, `belongsTo`, `global`, `pending`). |

## License

Apache — do what you want, just keep attribution.
