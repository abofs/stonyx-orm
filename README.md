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

> **Do not reconstruct the request path inside `access()`. Read
> [Identifying the collection](#identifying-the-collection) before copying this.**
> Every attempt to identify the collection by parsing the request target has
> failed **open** — five distinct variants of this same example, each found only
> after the previous was fixed, by five different people. The sample below does
> not parse anything: it reads `request.baseUrl`, the mount Express actually
> matched.
>
> That is still a stopgap. **The real fix is
> [#202](https://github.com/abofs/stonyx-orm/issues/202)** — `access()` should
> receive the model, the operation and the record, so there is nothing to
> identify. Until it lands, prefer the array shape (`['read']`) or `false` where
> you can: the **function** shape is the one that requires any matching at all.
> The same warning is repeated at the top of `src/orm-request.ts`, which ships;
> the longer write-up in `docs/usage-patterns.md` does **not** ship, so this
> README and that source header are the two copies a consumer sees.
>
> This sample is the same code as the shipped test fixture, and a test asserts
> the two `access()` bodies are identical line for line. For four rounds they
> were two independently written copies — and the fifth fail-open variant was
> found in the one nothing was mutating.

```js
export default class GlobalAccess {
  models = ['owner', 'animal'];

  access(request) {
    // `request.baseUrl` is the mount Express matched — `/owners`, or
    // `/api/owners` under ORM_REST_ROUTE=/api. Never parse `originalUrl`: it is
    // the raw request target and can be absolute-form.
    const mount = request.baseUrl;

    // FAIL CLOSED. If Express did not tell us what it matched we are not behind
    // the mount we think we are, and an unidentifiable request denies rather
    // than falling through to the CRUD grant at the bottom.
    if (typeof mount !== 'string' || mount === '') return false;

    // Lower-cased because the router matched case-INSENSITIVELY, and a matcher
    // stricter than the router that dispatched the request can be stepped
    // around. The PATH only — record ids stay at their real case below.
    const collection = mount.toLowerCase();

    // `request.path` is mount-relative and query-free, so sub-path rules need no
    // prefix arithmetic either. false → 403 for the whole request.
    const path = String(request.path ?? '').toLowerCase();

    if (collection.endsWith('/owners')) {
      if (path === '/archived' || path.startsWith('/archived/')) return false;

      // Returning a function plugs it in as a per-record filter, and it is
      // enforced on every surface addressed to one of these records:
      //   /owners, /owners/:id, /owners/:id/pets, /owners/:id/relationships/pets
      // A rejected record is 404 on record routes — the same status as a record
      // that does not exist — so the filter is not an existence oracle.
      return record => record.id !== 'angela' && record.id !== 'restricted';
    }

    // `record.owner` resolves to an OrmRecord, not to the owner's id string —
    // comparing it directly against a string is the bug that made this predicate
    // inert. Deliberately NO `?? record.owner` fallback: accepting the raw
    // shape as well as the resolved one would absorb a resolution regression
    // silently, which is exactly what blinded this fixture before.
    if (collection.endsWith('/animals')) return record => record.owner?.id !== 'restricted';

    // Allows full access to all calls that don't match any of the above conditions
    return ['read', 'create', 'update', 'delete'];
  }
}
```


### The access context (second argument)

`access()` is called with **two** arguments:

```js
access(request, { model, operation })
```

The second is the **access context** — the structural facts about the request,
which the framework already holds at authorization time. Read these instead of
parsing anything.

| Key | Value |
|---|---|
| `model` | The model this route was mounted for, as a **model name**: kebab-case, exactly as declared under `config.orm.paths.model` and keyed in the store — `'owner'`, `'animal'`, `'phone-number'`. **Not** the pluralized, dasherized, mount-prefixed *route* name. |
| `operation` | One of **`'read'`, `'create'`, `'update'`, `'delete'`** — and no second vocabulary. Never an HTTP method name like `'GET'`. `undefined` when the dispatched method has no entry in the framework's method map. |

So a predicate can be written without reference to any URL:

```js
export default class OwnerAccess {
  models = ['owner'];

  access(request, { model, operation }) {
    if (model === 'owner' && operation === 'read') {
      return record => record.id !== 'angela';
    }

    return ['read'];
  }
}
```

There is no string to parse, no variant to miss, and no way to fail open through
a URL shape nobody anticipated. `model` is fixed at mount time and no request
can influence it — not a mount prefix, not a query string, not a case-varied
path, not an absolute-form request target.

The four `operation` values are the same four strings the permission-array
return shape is written in (`['read', 'create', 'update', 'delete']`), because
both come from one method map inside the framework. The two forms cannot
disagree about the same request.

**`operation` is `undefined`, never defaulted, for an unmapped method.** Express
delivers `HEAD` to the `GET` handler, so this is reachable. It is deliberately
not defaulted to `'read'`: a fabricated operation would turn an unclassified
request into an authorized one. Treat `undefined` as *not classified* and deny.

**The second argument is additive.** JavaScript ignores extra arguments, so an
existing `access(request)` predicate keeps working exactly as it did. Nothing
needs to be migrated to keep running — but note that argument **one** is still
the raw request, so the warning in
[Identifying the collection](#identifying-the-collection) still applies to any
predicate that reads it.

#### `record` is not in the context

Deliberately, and it is not an oversight. `auth()` runs after route matching but
**before any handler executes**, so nothing has been fetched yet. Supplying a
record would force a pre-fetch on every request — a second store hit, a new
failure mode, and an ordering change in the middle of an authorization path.

It is also unnecessary: the **function** return shape already *is* the
per-record hook. Return `(record) => boolean` and the handlers apply it to every
record the request touches. Auth-time and record-time are separate decision
points, and the contract keeps them separate.

#### Reaching another model's predicate

The model → predicate map is published on the ORM instance at boot, before any
route is mounted, so a predicate can be resolved by model name and asked about a
request routed to a *different* model:

```js
import Orm from '@stonyx/orm';

const predicate = Orm.instance.getAccess('animal');
const verdict = predicate?.(request, { model: 'animal', operation: 'read' });
```

`Orm.instance.getAccess(modelName)` returns the predicate, or `undefined` when
that model has no access class. The raw map is `Orm.instance.accessFunctions`, keyed
by model name; prefer `getAccess()`.

Passing the context explicitly is what makes the answer **model-correct**. A
predicate that identifies its collection from the request would otherwise answer
about the collection the request is *addressed to* while being asked about
another one — and per the five variants below, it answers wrong in the direction
that grants access.

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
every endpoint that is addressed to a record — not only on the collection.

It is evaluated against the record the route is *addressed to*, **on that model
only**. It is not a guarantee that a hidden record cannot be reached or modified:
a write to a *different* collection can still re-parent one. See
[Known limitations](#known-limitations) and
[#207](https://github.com/abofs/stonyx-orm/issues/207).

| Endpoint | A record the predicate rejects |
|---|---|
| `GET /:models` | omitted from the collection |
| `GET /:models/:id` | `404` |
| `GET /:models/:id/{relationship}` | `404` — the **addressed** record is filtered, not the related one |
| `GET /:models/:id/relationships/{relationship}` | `404` — same |
| `PATCH /:models/:id` | `404`, no attribute is applied |
| `DELETE /:models/:id` | `404`, the record is not removed and no SQL `DELETE` is issued |
| `POST /:models` | `403`, and a record **this request inserted** is rolled back — see [Known limitations](#known-limitations) for the case where it did not insert one |

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

### Identifying the collection

**Do not reconstruct the request path.** Every version of this sample that tried
to has failed **open**, and each variant was found only after the previous one
was fixed:

| # | Variant | Why it fails open |
|---|---|---|
| 1 | match `request.url` | `RestServer.mountRoute` mounts each model as an Express **sub-app**, so `url` is mount-relative — `GET /owners/angela` arrives as `/angela`. A `/owners` prefix match is **always false**, so the branch never fires and `access()` falls through to whatever it returns last. |
| 2 | anchored match on a raw `request.originalUrl` | `originalUrl` carries the query string, so `=== '/owners'` misses `/owners?filter[age]=30` and that collection comes back unfiltered. `endsWith('/owners')` is the older half of the same trap: it leaves every record route unguarded. |
| 3 | case-sensitive matcher | `RestServer` mounts with a bare `express()`, whose default is `caseSensitive: false`. A matcher stricter than the router that dispatched the request can simply be stepped around: `GET /owners/angela` → 404 but `GET /OwNeRs/angela` → 200 in full, and `DELETE /ANIMALS/22` destroyed a hidden record. Router-side fix: [stonyx-rest-server#47](https://github.com/abofs/stonyx-rest-server/issues/47). |
| 4 | hard-coded `/owners` | With `ORM_REST_ROUTE=/api` every url becomes `/api/owners/...` and the sample matches nothing — environment-specifically, which is harder to notice than failing everywhere. The remediation this document used to give was itself broken: `` `${config.orm.restServer.route}owners` `` evaluates to **`/apiowners`**, so a reader who followed the correction exactly still failed open and believed they had handled it. |
| 5 | any match on `originalUrl` at all | HTTP/1.1 permits an **absolute-form** request-target. Express routes on `parseurl(req).pathname`, so the request dispatches normally — but `originalUrl` is the raw target. `GET http://anything.example/owners/angela` yields `originalUrl === 'http://anything.example/owners/angela'`, which has no `/owners` prefix. Measured: the record came back in full, `DELETE` succeeded, and it walked past a hard `return false` deny the same way. |

**The fix is not a sixth rule.** It is to stop parsing:

**Use `request.baseUrl`.** It is the mount Express *actually matched* when it
dispatched the request. It carries no query string (variant 2), it is not
mount-relative (variant 1), it already contains the configured `ORM_REST_ROUTE`
prefix (variant 4 — there is nothing left to derive, so `/apiowners` is
unconstructible), and it is unaffected by an absolute-form target (variant 5).

| request | `request.url` | `request.originalUrl` | `request.baseUrl` | `request.path` |
|---|---|---|---|---|
| `GET /owners` | `/` | `/owners` | `/owners` | `/` |
| `GET /owners/angela` | `/angela` | `/owners/angela` | `/owners` | `/angela` |
| `GET /owners/angela?filter[age]=30` | `/angela?filter[age]=30` | `/owners/angela?filter[age]=30` | `/owners` | `/angela` |
| `GET /OwNeRs/angela` | `/angela` | `/OwNeRs/angela` | `/OwNeRs` | `/angela` |
| `GET http://anything.example/owners/angela` | `http://anything.example/angela` | `http://anything.example/owners/angela` | `/owners` | `/angela` |
| `GET /api/animals/22` (`ORM_REST_ROUTE=/api`) | `/22` | `/api/animals/22` | `/api/animals` | `/22` |

Two rules remain, and they are the whole list:

**1. Compare lower-cased.** `baseUrl` is the text the caller sent, not the
registered mount — `GET /OwNeRs/angela` yields `/OwNeRs`. The router matched it
case-insensitively, so a case-sensitive comparison here is stricter than the
router and can be walked past. Lower-case the **mount and path only**; record ids
are case-sensitive and must be compared at their real case.

**2. Fail closed when `baseUrl` is absent.** `String(request.originalUrl ?? '')`
was added to stop a `TypeError`, and it traded fail-closed for fail-**open**: an
empty string matches no collection, so `access()` fell through to the permission
array and granted full CRUD. An input you cannot identify must **deny**.

Use `request.path` — mount-relative and query-free — if you need to distinguish
sub-paths beneath the mount, as the `/archived` deny above does.

### Known limitations

- **A function-style filter is not a guarantee that a hidden record cannot be
  modified.** A write to a *different* collection can re-parent one and de-hide
  it: `POST /owners` (or `PATCH /owners/{id}`) carrying
  `relationships: { pets: { data: { id: 21 } } }` — or
  `attributes: { pets: [21, 22] } `, which never enters the relationships loop at
  all — re-parents animal 21 onto an owner the caller is permitted to write. The
  animal's `owner` is the field the `/animals` predicate reads, so the record
  stops being rejected: it becomes readable through `GET /animals/21` and
  deletable through `DELETE /animals/21`. **Reachable unauthenticated** wherever
  one collection is writable and another is filtered on a field the first can
  set. Blocking it requires checking animal 21 against the **animal** model's
  predicate while servicing an **owners** route — cross-model access resolution,
  which the contract could not express before
  [#202](https://github.com/abofs/stonyx-orm/issues/202): `access()` never
  received the model structurally and `setup-rest-server.ts` discarded the
  model→predicate map at boot. **#202 has landed and both halves now exist** —
  see [The access context](#the-access-context-second-argument): `context.model`
  makes the answer model-correct and `Orm.instance.getAccess(modelName)` makes
  another model's predicate reachable. **The mechanism exists; the ORM does not
  yet use it on this path.** The re-parenting write above is still unblocked —
  that enforcement is
  [#196](https://github.com/abofs/stonyx-orm/issues/196) and
  [#207](https://github.com/abofs/stonyx-orm/issues/207), which were blocked on
  #202 and are now unblocked. Until they land, do not rely on a filter to keep a
  record unmodifiable; keep the *writable* collections' predicates as tight as
  the hidden ones.
- **Authorization by identifying the collection is a consumer-side
  reconstruction of information the framework already holds.** `access()`
  receives a transport artifact and is asked to work out which model, which
  operation and which record the request addresses. The five variants above are
  the five ways that has been observed to fail open so far. Tracked as
  [#202](https://github.com/abofs/stonyx-orm/issues/202).
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
- **A `relationships` key that is not a declared relationship is still applied
  to the record.** The key comes verbatim from the request body and is checked
  against nothing except `id`, which is stripped. On a `POST` that makes an
  undeclared key a mass-assigned attribute; on a `PATCH` it is passed to
  `updateRecord`. `id` is stripped in both handlers because it defeats breaking
  change 3 above; the general form is tracked as
  [#204](https://github.com/abofs/stonyx-orm/issues/204).
- **A `POST` body `id` that the duplicate check cannot resolve can still
  overwrite a different record on an unfiltered collection.** The lookup is
  correct and deliberately does not coerce: `"9105h"` is rejected as a string
  rather than truncated, and `9105.5`, `[9105]` and `true` are passed through as
  themselves. The model's id transform then coerces anyway — a bare `parseInt`
  with no such guard — so the create lands on `9105` (or on `NaN`) and
  overwrites whatever is there. **This is not string-only**: any body id whose
  transform output differs from its lookup key is the same defect. Filtered
  collections are unaffected — breaking change 3 refuses any client-supplied id
  — so this reaches consumers with **no** function-style filter. Tracked as
  [#205](https://github.com/abofs/stonyx-orm/issues/205), alongside
  [#203](https://github.com/abofs/stonyx-orm/issues/203), which is the other way
  a create can land on an id nobody named.
- **`context.record` is `undefined` for an after-`create` hook when a string-id
  model is given a numeric-looking id.** The post-create lookup uses the same id
  coercion as every other surface, which resolves `'9107'` to the number `9107`,
  while a model declaring `id = attr('string')` files the record under the string
  key. The create itself succeeds and `context.response.data` is correct; only
  the hook's view of the record is wrong, and it is wrong *silently*. Tracked as
  [#209](https://github.com/abofs/stonyx-orm/issues/209).
- **A denied `POST` rolls back only a record it *inserted*.** The rollback
  requires the store to have grown, because removing by id alone is a write
  primitive keyed by a caller-supplied value. When `assignRecordId` lands a
  **server-assigned** id on an occupied slot
  ([#203](https://github.com/abofs/stonyx-orm/issues/203) — it returns
  last-*inserted* + 1, not max + 1, so a store whose insertion order is not
  ascending collides), `createRecord` updates that record **in place**: the map
  does not grow, the rollback correctly declines to remove a record this request
  did not create, and the `403` leaves the caller's attributes on someone else's
  record. Narrow — it needs a non-ascending insertion order — but it is the
  reachability condition, so it is stated rather than implied.

### Breaking changes

These land in the next published build. There is no changelog or release-notes channel yet
([stonyx-workflows#17](https://github.com/abofs/stonyx-workflows/issues/17)), so
they are recorded here.

1. **`DELETE /{collection}/{id}` on a record that does not exist returns `404`
   instead of `204`.** This affects **every** consumer issuing a DELETE against
   any mounted collection, whether or not an access filter is configured, and
   `models: '*'` mounts every model by default. It is not optional: if a denied
   delete returned 404 while a missing one returned 204, the pair would be a
   perfect existence oracle and the filter would be worthless.
2. **After-hooks no longer fire for a request that failed** — denied, missing,
   `400` or `409`. The gate is on the handler's status, not on the operation, so
   it covers reads as well: a `GET /:id` that answers 404 runs no after-`get`
   hook either. Previously `afterHook('delete', ...)` ran with a populated
   `context.recordId` on a request that deleted nothing, so a consumer cascade
   destroyed children behind a 404.
3. **`POST` with a client-supplied `id` returns `403` when a function-style
   `access` filter is in force**, whatever the payload and whether or not the id
   exists, and *before* any store lookup — so neither the status nor the lookup
   cost can depend on whether that id exists. Only affects function-style
   `access` users. See [Filter functions](#filter-functions) for why, and let the
   server assign the id instead. `409`-on-duplicate is unchanged for everyone
   else.

   "Whatever the payload" is a statement about the **`id` member of the resource
   object**, and it holds only because that is the sole channel a caller id can
   arrive on. It was not always: a caller id moved into
   `relationships: {"id": {"data": {"id": 21}}}` reached `createRecord` past this
   refusal and overwrote a hidden record in place. Both strips — `attributes.id`
   and `relationships.id` — are part of this behaviour, not tidiness. A future
   change that adds a third channel without stripping it re-opens the oracle;
   see [#204](https://github.com/abofs/stonyx-orm/issues/204).
4. **Function-style `access` is now enforced on all seven surfaces.** Records
   previously reachable by id despite being filtered from the collection now
   return 404. Only affects function-style `access` users, for whom the old
   behaviour was the bypass.

   "Seven surfaces" means the seven endpoints of **the filtered model**. A write
   to another collection can still reach one of its records through a
   relationship — [#207](https://github.com/abofs/stonyx-orm/issues/207), which
   is **not** closed here.
5. **A predicate that throws is treated as a denial** rather than propagating to
   Express's default 500 handler. So is an `access()` that throws.
6. **`access()` returning a bare string is one permission, not full access.**
   `AccessMethod` declares `string` legal, and it previously fell through every
   branch and granted all four operations — `return 'read'` allowed `DELETE`.
   It is now equivalent to `['read']`. Any other unrecognised shape (an object,
   a number) now returns `403` rather than granting full access.
7. **`POST` with a client-supplied `id` normalises the body id before the
   duplicate check**, so an id shape that previously *missed* the store's key
   now finds it. `POST {"id":"0x2391"}` and `POST {"id":"  21  "}` answer `409`
   where they answered `200`, and the `200` was not a success: the lookup missed,
   the duplicate check was skipped, and `createRecord` overwrote the colliding
   record in place. **This one reaches consumers with no filter at all** — the
   population breaking changes 3 and 4 explicitly exempt. If you were relying on
   a hex-shaped or whitespace-padded id creating a second record, it never did.

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

  // `context.oldState` — NOT a store lookup. For `update` and `delete` the ORM
  // has already fetched the record (and already applied the access filter to
  // it) before this hook runs, so re-fetching it here is a fourth id coercion
  // that has to agree with three others.
  //
  // And it would not agree. `context.params.id` is the raw url segment, always
  // a string, while the store keys numeric-id models by NUMBER — so
  // `store.get('animal', '21')` misses the record held under `21`, and so does
  // `store.find('animal', '21')`: neither coerces. The miss reads as "no such
  // record", which in an authorization hook fails whichever way your code
  // happens to handle a null.
  const animal = context.oldState;

  if (animal.owner !== user.id && !user.isAdmin) {
    return 403; // Forbidden
  }
});
```

> If you do need a lookup for some *other* model inside a hook, coerce the id
> yourself to the type that model's `id` attribute declares — the store is a
> `Map` and `'21'` and `21` are different keys.

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

1. **Authorization is evaluated first for `update` and `delete`.** A record the
   access filter rejects returns `404` **before any before-hook runs**, so a
   hook never sees a record — or a `context.oldState` — that the caller is not
   allowed to read. `create` is the exception: there is no record to test until
   the handler has built one, so `beforeHook('create', ...)` **does** fire for a
   `POST` that goes on to answer `403`.
2. **Before hooks** fire next (sequentially, in registration order).
3. **Main operation** executes (if no before hook halted).
4. **After hooks** fire last (sequentially, in registration order) — **only if
   the request succeeded.**

Before hooks can halt the operation by returning a value, and that value becomes
the response.

**After hooks do not run for a failed request.** Any status `>= 400` — denied,
missing, `400`, `409` — skips the entire after-hook pipeline, along with SQL
persistence and `onUpdate` autosave. This is a behaviour change; see
[Breaking changes](#breaking-changes). It applies to the samples above: the
`afterHook('delete', ...)` auditing hook writes **no** audit row for a `DELETE`
that answered `404`, and the `afterHook('update', ...)` change-tracking hook
writes none for a `PATCH` that answered `404` or `400`. If you need a record of
refused requests, log them from a before-hook or from your own middleware —
`after<operation>` fires only for an operation that actually happened.

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
