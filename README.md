[![CI](https://github.com/abofs/stonyx-orm/actions/workflows/ci.yml/badge.svg)](https://github.com/abofs/stonyx-orm/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@stonyx/orm.svg)](https://www.npmjs.com/package/@stonyx/orm)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

# @stonyx/orm

A lightweight ORM for Stonyx projects, featuring model definitions, serializers, relationships, transforms, and optional REST server integration.
`@stonyx/orm` provides a structured way to define models, manage relationships, and persist data in JSON files or MySQL. It also allows integration with the Stonyx REST server for automatic route setup and access control.

## Highlights

- **Automatic Loading**: Models, serializers, transforms, and access classes are auto-registered from their configured directories.
- **Models**: Define attributes with type-safe proxies (`attr`) and relationships (`hasMany`, `belongsTo`).
- **Serializers**: Map raw data into model-friendly structures, including nested properties.
- **Transforms**: Apply custom transformations on data values automatically.
- **DB Integration**: Optional file-based persistence with auto-save support, or MySQL/PostgreSQL/TimescaleDB/DynamoDB for production workloads.
- **REST Server Integration**: Automatic route setup with customizable access control.
- **Lifecycle Hooks**: Middleware-based before/after hooks for validation, authorization, side effects, and auditing.

## Public API vs Internals

Records use a proxy that exposes model attributes as direct properties. Always use direct property access for reading and writing field values:

```js
// Correct: read/write via the proxy
const age = record.age;
record.age = 5;

// Correct: iterate fields using the record directly
for (const key of Object.keys(record.serialize())) {
  console.log(key, record[key]);
}
```

All properties prefixed with `__` (`__data`, `__relationships`, `__model`, `__serializer`, `__serialized`) are **internal implementation details** and must not be accessed by consumer code. Bypassing the proxy by reading or writing `__data` directly skips type transforms and change tracking, which can lead to silent data corruption.

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
  DB_MODE,
  DB_DIRECTORY,
  DB_SCHEMA_PATH,
  DB_SAVE_INTERVAL,
  MYSQL_HOST,
  MYSQL_PORT,
  MYSQL_USER,
  MYSQL_PASSWORD,
  MYSQL_DATABASE,
  MYSQL_CONNECTION_LIMIT,
  MYSQL_MIGRATIONS_DIR,
  DYNAMODB_REGION,
  DYNAMODB_ENDPOINT,
  DYNAMODB_TABLE_PREFIX,
} = process.env;

export default {
  orm: {
    logColor: 'white',
    logMethod: 'db',

    db: {
      autosave: DB_AUTO_SAVE ?? 'false',
      file: DB_FILE ?? 'db.json',
      mode: DB_MODE ?? 'file', // 'file' (single db.json) or 'directory' (one file per collection)
      directory: DB_DIRECTORY ?? 'db', // directory name for collection files when mode is 'directory'
      saveInterval: DB_SAVE_INTERVAL ?? 3600, // 1 hour
      schema: DB_SCHEMA_PATH ?? './config/db-schema.js'
    },
    paths: {
      access: ORM_ACCESS_PATH ?? './access',
      model: ORM_MODEL_PATH ?? './models',
      serializer: ORM_SERIALIZER_PATH ?? './serializers',
      transform: ORM_TRANSFORM_PATH ?? './transforms'
    },
    mysql: MYSQL_HOST ? {
      host: MYSQL_HOST ?? 'localhost',
      port: parseInt(MYSQL_PORT ?? '3306'),
      user: MYSQL_USER ?? 'root',
      password: MYSQL_PASSWORD ?? '',
      database: MYSQL_DATABASE ?? 'stonyx',
      connectionLimit: parseInt(MYSQL_CONNECTION_LIMIT ?? '10'),
      migrationsDir: MYSQL_MIGRATIONS_DIR ?? 'migrations',
      migrationsTable: '__migrations',
      autoMigrate: AUTO_MIGRATE === 'true' ? true : AUTO_MIGRATE === 'false' ? false : undefined,
    } : undefined,
    dynamodb: DYNAMODB_REGION ? {
      region: DYNAMODB_REGION,
      endpoint: DYNAMODB_ENDPOINT,          // optional, for DynamoDB Local
      tablePrefix: DYNAMODB_TABLE_PREFIX,   // optional table name prefix
    } : undefined,
    restServer: {
      enabled: ORM_USE_REST_SERVER ?? 'true',
      route: ORM_REST_ROUTE ?? '/'
    }
  }
};
```

Then run the application via the Stonyx CLI, which auto-initializes all modules including the ORM:

```bash
stonyx serve
```

For further framework instructions, see the [Stonyx repository](https://github.com/abofs/stonyx).

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

### Overriding Plural Names

By default, model names are auto-pluralized for REST routes, JSON:API URLs, and DB table names (e.g., `animal` → `animals`). When auto-pluralization produces the wrong result, override it with `static pluralName`:

```js
import { Model, attr } from '@stonyx/orm';

export default class PersonModel extends Model {
  static pluralName = 'people';

  name = attr('string');
}
```

The override is picked up automatically during ORM initialization. All routes, JSON:API type references, and MySQL table names will use the overridden value.

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

The ORM can automatically save records to a JSON file or a directory of collection files, with optional auto-save intervals.

```js
import Orm from '@stonyx/orm';

const orm = new Orm();
await orm.init();

// Access the DB record
const dbRecord = Orm.db;
```

Configuration options are in `config/environment.js`:

* `DB_AUTO_SAVE`: Auto-save mode — `'true'` (cron-based interval), `'false'` (disabled), or `'onUpdate'` (save after every create/update/delete via REST API).
* `DB_FILE`: File path to store data.
* `DB_MODE`: Storage mode — `'file'` (single JSON file, default) or `'directory'` (one file per collection in a directory).
* `DB_DIRECTORY`: Directory name for collection files when mode is `'directory'` (default: `'db'`).
* `DB_SAVE_INTERVAL`: Interval in seconds for auto-save (only applies when `DB_AUTO_SAVE` is `'true'`).
* `DB_SCHEMA_PATH`: Path to DB schema.

In directory mode, each collection is stored as `{directory}/{collection}.json` (e.g., `db/animals.json`, `db/owners.json`). The main `db.json` is kept as a skeleton with empty arrays. Migration commands are available: `stonyx db:migrate-to-directory` and `stonyx db:migrate-to-file`.

### MySQL Mode

Set the `MYSQL_HOST` environment variable to enable MySQL persistence. The ORM loads all records into memory on startup and persists CRUD operations to MySQL automatically. Supports schema-aware migration generation, apply, rollback, and drift detection.

| Command | Description |
|---------|-------------|
| `stonyx db:generate-migration <desc>` | Generate a migration from model schema diffs |
| `stonyx db:migrate` | Apply pending migrations |
| `stonyx db:migrate:rollback` | Rollback the most recent migration |
| `stonyx db:migrate:status` | Show migration status |
| `stonyx db:sync` | Sync DynamoDB table definitions to match current model schemas |

### DynamoDB Mode

Set the `DYNAMODB_REGION` environment variable to enable DynamoDB persistence. Tables are created with PAY_PER_REQUEST (on-demand) billing. Global Secondary Indexes (GSIs) are auto-provisioned at startup based on model `belongsTo` relationships — each FK column gets a GSI. `findAll()` with conditions routes to a GSI Query when the condition key matches a GSI partition key; non-indexed attribute conditions fall back to Scan + FilterExpression (expensive for large tables). ULID generation replaces auto-increment for numeric-ID models.

```javascript
dynamodb: {
  region: 'us-east-1',
  endpoint: 'http://localhost:8000', // optional, for DynamoDB Local
  tablePrefix: 'myapp-',            // optional table name prefix
}
```

Environment variables:

* `DYNAMODB_REGION`: AWS region for DynamoDB (e.g., `'us-east-1'`).
* `DYNAMODB_ENDPOINT`: Optional custom endpoint URL, useful for DynamoDB Local during development.
* `DYNAMODB_TABLE_PREFIX`: Optional prefix prepended to all table names (e.g., `'myapp-'` yields `'myapp-animals'`).

**Peer dependencies:** `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` must be installed when using the DynamoDB driver. The AWS SDK is dynamically imported and only loaded when the DynamoDB driver is selected.

```bash
npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

### Running MySQL Tests

The ORM includes integration tests that run against a real MySQL database. These are optional — all other tests work without MySQL.

**One-time setup:**

```bash
# Requires local MySQL 8.0+ running
./scripts/setup-test-db.sh
```

This creates a `stonyx_orm_test` database with a `stonyx_test` user. Safe to re-run.

**Running tests:**

```bash
npm test
```

MySQL integration tests run automatically when MySQL is available. In CI (where `CI=true`), they skip gracefully.

## REST Server Integration

The ORM can automatically register REST routes using your access classes.

```js
import setupRestServer from '@stonyx/orm/setup-rest-server';

await setupRestServer('/', './access');
```

Access classes define models and provide custom filtering/authorization logic.

> **The URL-matching in this example is a stopgap. Read
> [Matching the url](#matching-the-url) before copying it.** The same three-line
> example has failed **open** in four distinct ways during one review, each found
> only after the previous was fixed. The sample below closes all four; that is
> not the same as being safe. The real fix is
> [#202](https://github.com/abofs/stonyx-orm/issues/202) — `access()` should
> receive the model, the operation and the record, so there is no URL to parse.

```js
import config from 'stonyx/config';

// Build the mount prefix from the SAME value the ORM mounts under, and compare
// lower-cased. Both are load-bearing — see "Matching the url".
function collectionPrefix(name) {
  const route = config.orm.restServer.route ?? '/';
  const trimmed = String(route).replace(/^\/+|\/+$/g, '');

  return `${trimmed === '' ? '' : `/${trimmed}`}/${name}`.toLowerCase();
}

export default class GlobalAccess {
  models = ['owner', 'animal'];

  access(request) {
    // `originalUrl`, not `url` — `url` is mount-relative, so a prefix match
    // against it is ALWAYS false. Query string stripped, because `originalUrl`
    // carries it. Lower-cased, because the router matched case-insensitively
    // and a matcher stricter than the router can be walked past. Every one of
    // those three omissions fails OPEN.
    const path = String(request.originalUrl ?? '').split('?')[0].toLowerCase();
    const owners = collectionPrefix('owners');

    // false → 403 for the whole request
    if (path.startsWith(`${owners}/archived`)) return false;

    // A function is a per-record filter. Anchored on a `/` boundary so it
    // cannot also match `/owners-archive`. Rejected records are 404 on record
    // routes, 403 on POST.
    if (path === owners || path.startsWith(`${owners}/`)) {
      return record => record.id !== 'angela';
    }

    return ['read', 'create', 'update', 'delete'];
  }
}
```

### Return values

| `access()` returns | Effect |
|---|---|
| `false` (or any falsy value) | `403` for the whole request |
| `true` | full access, no filter |
| `['read', 'create', 'update', 'delete']` | the listed operations only; anything else is `403` |
| `'read'` (a bare string) | **one** permission, equivalent to `['read']` |
| a function | a per-record filter — see below |
| anything else | `403` — unknown shapes fail **closed** |

A `throw` inside `access()` is a **denial**, not a 500.

### Filter functions

A function return value is a **per-record predicate**, and it is enforced on
every endpoint that is addressed to a record — not only on the collection:

| Endpoint | A record the predicate rejects |
|---|---|
| `GET /:models` | omitted from the collection |
| `GET /:models/:id` | `404` |
| `GET /:models/:id/{relationship}` | `404` — the **addressed** record is filtered, not the related one |
| `GET /:models/:id/relationships/{relationship}` | `404` — same |
| `PATCH /:models/:id` | `404`, no attribute is applied |
| `DELETE /:models/:id` | `404`, the record is not removed and no SQL `DELETE` is issued |
| `POST /:models` | `403`, and nothing is left in the store |

**Denied record-level requests return 404, not 403.** This is deliberate and it
is the property most easily "improved" away. 403 would confirm that the record
exists to a caller who is not allowed to know that, which turns the filter into
an existence oracle: `404` means "no such record", `403` means "there is one and
it is not yours". Every status on a record route must therefore be identical for
"filtered out" and "does not exist" — including `DELETE`, which is why deleting
a record that never existed also returns 404 rather than 204.

`POST` is the one exception and returns **403**, because 404 on a mounted
collection route is indistinguishable from "model not mounted" — a genuinely
different failure a developer needs to diagnose.

**A client-supplied `id` on `POST` is refused with `403` whenever a function
filter is in force.** This is the part that keeps `POST` from being an
enumeration oracle, and it is worth understanding rather than working around.
The duplicate-id check has to run before the filter, and it sees records the
filter hides, so the *status* of a `POST` otherwise leaks whether an id is
taken:

| `POST /animals` with a payload the caller may create | before | now |
|---|---|---|
| an id held by a record the filter **hides** | `403` | `403` |
| an id that is **free** | `200` | `403` |
| an id held by a record the caller **can see** | `409` | `403` |

Three outcomes, one request per id, the whole id space. Filtering only the
*collision* status narrows that to callers who cannot create a record they are
allowed to see; it does not close it. It cannot be closed while a caller both
chooses the id and learns whether the create succeeded — so under a filter the
caller does not choose the id. The refusal happens before any store lookup, so
neither the status nor the response time depends on whether the id exists.

Let the server assign the id and read it back from the response. Callers with no
function-style filter are unaffected: `409` on a duplicate id and `200` on a free
one both behave exactly as before.

### Matching the url

**This section describes a pattern the framework should not be asking you to
implement.** It has produced four separate fail-open defects, listed below,
each found only after the previous was fixed, and there is no reason to believe
the list is complete. [#202](https://github.com/abofs/stonyx-orm/issues/202)
replaces it. Until then, all four rules apply and each one, omitted, fails
**open**.

**1. Match `request.originalUrl`, never `request.url`.**
`RestServer.mountRoute` mounts each model as an Express **sub-app**, so by the
time `access()` runs the mount path has been stripped from `request.url`:

| request | `request.url` | `request.originalUrl` |
|---|---|---|
| `GET /owners` | `/` | `/owners` |
| `GET /owners/angela` | `/angela` | `/owners/angela` |
| `GET /owners/angela/pets` | `/angela/pets` | `/owners/angela/pets` |

`request.url.startsWith('/owners')` is therefore **always false**: the branch
never fires, `access()` falls through to whatever it returns last, and a filter
that looks correct enforces nothing on any surface.

**2. Strip the query string, and match the prefix rather than the exact url.**
The predicate has to be returned for record routes too, so
`url.endsWith('/owners')` leaves `/owners/angela` unguarded — and `originalUrl`
carries the query string, so a bare `=== '/owners'` misses
`/owners?filter[age]=30` and lets a filtered collection through unfiltered.
Anchoring on the path portion covers both without also matching
`/owners-archive`.

**3. Compare lower-cased.** `RestServer` mounts with a bare `express()`, whose
default is `caseSensitive: false`, while `originalUrl` preserves the caller's
case. A case-sensitive matcher is stricter than the router that dispatched the
request, so it can simply be stepped around:

```
GET    /owners/angela  -> 404          GET    /OwNeRs/angela -> 200, angela in full
GET    /owners         -> filtered     GET    /OWNERS        -> unfiltered
DELETE /animals/22     -> 404          DELETE /ANIMALS/22    -> 204, record destroyed
```

Lower-case the **path** only. Record ids are case-sensitive and must be compared
at their real case. The router-side fix is tracked as
[stonyx-rest-server#47](https://github.com/abofs/stonyx-rest-server/issues/47).

**4. Build the prefix from the configured mount route.** With
`ORM_REST_ROUTE=/api` the urls above become `/api/owners/...`, and a sample
hard-coded to `/owners` matches nothing — environment-specifically, which is
harder to notice than failing everywhere.

Note what this must *not* be. An earlier version of this document suggested
`` `${config.orm.restServer.route}owners` ``. For the default route that is
`/owners` and looks correct; for `ORM_REST_ROUTE=/api` it evaluates to
**`/apiowners`**, so a reader who followed the correction exactly still failed
open and believed they had handled it. Join on `/` and collapse the duplicate,
as `collectionPrefix()` above does.

### Known limitations

- **Authorization by URL matching is a consumer-side reconstruction of
  information the framework already holds.** `access()` receives a transport
  artifact and is asked to re-derive, correctly and defensively, which model,
  which operation and which record the request addresses. The four rules above
  are the four ways that reconstruction has been observed to fail open so far.
  Tracked as [#202](https://github.com/abofs/stonyx-orm/issues/202).
- **Related and included records are not filtered.** The predicate is evaluated
  against the record the route is *addressed to*. `GET /animals/1/owner`,
  `GET /animals/1/relationships/owner` and `?include=owner` all serialize the
  related record without resolving that model's own access class, so a filter on
  `/owners` does not hide an owner reached through `/animals`. Tracked as
  [#196](https://github.com/abofs/stonyx-orm/issues/196), which covers
  `include=`, related-resource routes and relationship-linkage routes.
- **A before-hook that returns a value short-circuits the request.** On write
  operations addressed to a record the filter is consulted first, so a hook
  cannot answer for a record the caller may not see. On reads it is not, so a
  `beforeHook('get', ...)` read-through cache can answer past the filter.
- **`beforeHook('create', ...)` still runs for a `POST` that is denied.** For
  `create` there is no record to test until the handler has built one, so the
  denial is not knowable in time. Every *after*-hook is gated, and every
  before-hook on `update` and `delete` is gated; before-`create` is the one
  exception. A before-`create` hook must not assume the create will succeed.
- **A caller can still learn that a collection *has* a per-record filter**, by
  observing `403` rather than `409`/`200` for an id-bearing `POST`. That
  discloses a configuration fact, not the existence of any record.
- **Enforcement is post-fetch.** The record is loaded and then tested, which
  leaves a small timing difference between a hidden record and one that never
  existed. Tracked as [#197](https://github.com/abofs/stonyx-orm/issues/197).

### Breaking changes in 0.4.0

There is no changelog or release-notes channel yet
([stonyx-workflows#17](https://github.com/abofs/stonyx-workflows/issues/17)), so
they are recorded here.

1. **`DELETE /{collection}/{id}` on a record that does not exist returns `404`
   instead of `204`.** This affects **every** consumer issuing a DELETE against
   any mounted collection, whether or not an access filter is configured, and
   `models: '*'` mounts every model by default. It is not optional: if a denied
   delete returned 404 while a missing one returned 204, the pair would be a
   perfect existence oracle and the filter would be worthless.
2. **After-hooks no longer fire for a write that failed** — denied, missing,
   `400` or `409`. Previously `afterHook('delete', ...)` ran with a populated
   `context.recordId` on a request that deleted nothing, so a consumer cascade
   destroyed children behind a 404.
3. **`POST` with a client-supplied `id` returns `403` when a function-style
   `access` filter is in force**, whatever the payload and whether or not the id
   exists. Only affects function-style `access` users. See
   [Filter functions](#filter-functions) for why, and let the server assign the
   id instead. `409`-on-duplicate is unchanged for everyone else.
4. **Function-style `access` is now enforced on all seven surfaces.** Records
   previously reachable by id despite being filtered from the collection now
   return 404. Only affects function-style `access` users, for whom the old
   behaviour was the bypass.
5. **A predicate that throws is treated as a denial** rather than propagating to
   Express's default 500 handler. So is an `access()` that throws.
6. **`access()` returning a bare string is one permission, not full access.**
   `AccessMethod` declares `string` legal, and it previously fell through every
   branch and granted all four operations — `return 'read'` allowed `DELETE`.
   It is now equivalent to `['read']`. Any other unrecognised shape (an object,
   a number) now returns `403` rather than granting full access.

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

The ORM provides a powerful middleware-based hook system that allows you to run custom logic before and after CRUD operations. Hooks are perfect for validation, transformation, side effects, authorization, and auditing.

### Overview

Hooks run at key points in the request lifecycle:

- **Before hooks**: Run before the operation executes. **Can halt operations** by returning a value (status code or response object).
- **After hooks**: Run after the operation completes (logging, notifications, cache invalidation).

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
  oldState,                  // Previous record state (update/delete operations only)
  recordId,                  // Record ID (delete operations in after hooks)
}
```

**Important Notes**:
- `oldState` is only available for `update` and `delete` operations
- It contains a deep copy of the record's state **before** the operation executes (captured before the `before` hook fires)
- The deep copy is created via JSON serialization (`JSON.parse(JSON.stringify())`) to ensure complete isolation
- For `delete` operations, `recordId` is provided in after hooks since the record may no longer exist in the store
- `oldState` is captured as a deep copy of the record's data before the operation, providing access to the previous field values

### Usage Examples

#### Basic Hook Registration

```javascript
import { beforeHook, afterHook } from '@stonyx/orm';

// Validation before creating - can halt by returning a value
beforeHook('create', 'animal', (context) => {
  const { age } = context.body.data.attributes;
  if (age < 0) {
    return 400; // Halt with 400 Bad Request
  }
  // Return undefined to continue
});

// Logging after updates
afterHook('update', 'animal', (context) => {
  console.log(`Animal ${context.record.id} was updated`);
});
```

#### Halting Operations

Before hooks can halt operations by returning a value:

```javascript
import { beforeHook } from '@stonyx/orm';

// Return a status code to halt with that HTTP status
beforeHook('create', 'animal', (context) => {
  if (!context.body.data.attributes.name) {
    return 400; // Bad Request
  }
});

// Return an object to send a custom response
beforeHook('delete', 'animal', (context) => {
  const animal = store.get('animal', context.params.id);
  if (animal.protected) {
    return { errors: [{ detail: 'Cannot delete protected animals' }] };
  }
});

// Return undefined (or nothing) to allow operation to continue
beforeHook('update', 'animal', (context) => {
  console.log('Update proceeding...');
  // No return = operation continues
});
```

#### Data Transformation

```javascript
// Normalize data before saving
beforeHook('create', 'owner', (context) => {
  const attrs = context.body.data.attributes;
  if (attrs.email) {
    attrs.email = attrs.email.toLowerCase().trim();
  }
});
```

#### Side Effects

```javascript
// Send notification after animal is adopted (using oldState to detect changes)
afterHook('update', 'animal', async (context) => {
  // Use oldState to compare before/after values
  if (context.oldState && context.oldState.owner !== context.record.owner) {
    await sendNotification({
      type: 'adoption',
      animalId: context.record.id,
      previousOwner: context.oldState.owner,
      newOwner: context.record.owner
    });
  }
});

// Cache invalidation
afterHook('delete', 'animal', async (context) => {
  await cache.invalidate(`owner:${context.params.id}:pets`);
});
```

#### Change Detection

The `oldState` property (available for `update` and `delete` operations) enables precise change tracking:

```javascript
// Detect specific field changes
afterHook('update', 'animal', async (context) => {
  if (!context.oldState) return; // No old state for create operations

  // Check if a specific field changed
  if (context.oldState.age !== context.record.age) {
    console.log(`Age changed from ${context.oldState.age} to ${context.record.age}`);
  }

  // Track multiple field changes
  const changedFields = [];
  for (const key of Object.keys(context.oldState)) {
    if (context.oldState[key] !== context.record[key]) {
      changedFields.push(key);
    }
  }

  if (changedFields.length > 0) {
    console.log(`Fields changed: ${changedFields.join(', ')}`);
  }
});

// Access deleted record data
afterHook('delete', 'animal', async (context) => {
  console.log(`Deleted animal: ${context.oldState.type} (age: ${context.oldState.age})`);
  // oldState contains full snapshot of the deleted record
});
```

#### Authorization

```javascript
// Additional access control - halt with 403 if unauthorized
beforeHook('delete', 'animal', (context) => {
  const user = context.state.currentUser;
  const animal = store.get('animal', context.params.id);

  if (animal.owner !== user.id && !user.isAdmin) {
    return 403; // Forbidden
  }
});
```

#### Auditing

```javascript
// Audit log for all changes with field-level change tracking
afterHook('update', 'animal', async (context) => {
  // Compare oldState with current record to capture exact changes
  const changes = {};
  if (context.oldState) {
    for (const key of Object.keys(context.oldState)) {
      if (context.oldState[key] !== context.record[key]) {
        changes[key] = { from: context.oldState[key], to: context.record[key] };
      }
    }
  }

  await auditLog.create({
    operation: 'update',
    model: context.model,
    recordId: context.record.id,
    userId: context.state.currentUser?.id,
    timestamp: new Date(),
    changes // Precise field-level changes: { age: { from: 2, to: 3 } }
  });
});

// Audit deletes with full record snapshot
afterHook('delete', 'animal', async (context) => {
  await auditLog.create({
    operation: 'delete',
    model: context.model,
    recordId: context.recordId,
    userId: context.state.currentUser?.id,
    timestamp: new Date(),
    deletedData: context.oldState // Full snapshot of deleted record
  });
});
```

#### Error Handling

For after hooks, wrap in try/catch if errors should not propagate:

```javascript
afterHook('create', 'animal', async (context) => {
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
import { beforeHook } from '@stonyx/orm';

// Get unsubscribe function
const unsubscribe = beforeHook('create', 'animal', handler);

// Later, remove the hook
unsubscribe();
```

#### Clearing Hooks

```javascript
import { clearHook, clearAllHooks } from '@stonyx/orm';

// Remove all hooks for a specific operation:model
clearHook('create', 'animal');

// Remove only before hooks
clearHook('create', 'animal', 'before');

// Remove only after hooks
clearHook('create', 'animal', 'after');

// Remove ALL hooks (useful for testing)
clearAllHooks();
```

### Advanced Patterns

#### Conditional Hooks

```javascript
beforeHook('update', 'animal', (context) => {
  // Only validate if age is being updated
  if ('age' in context.body.data.attributes) {
    const { age } = context.body.data.attributes;
    if (age < 0 || age > 50) {
      return 400; // Bad Request
    }
  }
});
```

#### Cross-Model Hooks

```javascript
// Update owner's pet count when animal is created
afterHook('create', 'animal', async (context) => {
  const owner = store.get('owner', context.record.owner);
  if (owner) {
    owner.petCount = (owner.petCount || 0) + 1;
  }
});
```

#### Sequential Middleware

```javascript
// Multiple hooks run in registration order
beforeHook('create', 'post', (context) => {
  console.log('First middleware');
  context.customData = { checked: true };
});

beforeHook('create', 'post', (context) => {
  console.log('Second middleware');
  // Can access data from previous hooks
  if (!context.customData?.checked) {
    return 403;
  }
});
```

### Hook Execution Order

1. **Before hooks** fire first (sequentially, in registration order)
2. **Main operation** executes (if no before hook halted)
3. **After hooks** fire last (sequentially, in registration order)

Before hooks can halt the operation by returning a value. After hooks run after completion and cannot halt.

### Best Practices

1. **Keep hooks focused**: Each hook should do one thing well
2. **Use async/await**: Hooks support async functions for consistency
3. **Return values intentionally**: Only return a value from before hooks when you want to halt
4. **Document side effects**: Make it clear what each hook does
5. **Test hooks independently**: Write unit tests for hook logic
6. **Avoid heavy operations**: Keep hooks fast to maintain performance
7. **Clean up in tests**: Use `clearAllHooks()` in test teardown

### Testing Hooks

```javascript
import { beforeHook, clearAllHooks } from '@stonyx/orm';

// Clean up after each test
afterEach(() => {
  clearAllHooks();
});

// Test that validation hook halts with 400
test('validation hook rejects negative age', async () => {
  beforeHook('create', 'animal', (context) => {
    if (context.body.data.attributes.age < 0) {
      return 400;
    }
  });

  const response = await fetch('/animals', {
    method: 'POST',
    body: JSON.stringify({
      data: { attributes: { age: -5 } }
    })
  });

  assert.strictEqual(response.status, 400, 'Hook halted with 400');
});
```

## Exported Helpers

| Export          | Description                                                             |
| --------------- | ----------------------------------------------------------------------- |
| `attr`          | Define model attributes with type-safe proxy.                           |
| `belongsTo`     | Define a one-to-one relationship.                                       |
| `hasMany`       | Define a one-to-many relationship.                                      |
| `createRecord`  | Instantiate a record with proper serialization and relationships.       |
| `updateRecord`  | Update an existing record with new data.                                |
| `store`         | Singleton store for all model instances.                                |
| `relationships` | Access all relationships (`hasMany`, `belongsTo`, `global`, `pending`). |
| `beforeHook`    | Register a before hook that can halt operations.                        |
| `afterHook`     | Register an after hook for post-operation logic.                        |
| `clearHook`     | Clear hooks for a specific operation:model.                             |
| `clearAllHooks` | Clear all registered hooks (useful for testing).                        |

## Project Structure

For a full architectural reference, see [project-structure.md](project-structure.md).

## License

Apache 2.0 — see [LICENSE.md](LICENSE.md).
