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
> after the previous was fixed, by five different people. That section is now a
> record of what not to do, not a matching recipe: the sample below reads `model`
> from [the access context](#the-access-context-second-argument) and never looks
> at the mount at all, so variants 1, 2, 4 and 5 are **unconstructible** against
> it rather than merely handled. **Variant 3 survives.** It is the general shape
> "a hand-written matcher normalises differently from the router", and the
> migrated sample still runs one string comparison — the `/archived` sub-path
> deny — which folds case but does not decode, so `GET /owners/%61rchived` steps
> past it ([#228](https://github.com/abofs/stonyx-orm/issues/228)).
>
> **Superseded 2026-09-01 by [#236](https://github.com/abofs/stonyx-orm/issues/236) /
> [#237](https://github.com/abofs/stonyx-orm/issues/237), and left standing rather
> than rewritten.** Both claims above are now false: `#228` is **closed**, and the
> one string comparison variant 3 lived in is gone — the sample below compares the
> **decoded `recordId`** the access context supplies, so there is no comparison
> left to step around. The paragraph about `request.path` further down is
> superseded the same way. Nothing here is deleted because the same "variant 3
> survives" wording sits at four sites (this file twice, `src/orm-request.ts`, and
> the test fixture) and retiring one of four leaves the shipped copies
> contradicting each other; retiring all four **with the measurement that retires
> them** is [#238](https://github.com/abofs/stonyx-orm/issues/238), which also owns
> this blockquote and the reference section below.
>
> That is still a stopgap. **The real fix is
> [#202](https://github.com/abofs/stonyx-orm/issues/202)** — `access()` should
> receive the model, the operation and the record, so there is nothing to
> identify. Until it lands, prefer the array shape (`['read']`) or `false` where
> you can: the **function** shape is the one that requires any matching at all.
>
> The one read of argument **one** that survives is `request.path`, for the
> `/archived` sub-path deny — and it has to. The context names which model and
> which verb, not which route, so that deny **cannot be expressed from the
> context alone** and a context-only rewrite would silently turn it into an
> allow.
>
> **Superseded 2026-09-01 by [#236](https://github.com/abofs/stonyx-orm/issues/236) /
> [#237](https://github.com/abofs/stonyx-orm/issues/237)** — see the dated note
> above. No read of argument **one** survives in the sample below: the context
> carries `recordId`, the decoded route-parameter id, so the `/archived` deny **is**
> expressible from the context alone. It still must not be dropped — expressible is
> not optional. Retirement of this wording:
> [#238](https://github.com/abofs/stonyx-orm/issues/238).
>
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

  access(request, { model, operation, recordId }) {
    // `model` is the model this route was mounted for. It is assigned once, at
    // mount time, and no request can influence it — not a mount prefix, not a
    // query string, not a case-varied path, not an absolute-form request
    // target. `recordId` is the record this route was ADDRESSED TO, decoded by
    // the router and coerced to the key the store lookup uses. Nothing below
    // parses anything, and since abofs/stonyx-orm#236 nothing below reads
    // argument one AT ALL. Variants 1, 2, 4 and 5 were already unconstructible;
    // the sub-path STRING COMPARISON that variant 3 lived in is gone too,
    // replaced by a comparison against the decoded id. Retiring the "variant 3
    // survives" wording at the four sites that still carry it — with the
    // measurement that retires it, rather than by deletion — is
    // abofs/stonyx-orm#238.
    //
    // `operation` is destructured to name the whole contract at the point of
    // use. This sample's rules are per-model and per-record rather than
    // per-verb, so it does not branch on it; the permission array at the bottom
    // is where the verb is answered.

    // FAIL CLOSED ON AN UNIDENTIFIABLE MODEL. `model` is absent for any caller
    // that resolved this predicate without supplying the context, and a request
    // this function cannot identify DENIES rather than falling through to the
    // CRUD grant at the bottom. An unidentifiable input must never be the
    // permissive path.
    if (typeof model !== 'string' || model === '') return false;

    if (model === 'owner') {
      // FAIL CLOSED ON AN ABSENT `recordId` TOO, AND `undefined` IS THE ONLY
      // SPELLING OF ABSENT. `auth()` ALWAYS sets the key — `null` on a
      // collection route, which is addressed to no record — so `undefined`
      // means the context did not come from `auth()`: it was hand-assembled by
      // a caller resolving this predicate through the documented
      // `Orm.instance.getAccess()` path. Letting that through would fall
      // straight to the per-record filter below, which is a DENY becoming an
      // ALLOW. This is the same rule the old guard on `request.path` enforced,
      // moved to the argument this predicate now actually reads.
      if (recordId === undefined) return false;

      // THE `/archived` DENY, EXPRESSED AGAINST THE DECODED ID. It used to be
      // `request.path.toLowerCase()` compared against `'/archived'`, and that
      // was wrong in both directions at once.
      //
      // TOO PERMISSIVE: express sets `request.path` from the RAW pathname while
      // the router DECODES `:id`, so `GET /owners/%61rchived` reached the
      // comparison as `/%61rchived`, walked past the deny and was dispatched as
      // the record `archived` — 200 with the record in full, and DELETE
      // answered 204 with the record DESTROYED, unauthenticated. 255
      // non-canonical spellings of that 8-character id decode to the same key,
      // so no deny-list of spellings was ever going to close it.
      //
      // TOO STRICT: a record id is a VALUE, not a literal route segment, and
      // express's `case sensitive routing` governs literal segments only. With
      // a distinct owner seeded at `ARCHIVED`, the `.toLowerCase()` 403'd
      // `GET /owners/ARCHIVED` — the wrong record — while still admitting
      // `GET /owners/%41RCHIVED`, the same record encoded.
      //
      // SO DO NOT NORMALISE `recordId`. It is already decoded, exactly ONCE,
      // which is what a route parameter means: `/owners/%2561rchived` is the
      // legitimate id `%61rchived`, and decoding until stable would deny it. Do
      // not case-fold it. Do not rebuild it from `request.path` — decoding the
      // whole path decodes THEN splits while the router splits THEN decodes,
      // which over-denies the distinct record at `/owners/archived%2fx`.
      //
      // THE DENY IS NOW EXPRESSIBLE FROM THE CONTEXT ALONE, which is exactly
      // what `recordId` bought — and it still must not be dropped. Deleting it
      // does not remove a rule loudly, it turns a deny into an ALLOW, silently.
      if (recordId === 'archived') return false;

      // Returning a function plugs it in as a per-record filter. It is enforced
      // on every surface addressed to one of these records —
      //   /owners, /owners/:id, /owners/:id/pets, /owners/:id/relationships/pets
      // — AND, since #232, on every surface that reaches one of these records
      // as the RELATED resource of another model:
      //   /animals/:id/owner, /animals/:id/relationships/owner
      // Both readings are the same rule: an owner this predicate rejects is
      // withheld wherever she is reachable, not only on /owners.
      //
      // NOTHING HERE IS AN EXISTENCE ORACLE, AND THE SPELLING DIFFERS BY WHOSE
      // RECORD IS BEING REJECTED. A rejected ADDRESSED record is 404 — the same
      // status as a record that does not exist. A rejected RELATED record is
      // `data: null` at 200 — byte-identical to a relationship that is
      // genuinely empty, because on those routes 404 is already the answer for
      // a PARENT that does not exist. In both cases "rejected" and "not there"
      // are the same answer, which is the property that matters.
      return record => record.id !== 'angela' && record.id !== 'restricted';
    }

    // `record.owner` resolves to an OrmRecord, not to the owner's id string —
    // comparing it directly against a string is the bug that made this predicate
    // inert. Deliberately NO `?? record.owner` fallback: accepting the raw
    // shape as well as the resolved one would absorb a resolution regression
    // silently, which is exactly what blinded this fixture before.
    // `record.id !== 18` hides one animal whose OWNER is permitted. It is the
    // fixture that makes the `hasMany` half of the relationship-route rules
    // observable: gina is served, animal 18 is not, and every surface that
    // names gina's pets has to drop it.
    if (model === 'animal') return record => record.owner?.id !== 'restricted' && record.id !== 18;

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
| `operation` | One of **`'read'`, `'create'`, `'update'`, `'delete'`** — and no second vocabulary *on this path*. Never an HTTP method name like `'GET'`, and **not** the hook vocabulary either (see [below](#operation-is-not-the-hook-operation)). `undefined` when the dispatched method has no entry in the framework's method map. |

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

#### What the context does not tell you: which surface

It names **which model and which verb**, not **which route**. Measured over the
live router, six surfaces produce one identical context:

```
GET /owners                          { model: 'owner', operation: 'read' }
GET /owners/gina                     { model: 'owner', operation: 'read' }
GET /owners/gina/pets                { model: 'owner', operation: 'read' }
GET /owners/gina/relationships/pets  { model: 'owner', operation: 'read' }
GET /owners/archived                 { model: 'owner', operation: 'read' }
GET /owners/gina?include=pets        { model: 'owner', operation: 'read' }
```

So a rule that depends on the **sub-path** still needs `request.path` —
mount-relative and query-free, and the one read of argument one that
[Identifying the collection](#identifying-the-collection) sanctions. The sample
access class shipped with this repo has such a rule: its `/archived` deny
**cannot be expressed from the context alone**, and a predicate migrated to
context-only would silently drop it — a deny becoming an allow.

**Superseded 2026-09-01 by [#236](https://github.com/abofs/stonyx-orm/issues/236) /
[#237](https://github.com/abofs/stonyx-orm/issues/237).** The context also carries
`recordId` — the record this route was addressed to, already decoded — so the
`/archived` deny **is** expressible from the context alone, and the shipped sample
no longer reads `request.path`. The full contract is `AccessContext.recordId` in
`src/types/orm-types.ts`, which ships. This section — the signature, the key table
and this paragraph — is corrected by
[#238](https://github.com/abofs/stonyx-orm/issues/238); the pointer is here because
what it currently says is an instruction, and the instruction is wrong.

Note also that the related-resource and `?include=` surfaces serve *another
model's* records under `model: 'owner'`, and the context gives a predicate no
signal that it is authorizing a related-resource route. That is
[#196](https://github.com/abofs/stonyx-orm/issues/196).

#### `operation` is not the hook `operation`

This module exposes a **second** `operation` vocabulary, on an identically-named
key of an identically-shaped context object:
[hook contexts](#hook-context-object) carry `list` / `get` / `create` /
`update` / `delete`. The access vocabulary collapses `list` and `get` into
`'read'`, so for one `GET /animals/1` a hook sees `'get'` while `access()` sees
`'read'` — and a predicate cannot distinguish a collection read from a
record read.

"No second vocabulary" above is a statement about the **access path**, where
both the context and the permission array come from one method map. It is not a
statement about the module. Writing `operation === 'get'` in a predicate never
matches, and a predicate that stops matching falls through to the permission
array — so the misreading is fail-open shaped. In TypeScript the exported
`AccessOperation` union makes it a compile error.

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
if (!predicate) return deny;

const verdict = predicate(request, { model: 'animal', operation: 'read' });
```

**`undefined` means no predicate could be resolved — not that the model is
unrestricted. Treat it as deny.** It covers a model with no access class *and* a
model whose access class failed to **load**: a load failure is caught and warned
about, and the partial map is published anyway, so a missing key is not evidence
of an unrestricted model. This is the same rule as `operation === undefined`
above, and for the same reason.

The raw map is `Orm.instance.accessFunctions`, keyed by model name; prefer
`getAccess()` — it is guarded against inherited `Object.prototype` members and a
direct index is not. Note that it maps a model name to the predicate of the
access *class* that claims it, which may claim many models: against this repo's
sample, `getAccess('owner') === getAccess('animal')`.

#### Passing the context makes a model-correct answer *possible*

It does not make the answer model-correct on its own. **The resolved predicate
has to read the context.** Against a predicate that ignores it the failure is
measurable. On a request Express dispatched to `GET /owners/angela`, asked about
**animals**, the sample as it shipped before
[#222](https://github.com/abofs/stonyx-orm/issues/222) answered:

```
getAccess('animal')(ownersRequest, { model: 'animal', operation: 'read' })
  ->  record => record.id !== 'angela' && record.id !== 'restricted'
```

That is the **owners** filter, and it returns `true` for animal 21 — the record
hidden on every animal surface. Under a mount such a predicate recognizes
neither way it is worse still: it falls through to
`['read', 'create', 'update', 'delete']`, a full CRUD grant. Either way the
context was supplied and the answer is not the animal answer, and it is wrong in
the direction that **grants** — because that predicate was single-argument and
identified its collection from the request, so it answered about the collection
the request was *addressed to* while being asked about another one.

The sample shipped with this repo has since been migrated to read the context,
and the same call now answers with the **animal** filter:

```
getAccess('animal')(ownersRequest, { model: 'animal', operation: 'read' })
  ->  record => record.owner?.id !== 'restricted'
```

A single-argument predicate remains the default in every consumer tree, and a
caller has no supported way to tell which kind it resolved. The boot-time arity
warning that surfaces one is
[#221](https://github.com/abofs/stonyx-orm/issues/221).

So: pass the context, and do not treat a resolved predicate's answer as
model-specific until that predicate has been migrated to read it.

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

It is evaluated against the record the route is *addressed to*. On the two
relationship route families it is **also** evaluated against the **related**
record, by that record's *own* model's predicate — see the two `{relationship}`
rows below. It is not a guarantee that a hidden record cannot be reached or
modified: a write to a *different* collection can still re-parent one. See
[Known limitations](#known-limitations) and
[#207](https://github.com/abofs/stonyx-orm/issues/207).

| Endpoint | A record the predicate rejects |
|---|---|
| `GET /:models` | omitted from the collection |
| `GET /:models/:id` | `404` |
| `GET /:models/:id/{relationship}` | the **addressed** record → `404`. The **related** record → `200` with `data: null` for a `belongsTo`, or dropped from the array for a `hasMany` |
| `GET /:models/:id/relationships/{relationship}` | same, on the linkage objects |
| `PATCH /:models/:id` | `404`, no attribute is applied |
| `DELETE /:models/:id` | `404`, the record is not removed and no SQL `DELETE` is issued |
| `POST /:models` | `403`, and a record **this request inserted** is rolled back — see [Known limitations](#known-limitations) for why the rollback is conditional |

**A withheld related record is not an error, and that is the same rule.** The
addressed record is filtered with `404` and the related one with `data: null`
because in both cases the answer must be **identical to the answer for a record
that does not exist**. A `belongsTo` whose target is genuinely absent already
answers `200 {"data": null}`; a `hasMany` with no members already answers `200`
with an empty array. Withholding therefore has to be spelled the same way, or
the route becomes an existence oracle for a record on a collection the caller
may have no access to at all. Measured before this was closed — unauthenticated,
zero query parameters, one request each:

```
GET /traits/1/tag   [target absent]  ->  200  application/json  68 bytes
GET /traits/2/tag   [target denied]  ->  404  text/plain         9 bytes
```

`tag` is a model with **no route mounted at all**, so those two requests were the
only way to ask about it — and they answered differently. Both now answer
`200 {"data": null}`.

**Denied record-level requests return 404, not 403.** This is deliberate and it
is the property most easily "improved" away. 403 would confirm that the record
exists to a caller who is not allowed to know that, which turns the filter into
an existence oracle: `404` means "no such record", `403` means "there is one and
it is not yours". Every status on a record route must therefore be identical for
"filtered out" and "does not exist" — including `DELETE`, which is why deleting
a record that never existed also returns 404 rather than 204, and including the
**related** record on the two relationship families, which is why a denied
`belongsTo` target is `200 {"data": null}` rather than `404`: on that route
`404` is the answer for a parent that does not exist, so it is `data: null`, and
not the status, that carries "no target you may see".

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

Let the server assign the id and read it back from the response — and read it
back rather than predicting it, because the value it returns is documented but
not stable across model kinds: a numeric-id model gets `max + 1` (or, at the
numeric ceiling, the lowest free integer), and a string-id model gets
`<model>-<n>`. See breaking change 8.

**What a server-assigned id is not.** It is not a secret. On a string-id
collection it is dense and enumerable from `1`, where previously it inherited
whatever entropy the last-inserted id happened to carry — a UUID-seeded store
answered a UUID-derived key. If a collection has **no** `access` config its
record-level routes are ungated, so the id was the only thing standing between
an unauthenticated caller and `GET`/`PATCH`/`DELETE` on a record. That was never
a control and must not become one; configure `access`.

**And the id itself is an occupancy signal — on both model kinds.**
`assignRecordId` reads the whole store, not the caller's filtered view — it
never sees `state.filter` — so the id it returns is a function of records the
caller may not be permitted to read. **This applies to numeric-id collections
as well as string-id ones**, and the conditions differ, so read both:

- **String-id collections, always.** The assigned `n` is the smallest positive
  integer whose landing key is free, which tells the caller that every key
  below it is taken, hidden or not.
- **Numeric-id collections, once one record sits at the numeric ceiling.** The
  normal answer is `max + 1`, which discloses only the maximum. But `max + 1`
  is not representable at or above 2^53, so the walk restarts from `1` (see
  breaking change 8) and the assigned id becomes the smallest free integer —
  the same occupancy predicate, now over arbitrary low keys. Each subsequent
  no-id `POST` names the next free one, so a caller can enumerate the holes in
  a range it cannot read.

**A ceiling record reaches a filter-protected collection even though `POST`
refuses caller ids on one.** Breaking change 3 makes
`POST /animals {"id": 9007199254740992}` answer `403`, but the same id lands
through a *relationship write on another collection* —
`POST /owners` carrying `attributes: { pets: [{ "id": 9007199254740992 }] }`
creates the animal under that key
([#207](https://github.com/abofs/stonyx-orm/issues/207), the same channel the
**Known limitations** re-parenting note describes). So the precondition is
reachable by an unauthenticated caller on exactly the collections `access`
exists to protect. Measured on the sample fixture, with every animal hidden by
the `/animals` predicate and keys 4 and 7 deleted:

```
GET  /animals                                       -> 200  []      (nothing visible)
GET  /animals/4                                     -> 404          (free — indistinguishable from hidden)
POST /animals {"id":4}                              -> 403          (breaking change 3)
POST /owners  {... pets:[{"id":9007199254740992}]}  -> 200          (#207 plants the ceiling record)
POST /animals (no id)                               -> 200  id=4    <- names a hole in the hidden range
POST /animals (no id)                               -> 200  id=7    <- and the other one
POST /animals (no id)                               -> 200  id=13
POST /animals (no id)                               -> 200  id=14
```

Closing this requires the assignment to be filter-aware, which is a change to
the `access` contract rather than a fix; it is stated here rather than left to
be discovered. Callers with no function-style filter are unaffected — there are
no hidden records to disclose.

### Identifying the collection

**Do not reconstruct the request path — and since
[#202](https://github.com/abofs/stonyx-orm/issues/202) you do not have to
identify the collection at all.** Read `model` from
[the access context](#the-access-context-second-argument): it is fixed at mount
time, no request can influence it, and there is nothing left to parse.

**Everything below is the record of what happened when this sample did parse
it.** It is kept as history, not as a recipe — none of these matching strategies
should be written into a new predicate. Every version of this sample that tried
to identify the collection from the request target failed **open**, and each
variant was found only after the previous one was fixed:

| # | Variant | Why it fails open |
|---|---|---|
| 1 | match `request.url` | `RestServer.mountRoute` mounts each model as an Express **sub-app**, so `url` is mount-relative — `GET /owners/angela` arrives as `/angela`. A `/owners` prefix match is **always false**, so the branch never fires and `access()` falls through to whatever it returns last. |
| 2 | anchored match on a raw `request.originalUrl` | `originalUrl` carries the query string, so `=== '/owners'` misses `/owners?filter[age]=30` and that collection comes back unfiltered. `endsWith('/owners')` is the older half of the same trap: it leaves every record route unguarded. |
| 3 | case-sensitive matcher | `RestServer` mounts with a bare `express()`, whose default is `caseSensitive: false`. A matcher stricter than the router that dispatched the request can simply be stepped around: `GET /owners/angela` → 404 but `GET /OwNeRs/angela` → 200 in full, and `DELETE /ANIMALS/22` destroyed a hidden record. Router-side fix: [stonyx-rest-server#47](https://github.com/abofs/stonyx-rest-server/issues/47). |
| 4 | hard-coded `/owners` | With `ORM_REST_ROUTE=/api` every url becomes `/api/owners/...` and the sample matches nothing — environment-specifically, which is harder to notice than failing everywhere. The remediation this document used to give was itself broken: `` `${config.orm.restServer.route}owners` `` evaluates to **`/apiowners`**, so a reader who followed the correction exactly still failed open and believed they had handled it. |
| 5 | any match on `originalUrl` at all | HTTP/1.1 permits an **absolute-form** request-target. Express routes on `parseurl(req).pathname`, so the request dispatches normally — but `originalUrl` is the raw target. `GET http://anything.example/owners/angela` yields `originalUrl === 'http://anything.example/owners/angela'`, which has no `/owners` prefix. Measured: the record came back in full, `DELETE` succeeded, and it walked past a hard `return false` deny the same way. |

**The fix is not a sixth rule, and it is not a better string to match.** It is
to stop identifying the collection at all. That is a statement about
**identifying the collection**, and it is not a statement about the sample as a
whole: the `/archived` sub-path rule *is* still a string match, and
[#228](https://github.com/abofs/stonyx-orm/issues/228) is a sixth spelling that
gets past it. Sub-path rules are the residue this fix does not cover, which is
why they must normalise the way the router does.

An intermediate revision read **`request.baseUrl`** — the mount Express
*actually matched*. That closed all five variants: it carries no query string
(variant 2), it is not mount-relative (variant 1), it already contains the
configured `ORM_REST_ROUTE` prefix (variant 4 — there is nothing left to derive,
so `/apiowners` is unconstructible), and it is unaffected by an absolute-form
target (variant 5). It was still a transport artifact standing in for a
structural fact, and it is **no longer what the sample does**: the sample reads
`model`, so variants 1, 2, 4 and 5 are unconstructible against it rather than
handled. **Variant 3 survives**, in the one string comparison the migration
leaves behind: the `/archived` sub-path deny folds case but does not decode
([#228](https://github.com/abofs/stonyx-orm/issues/228)). The table below is
retained as the measured evidence behind the five variants, not because any of
these values should be matched on:

| request | `request.url` | `request.originalUrl` | `request.baseUrl` | `request.path` |
|---|---|---|---|---|
| `GET /owners` | `/` | `/owners` | `/owners` | `/` |
| `GET /owners/angela` | `/angela` | `/owners/angela` | `/owners` | `/angela` |
| `GET /owners/angela?filter[age]=30` | `/angela?filter[age]=30` | `/owners/angela?filter[age]=30` | `/owners` | `/angela` |
| `GET /OwNeRs/angela` | `/angela` | `/OwNeRs/angela` | `/OwNeRs` | `/angela` |
| `GET http://anything.example/owners/angela` | `http://anything.example/angela` | `http://anything.example/owners/angela` | `/owners` | `/angela` |
| `GET /api/animals/22` (`ORM_REST_ROUTE=/api`) | `/22` | `/api/animals/22` | `/api/animals` | `/22` |

**Superseded 2026-09-01 by [#236](https://github.com/abofs/stonyx-orm/issues/236) /
[#237](https://github.com/abofs/stonyx-orm/issues/237) — "Variant 3 survives" above,
and the two paragraphs below, are no longer true.** The access context now carries
`recordId`, the **decoded** route-parameter id, and the sample compares against it:
the one string comparison variant 3 lived in is gone, `#228` is **closed**, and no
read of argument one survives in the sample. The wording is left standing rather
than deleted because it appears at four sites (this file twice,
`src/orm-request.ts`, and the test fixture) and retiring one of four leaves the
shipped copies contradicting each other; retiring all four **with the measurement
that retires them** is [#238](https://github.com/abofs/stonyx-orm/issues/238).

**One read of argument one survives, and it must: `request.path`.** It is
mount-relative and query-free, and it is for rules that distinguish **sub-paths**
beneath the mount — as the `/archived` deny in the sample above does. The context
names which model and which verb, **not which route**, so that deny *cannot be
expressed from the context alone*, and a context-only rewrite would silently turn
it into an allow.

**Normalise the way the router that dispatched the request does — and
case-folding alone does not.** A matcher stricter than the router can be stepped
around, so the sample lower-cases before comparing (the router matched
case-insensitively). That closes the case gap and **it is not the whole rule**:
Express sets `request.path` from the **raw, undecoded** pathname while the router
**decodes** `:id`, so `GET /owners/%61rchived` reaches a `path === '/archived'`
comparison as `/%61rchived`, walks past the deny, and is dispatched as the record
`archived`. That gap is live in the sample above and is tracked as
[#228](https://github.com/abofs/stonyx-orm/issues/228) — **do not read the
`.toLowerCase()` there as a complete normalisation recipe.** Record ids are
case-sensitive and must be compared at their real case.

**Do not follow the two paragraphs above — superseded 2026-09-01 by
[#236](https://github.com/abofs/stonyx-orm/issues/236) /
[#237](https://github.com/abofs/stonyx-orm/issues/237).** They are *instructions*,
not merely stale observations, which is why this note is louder than a date. The
sample no longer reads `request.path` and no longer calls `.toLowerCase()` on
anything it compares: `.toLowerCase()` was measured wrong in **both directions at
once** — with a distinct owner seeded at `ARCHIVED`, `GET /owners/ARCHIVED` was a
false **deny** on the wrong record and `GET /owners/%41RCHIVED` a false **allow**
on that same record. Compare `recordId` **as it arrives**: do not case-fold it, do
not decode it, do not derive it from `request.path`. The contract is
`AccessContext.recordId` in `src/types/orm-types.ts`, which ships and says "Do NOT
case-fold it". Retirement of this wording, with its measurement:
[#238](https://github.com/abofs/stonyx-orm/issues/238).

**Fail closed on anything you cannot identify — on *either* argument.**
`String(request.originalUrl ?? '')` was once added here to stop a `TypeError`,
and it traded fail-closed for fail-**open**: an empty string matched no
collection, so `access()` fell through to the permission array and granted full
CRUD. The same rule applies to the context — the sample returns `false` for an
absent `model` rather than falling through. Since #202 the guard and the read can
sit on **different objects**, and a guard on argument two does not protect a read
of argument one: the sample therefore also returns `false` when `request.path` is
absent or is not a string, rather than letting `?? ''` fall through to the
per-record filter. An input you cannot identify must **deny**.

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
  see [The access context](#the-access-context-second-argument):
  `Orm.instance.getAccess(modelName)` makes another model's predicate
  **reachable**, and `context.model` makes a **model-correct answer possible** —
  possible, not guaranteed: the resolved predicate has to read the context. The
  sample shipped with this repo now does
  ([#222](https://github.com/abofs/stonyx-orm/issues/222)), so
  `getAccess('animal')` answers with the animal filter; a predicate that ignores
  the second argument still answers about the collection the request is
  addressed to, and the boot-time warning that surfaces one is
  [#221](https://github.com/abofs/stonyx-orm/issues/221). **The mechanism
  exists; the ORM does not yet use it on this path.** The re-parenting write above is still
  **not refused** — that enforcement is
  [#196](https://github.com/abofs/stonyx-orm/issues/196) and
  [#207](https://github.com/abofs/stonyx-orm/issues/207), which were blocked on
  #202 and are now free to proceed. Until they land, do not rely on a filter to
  keep a record unmodifiable; keep the *writable* collections' predicates as tight as
  the hidden ones.
- **Authorization by identifying the collection is a consumer-side
  reconstruction of information the framework already holds.** `access()`
  receives a transport artifact and is asked to work out which model, which
  operation and which record the request addresses. The five variants above are
  the five ways that has been observed to fail open so far. Tracked as
  [#202](https://github.com/abofs/stonyx-orm/issues/202).
- **The two relationship route families now resolve the *related* model's own
  access class — `GET /:models/:id/{relationship}` and
  `GET /:models/:id/relationships/{relationship}`**
  ([#232](https://github.com/abofs/stonyx-orm/issues/232)). This is
  **membership**: the related resource is the route's *primary* data, so the
  filter decides whether it is served at all, not merely which ids a document
  may name. A denied `hasMany` member is **dropped from the array** and nothing
  in the relationship marks the drop: `links` intact, no `errors` member, same
  status, and an array of survivors shaped exactly like one from a parent that
  only ever had those members. A denied `belongsTo` target answers **`200` with
  `data: null`**, byte-identical to a target that is genuinely absent, for the
  same reason.

  **That is a claim about the relationship, not about the document, and the gap
  is measurable in this repo's own fixture.** `owner` declares a computed
  `totalPets` returning `this.pets.length`, which reads the **store** and is
  never filtered. Measured on this branch, unauthenticated, at zero query
  parameters: `GET /owners/gina` answers `attributes.totalPets: 5` while its
  `relationships.pets.data` names **four** ids, and both relationship routes
  serve the same four. The relationship discloses nothing; the document it
  arrives in discloses that exactly one child was withheld. Do not read
  "indistinguishable" as a property of the response — it is a property of the
  relationship member alone. The other channels in the same class are
  [#245](https://github.com/abofs/stonyx-orm/issues/245) (computed attributes,
  which is the one measured above) and
  [#246](https://github.com/abofs/stonyx-orm/issues/246) (the
  `attributes.<fk>` echo of an unresolved `belongsTo` target) — **both still
  open**. `included` membership was the third,
  [#233](https://github.com/abofs/stonyx-orm/issues/233), and it is **closed**:
  a related record its own model's access class rejects is dropped at the
  traversal's push site and is no longer a member. **Audit your
  computed properties before you treat a dropped member as unobservable.** Nothing on either family errors and no status changes — the
  status on these routes belongs to the **parent**, and `data` carries the
  answer about the related record. The `/relationships/` family built its `{type, id}` by
  hand rather than through `toJSON()`, which is why the linkage filter shipped in
  [#234](https://github.com/abofs/stonyx-orm/issues/234) did not reach it.

  Before this, both families served a record hidden on every one of its own
  surfaces, in full, from another model's route, at **zero query parameters**.
  The severe case is a model **claimed by no access class**: `getAccess()`
  returns `undefined`, no route is mounted for it at all, and it was still
  readable as a related resource — a collection the consumer deliberately never
  exposed.

  **The `belongsTo` shape is not an existence oracle, and it was measured
  rather than reasoned about.** An earlier revision of this fix answered `404`
  for a denied target, which made it distinguishable from a target that is
  genuinely absent. Unauthenticated, zero query parameters, one request each, on
  `tag` — a model with **no route mounted at all**:

  ```
  GET /traits/1/tag   [target absent]  ->  200  application/json  68 bytes
  GET /traits/2/tag   [target denied]  ->  404  text/plain         9 bytes
  ```

  `GET /traits/1` and `GET /traits/2` report `relationships.tag = {"data":null}`
  byte-identical modulo the id, because
  [#234](https://github.com/abofs/stonyx-orm/issues/234) closed that oracle
  deliberately — so this route was the one remaining way to ask which of those
  two nulls was a denial. Under `data: null` both requests answer `200`, same
  content-type, same content-length, same bytes modulo the parent id the caller
  put in the URL. It discloses nothing further: `links` on these routes are
  derived entirely from the parent and the relationship name, there is no `meta`
  and there are no counts. This also brings the two families back into line with
  the module-wide rule under [Filter functions](#filter-functions) — *every
  status on a record route must be identical for "filtered out" and "does not
  exist"* — which the `404` spelling was an exception to.

  **Per-record denies for a related resource are not expressible.** A predicate resolved for a
  related resource on these routes receives `recordId: null` and a `request`
  whose `params` name a record of a **different model**. So the inputs it has
  are the model name, the operation and the request — and **a rule that needs to
  know *which* related record it is being asked about cannot be written**.
  Model-level denies (`return false` for a model) work. Request-level denies (a
  rule reading a header, a tenant, the method) work. The per-record **filter**
  shape works too — `access()` may return a function, and that function receives
  the whole record, id included. What does not work is branching on the record's
  identity *before* returning, because `access()` is not told it.

  This is not an oversight and it is not closed here. The verdict is resolved
  **once per type**, cached, before any record has been examined — a `hasMany`
  related-resource route returns many records of one type, so seeding `recordId`
  from a record would let the first one decide the context for all of them. The
  rule the framework holds to is: **`recordId` may name a record only where the
  route addresses exactly one record of the model being asked about.** That is
  true for `GET /owners/{id}`, false for linkage, and false for a `hasMany`
  related-resource route.

- **`?include=` records are filtered on both questions now, and so are the
  relationship routes.** *Re-specified twice, each time by the story that
  falsified it, and recorded here rather than deleted. The original said all
  three surfaces were unfiltered.
  [#232](https://github.com/abofs/stonyx-orm/issues/232) made two of them
  filtered and the bullet became "**`?include=` records are still not
  filtered — the relationship routes now are**", with the body "**`?include=owner`
  still does not**: it serializes the related record without resolving that
  class, so a filter on `/owners` does not hide an owner reached through
  `?include=` on `/animals`."
  [#233](https://github.com/abofs/stonyx-orm/issues/233) falsified that half
  too.* `GET /animals/1/owner` and
  `GET /animals/1/relationships/owner` resolve the related model's own access
  class (see the bullet above). **`?include=owner` now resolves it as well**,
  at the traversal's push site, so a filter on `/owners` *does* hide an owner
  reached through `?include=` on `/animals`: measured on this branch,
  `GET /animals/1?include=owner` answers `200` with **no `included` array at
  all**, where before it served the hidden owner's full document.
  There were **two** questions here and they were owned separately — #233, the
  remaining child of
  [#196](https://github.com/abofs/stonyx-orm/issues/196), owns whether a
  resource enters `included` **at all** (membership), and
  [#235](https://github.com/abofs/stonyx-orm/issues/235) owns the
  `relationships.*.data` emitted **inside** a record that is already there
  (linkage). **Both have now landed, and neither closed the other** — they are
  still answered by different mechanisms at different sites, and a resource can
  legitimately be a member while its own linkage is filtered. Membership —
  whether the related resource is served at all — remains a different question
  from which ids a document may *name*, immediately below.
- **Relationship linkage is filtered on every request-bound surface that
  serializes a record — the reads, the two writes, and `included`.** A
  document's `relationships.*.data` used to publish the id of every related
  record unconditionally, so a record hidden on every one of its own surfaces
  was still named inside another model's document — with no `include=`, no
  relationship route and no query string
  ([#234](https://github.com/abofs/stonyx-orm/issues/234)). The ORM now resolves
  the **related** model's own access class on `GET /:models`, `GET /:models/:id`,
  both `GET /:models/:id/{relationship}` shapes, the `POST /:models` and
  `PATCH /:models/:id` **response documents**, and every record inside an
  `?include=` **`included`** array
  ([#235](https://github.com/abofs/stonyx-orm/issues/235)), and asks it
  `{ model: <related>, operation: 'read' }`. **`operation` is `'read'` even on a
  write route, and that is correct rather than an oversight** — the question
  asked of the *related* model is "may this caller **read** this id", not "may
  they update it". An access class that grants `['create']` but not `['read']`
  on the related model therefore denies that linkage on its own `POST`
  response; that is the fail-closed direction. Do **not** wire these handlers to
  `methodAccessMap[request.method]`: it would ask a different question on a
  write route than on a read route, which is the two-vocabularies failure
  `createLinkageFilter` exists to prevent. An unresolvable class
  (`getAccess()` → `undefined`) and a predicate that throws both **deny**.

  **What the two write surfaces cost before #235, measured rather than
  described:** one HTTP verb defeated the filter on the same record. On
  `dev @ 8dda5d6`, seconds apart, with no query string and no relationship
  route, `GET /animals/1` returned `owner.data: null` while `PATCH /animals/1`
  returned **200 naming angela**. Any caller who could read a record could also
  write it and be handed the id the read withheld. That consequence is kept here
  after the fix, and stated as a measurement, because **naming the two handlers
  is not a substitute for it** — a reader who is told only that `POST` and
  `PATCH` are now covered cannot tell what was wrong, and a reviewer cannot tell
  whether the fix addressed it. A
  filtered-out relationship is **indistinguishable from a genuinely empty one** —
  an emptied `hasMany` is `data: []` and an emptied `belongsTo` is `data: null`,
  both **keeping their `links`**, which are built from the serialized record's
  own id and never from the related one. On the two **write** surfaces there are
  no `links` to keep: neither handler passes a `baseUrl`, so a filtered and a
  genuinely-empty relationship are both a bare `{ "data": … }` there. That is
  pre-existing and deliberate — adding `baseUrl` to the write handlers would be
  an unrelated change to their response shape. Nothing errors and no status changes,
  because throwing here would be an existence oracle *and* would throw out of
  the enclosing `JSON.stringify`.

  **[#232](https://github.com/abofs/stonyx-orm/issues/232) holds to the same
  spelling on the routes where that linkage is the *primary* data.** A denied
  member is dropped from the `hasMany` array and a denied `belongsTo` target is
  `data: null`, at `200`, `links` intact — so the claim above is true of both
  `GET /:models/:id/{relationship}` shapes as *routes* and not only as linkage
  emitted inside somebody else's document. An earlier revision of #232 answered
  `404` on the `belongsTo` shape and did contradict this paragraph; that is
  measured and closed in the #232 bullet above.

  **[#233](https://github.com/abofs/stonyx-orm/issues/233) owns whether a
  related resource appears in `included` at all, and that question is now
  answered too.** #235 filters what a record *already in* `included` may
  **name**; #233 decides **membership**. They remain different questions
  answered by different mechanisms and neither closes the other — a resource
  can legitimately be a member while its own linkage is filtered. A related
  resource is judged by **its own** model's access class at the traversal's
  push site, so a record that class's **per-record filter** rejects is not a
  member, and **the
  subtree beneath it is never traversed**: dropping a parent *after* descending
  through it would publish that parent's exact child set. Measured on
  `dev @ c106cf9`, `GET /animals/1?include=owner,owner.pets` returned nine
  resources — the hidden owner plus her eight animals
  `[1, 3, 7, 10, 11, 15, 17, 20]`, which *is* her `pets` array, reconstructed
  for a caller who is `404` on the parent. It now returns no `included` array
  at all. A model **no access class claims** (`getAccess()` → `undefined`) is
  denied on this path too, so a collection the consumer never exposed is not
  reachable as a sideloaded resource either. **Drop, never error:** a pruned
  sideload is byte-identical to a genuinely empty one — same `200`, the same
  top-level keys, no `included` member on either, no `errors` — so its absence
  carries no signal about whether the record exists.

  **Read "per-record filter" literally — it is not "everything the
  record-addressed route refuses", and the difference is measurable.** The
  linkage ask carries `recordId: null`, so a deny expressed as a
  request-scoped `return false` cannot fire on this path at all. The shipped
  sample expresses the `archived` owner's deny that way, and measured
  unauthenticated on this branch — byte-identically on `dev @ b23cfec`, so this
  is not a regression this change introduces —
  `GET /owners/archived` is `403` while `GET /animals/9500?include=owner`
  answers `200` with her full document. That is
  [#243](https://github.com/abofs/stonyx-orm/issues/243)'s mechanism, and #243
  records it on `GET /owners` only; it reaches `included` membership and the
  `#232` related-resource route the same way. **#233 does not close it, and a
  consumer who needs `?include=` to honour a per-record deny must express that
  deny as a filter.**

  **And read "carries no signal" as a property of the `included` member, the
  same way [Known limitations](#known-limitations) already asks you to read
  "indistinguishable" — not as a property of the whole response.** The prune is
  unobservable in `included`; the *rest* of the document is a separate
  question, and the same computed-and-serialized-attribute channels recorded
  above still apply to it. Measured counter-example on this very fixture pair:
  `GET /traits/2?include=tag` prunes the unclaimed `tag` from `included` and
  still serves `attributes.tag: "never-mounted"`, while `GET /traits/1` has no
  `tag` key at all — an existence oracle in `attributes`, from
  `src/serializer.ts` echoing the raw foreign key of a `belongsTo` target that
  did not resolve. That is
  [#246](https://github.com/abofs/stonyx-orm/issues/246)'s mechanism reached on
  a **read**, with [#248](https://github.com/abofs/stonyx-orm/issues/248) as
  its precondition — **audit your attributes before you treat a pruned
  sideload as unobservable.**

  **That resolves the right class; it does not guarantee a model-correct
  answer, and the failure direction is not the safe one.** Only a predicate that
  *reads* `context.model` can answer about the model it was asked about — see
  [Passing the context makes a model-correct answer *possible*](#passing-the-context-makes-a-model-correct-answer-possible)
  above. A **single-argument predicate remains the default in every consumer
  tree**, it identifies its collection from the request, and asked about
  `owner` on a request dispatched to `/animals` it answers about **animals**.
  Measured against this repo's own fixture with an arity-1 predicate registered
  for `owner`: `GET /owners` correctly returns `["gina","michael","bob"]` while
  `GET /animals/1` returns `owner.data {"type":"owner","id":"angela"}` — the
  #234 defect, on the #234 surface, after the #234 fix. This is not a
  regression (the id was published unconditionally before), it cannot be fixed
  from this side, and the signal that surfaces such a predicate is
  [#221](https://github.com/abofs/stonyx-orm/issues/221) /
  [#213](https://github.com/abofs/stonyx-orm/issues/213). **Migrate your
  predicates to read the context before relying on this filter.** A migrated,
  context-reading predicate degrades the other way — it can over-deny a
  *permitted* related record, which is recorded in the release notes as a
  breaking change.

  **Not yet covered by #235. Each still publishes ids the surfaces above
  withhold, except where its own owning issue has since closed it — the first
  entry names an issue that is in flight as this is written:**

  - **`GET /:models/:id/relationships/{relationship}`, and its state is #232's
    to report rather than this entry's.**
    [#232](https://github.com/abofs/stonyx-orm/issues/232) owns the
    relationships-linkage route. Its *primary data* is linkage,
    so filtering it is a **membership** decision — which is why it is the filed
    child of [#196](https://github.com/abofs/stonyx-orm/issues/196) and not of
    #234. The route builds its `{type, id}` objects by hand and never calls
    `toJSON`, so the `linkage` **option** never reaches it; whatever that route
    filters, it filters itself. Measured **on `dev @ 8dda5d6`**, the commit
    #235 branched from: `GET /animals/1/relationships/owner` answered
    `{"type":"owner","id":"angela"}` while `GET /owners/angela` was `404`. That
    measurement is pinned to a commit on purpose, so that it does not quietly
    become a false claim about `dev`. **PR
    [#247](https://github.com/abofs/stonyx-orm/pull/247) is in flight against
    this entry**; if it has landed, this route is covered and the bullet #247
    adds above supersedes this one.
  - **A computed attribute that interpolates a related record's id.**
    [#245](https://github.com/abofs/stonyx-orm/issues/245) owns this channel,
    and **it is open as this is written**. `relationships.*.data` is a structure
    this module builds, so it can be filtered; a computed property is arbitrary
    consumer code returning an arbitrary value. Whether that makes the channel a
    **framework defect** the ORM should close — by handing computed getters a
    verdict, or by refusing to run them while a filter is in force — or a
    **consumer contract** the ORM should only document, is the question #245
    must decide. **This README does not decide it; neither reading should be
    read out of the text here.** Measured on this repo's own fixture, where the
    `animal` model has a `get tag()` that interpolates `owner.id`: **every**
    animal document on **every** surface — including the ones above — carries
    `attributes.tag: "angela's small dog"` for an owner that answers `404`. That
    measurement is where #245 starts, and it holds whichever way the decision
    lands. Until it lands, if your access rules hide a record, audit your
    computed properties for its identifiers.
  - **The absence of `attributes.<fk>` on a `POST` response proves a hidden
    record exists** — [#246](https://github.com/abofs/stonyx-orm/issues/246).
    `createHandler` copies each supplied relationship's raw id into
    `attributes`; when the related record resolves, the value is consumed and
    does not appear, and when it does not resolve, it survives. The oracle runs
    in the negative space, so nothing this list's surfaces withhold is
    *published* — the **absence** is the signal. Pre-existing, and it does not
    compose with the two relationship families above: they emit no `attributes`
    for a related record at all.
- **A bare `toJSON()` still emits unfiltered linkage, and that is deliberate.**
  `Record.toJSON()` **applies** a verdict; it never **resolves** one. It has no
  request, and the documented `access()` contract permits a predicate to read
  one — the sample in this README does, for its sub-path rule — so a filter
  resolved inside `toJSON()` denies *permitted* records rather than hidden ones
  (measured: 967 → 964, all three failures over-denials). `toJSON` is also the
  `JSON.stringify` hook, so `JSON.stringify(record)`, `res.json(record)` and
  `console.log(JSON.stringify(record))` reach it with a **string** in the
  options slot and have no syntactic place to pass a verdict. The no-argument
  call therefore returns the pre-#234 document unchanged. Fail-closed by default
  is not available either: `Orm.instance.accessFunctions` is `{}` in any process
  that never ran `setup-rest-server` — a CLI, an SQL-only process, a test — so
  it would empty every relationship on every document in processes with no REST
  surface to protect. Closing the residual means moving JSON:API serialization
  **off** the `toJSON` name, tracked as
  [#230](https://github.com/abofs/stonyx-orm/issues/230). If you hand a `Record`
  to an untrusted consumer, serialize it through the REST layer, or resolve a
  verdict with the **exported** `createLinkageFilter(request)` and pass it as
  the `linkage` option — do not write your own reading of `access()`. This is a
  consumer obligation with no signal when it lapses; it is stated once, in full,
  under [Consumer Contracts](#consumer-contracts) below.
- **`format()` and `serialize()` are deliberately not filtered, and must stay
  that way.** `format()` is the **persistence** path — its output is what
  `Orm.db.save()` writes to disk — so applying an access filter there would
  write a truncated database. That is **data loss**, not disclosure prevention.
  Neither method appears anywhere in the REST response path.
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
  [#205](https://github.com/abofs/stonyx-orm/issues/205). Its sibling
  [#203](https://github.com/abofs/stonyx-orm/issues/203) — a **server-assigned**
  id landing on an occupied slot — is **fixed**; see breaking change 8. #205 is
  the client-supplied half and is still open.
- **`context.record` is `undefined` for an after-`create` hook when a string-id
  model is given a numeric-looking id.** The post-create lookup uses the same id
  coercion as every other surface, which resolves `'9107'` to the number `9107`,
  while a model declaring `id = attr('string')` files the record under the string
  key. The create itself succeeds and `context.response.data` is correct; only
  the hook's view of the record is wrong, and it is wrong *silently*. Tracked as
  [#209](https://github.com/abofs/stonyx-orm/issues/209).
- **A denied `POST` rolls back only a record it *inserted*.** The rollback
  requires the store to have grown, because removing by id alone is a write
  primitive keyed by a caller-supplied value. **The reachability condition this
  bullet used to state is gone**: it was
  [#203](https://github.com/abofs/stonyx-orm/issues/203) — `assignRecordId`
  returned last-*inserted* + 1, so a server-assigned id could land on an
  occupied slot and `createRecord` would update it in place — and #203 is fixed
  (breaking change 8). A server-assigned create can no longer overwrite, so on a
  collection whose only id channel is `createHandler` this guard has no
  observable effect today. It is kept because a caller-supplied id reaching
  `createRecord` from another route — a relationship write,
  [#207](https://github.com/abofs/stonyx-orm/issues/207) — puts the condition
  back, and without the guard a denied `403` would delete a record the request
  did not create.

### Consumer Contracts

Obligations this package **cannot enforce**, where nothing fails, warns or
changes shape when a consumer omits them. One place, findable, per
`quality.md` rule 2 — if you are relying on `@stonyx/orm` for access control,
read all of these.

#### `Record.toJSON()` does not filter relationship linkage unless you pass a verdict

**The framework resolves a verdict for you on every request-bound surface that
serializes a record through `toJSON()`. You own it everywhere else.**

Those surfaces are `GET /:models`, `GET /:models/:id`, both shapes of
`GET /:models/:id/{relationship}`, the `POST /:models` and `PATCH /:models/:id`
**response documents**, and every record inside an `?include=` **`included`**
array ([#234](https://github.com/abofs/stonyx-orm/issues/234) for the four
reads, [#235](https://github.com/abofs/stonyx-orm/issues/235) for the two
writes and `included`). Each resolves a linkage verdict and passes it to
`toJSON()` for you.

**`GET /:models/:id/relationships/{relationship}` is not on that list, and its
state is not this section's to report.** It builds its `{ type, id }` objects by
hand instead of calling `toJSON()`, so the `linkage` **option** never reaches it
— whatever that route filters, it filters itself. And because its linkage *is*
its primary data, filtering it is a **membership** decision rather than a
linkage one. Membership on both relationship route families is owned by
[#232](https://github.com/abofs/stonyx-orm/issues/232) (PR
[#247](https://github.com/abofs/stonyx-orm/pull/247), in flight as this is
written); read that issue for its state rather than inferring it here, because
this section describes only what `toJSON()` filters.

Any other path to a document — `JSON.stringify(record)`, `res.json(record)`,
`console.log(record)`, a custom route, a queue payload, a websocket frame —
calls `toJSON()` with no verdict, and **the no-verdict document names every
related id, including records hidden on every one of their own surfaces**
([#234](https://github.com/abofs/stonyx-orm/issues/234)). That default is
deliberate and cannot be inverted; the reasons are in
[Known limitations](#known-limitations) above.

**There is no signal when you omit it.** `linkage` is optional, absent is the
default, the default is the unfiltered document, and a filtered relationship is
byte-identical to a genuinely empty one — so nothing on the wire distinguishes
"filtered" from "forgotten".

**And `linkage` cannot reach a document you build by hand.** It is an *option to
`toJSON()`*, so it filters only what goes through `toJSON()`. The ORM's own
`GET /:models/:id/relationships/{relationship}` route is the worked example: its
primary data *is* linkage, it assembles `{ type, id }` directly rather than
serializing a record, and it therefore resolves and applies the verdict itself
([#232](https://github.com/abofs/stonyx-orm/issues/232)). If you assemble
linkage the same way anywhere — a custom relationship route, a projection, a
hand-built document — **passing `linkage` to `toJSON()` does nothing for it and
nothing warns**. Build the filter and consult it before you emit an id:

```js
const linkage = createLinkageFilter(request);

if (related && linkage(related.__model.__name, related)) {
  data = { type: related.__model.__name, id: related.id };
} else {
  data = null; // withheld and genuinely-empty must be the SAME answer
}
```

The `else` branch is the part that is easy to get wrong. Answering `404`, `403`
or an `errors` member for the withheld case makes the route an **existence
oracle** — see [Filter functions](#filter-functions) for the rule and for the
measurement that closed it on this route.

**A per-record deny for a *related* resource cannot be expressed, and nothing
tells you so at the point you would write it.** `createLinkageFilter` resolves
the related model's access class by **type**: `context.recordId` is `null`, and
`request.params` names a record of a **different model** — the one the route is
addressed to. So `access()` is handed the model, the operation and the request,
and **a rule that has to know *which* related record it is being asked about
cannot be written**. Model-level denies (`return false` for a model) work.
Request-level denies (a header, a tenant, the method) work. The per-record
**filter** shape works too — `access()` may return a function, and that function
receives the whole record, id included. What does not work is branching on the
record's identity *before* returning, because `access()` is not told it.

This is a fixed property of the mechanism rather than a defect awaiting a fix.
The verdict is resolved **once per type** and cached before any record has been
examined, so seeding `recordId` from a record would let the first member of a
`hasMany` decide the context for all of them. The rule the framework holds to is
**`recordId` may name a record only where the route addresses exactly one record
of the model being asked about** — true for `GET /owners/{id}`, false for
linkage, and false for a `hasMany` related-resource route. The consumer-facing
consequence is the part to check: a predicate that branches on `recordId` sees
`null` here and takes whichever branch `null` takes, with no warning, and if
that branch grants then it **grants**. Express the rule as a returned filter
function instead. Stated again, with the same label, under
[Known limitations](#known-limitations)
([#232](https://github.com/abofs/stonyx-orm/issues/232)).

Do this:

```js
import { createLinkageFilter } from '@stonyx/orm';

// `request` is the live request the caller was authorised against. The verdict
// is REQUEST-SCOPED: build one per request and never cache it across requests,
// or a second caller is answered with the first caller's authorization.
const linkage = createLinkageFilter(request);

res.json({ data: record.toJSON({ baseUrl, linkage }) });
```

Not this:

```js
// A second, unreviewed reading of access(). It will drift from the one in
// src/access-verdict.ts, and it will drift in consumer code where no reviewer
// of this repository will ever see it.
const linkage = (type, r) => Orm.instance.getAccess(type)?.(request)?.(r) ?? true;
```

**`createLinkageFilter` requires a live request, and there is no safe call
without one.** `request` is the only authorization input the filter has — it is
handed straight to your `access()` predicates, and a predicate that does not
*read* it cannot fail closed when it is missing. Passing `undefined`, `null` or
any non-object therefore denies **all** linkage and logs, once, at construction.
Measured before that guard existed, `createLinkageFilter(undefined)` granted
four of the five models in this repository's own fixture, silently.

**This is the catch for the request-less contexts named above.** In a queue
consumer or a websocket handler there is no live request, so there is nothing to
authorize against and nothing this package can resolve for you. Either carry the
originating request through to the point of serialization, or publish no linkage
at all — `record.toJSON({ linkage: () => false })` emits the document with every
relationship empty. A stand-in is **not** a substitute: `{}` is an object
and passes the guard, and any predicate that ignores its request will grant.

**`linkage` itself is validated, and an unusable value DENIES.** `undefined`
means "no verdict supplied" and emits today's document. Anything else must be a
**synchronous function that answers with a boolean**. Each of the following
drops **all** linkage on that document and logs once:

- **A non-function** — `null`, `0`, `false`, `''`, `true`, a string, an object.
  `null` is the natural return of a resolver that could not resolve a session:
  it used to be read as "absent" and emit the full document silently.
- **An `async` function, a generator function, or any predicate that returns a
  promise or thenable.** `toJSON` is the `JSON.stringify` hook and cannot await
  a verdict, and **an `async` resolver returns a promise, a promise is
  truthy**, so every related id was published, silently, exactly as if this fix
  were not here. If your
  authorization lookup is asynchronous, `await` it *before* you serialize and
  close over the result.
- **Any answer that is not a boolean** — `{}`, `'no'`, `1`, `undefined`. A
  non-boolean is a resolver that did not answer, and a truthy one granted.
- **A predicate that throws**, including a `class` passed by mistake. It is
  caught and denied; it used to escape the enclosing `JSON.stringify` and take
  the rest of that serialization down with it.

#### A predicate that ignores `context.model` makes cross-model resolution GRANT

The linkage filter above asks the **related** model's access class the
model-correct question, but only a predicate that *reads*
[`context.model`](#the-access-context-second-argument) can give a model-correct
answer. A single-argument predicate identifies its collection from the request
and therefore answers about the collection the request was *addressed to* —
which is the direction that **grants**. Measured, and worked through in
[Known limitations](#known-limitations). There is no boot-time warning yet
([#221](https://github.com/abofs/stonyx-orm/issues/221)). **Migrate your
predicates to the two-argument contract.**

#### `format()` and `serialize()` are never filtered, by design

They are the persistence path. Do not hand their output to an untrusted
consumer, and do not add a filter to them — `Orm.db.save()` writes `format()`
output to disk, so filtering there is data loss rather than disclosure
prevention.

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

   "Seven surfaces" means the seven endpoints of **the filtered model** —
   `GET /:models`, `GET /:models/:id`, `GET /:models/:id/{relationship}`,
   `GET /:models/:id/relationships/{relationship}`, `POST /:models`,
   `PATCH /:models/:id` and `DELETE /:models/:id`. That count is still seven and
   is still the model's own endpoints, but **it is no longer the whole
   population**: the boundary moved outward rather than the number changing, and
   this sentence used to be read as saying a filtered model's predicate is
   consulted nowhere else. It now is, in two further places, both from
   *another* model's routes —

   - on **both relationship route families**, where the related record is the
     primary data and the filtered model's own class decides whether it is
     served at all (breaking change 9 below,
     [#232](https://github.com/abofs/stonyx-orm/issues/232)); and
   - on the `relationships.*.data` **linkage** of every request-bound surface
     that serializes a record through `toJSON()`
     ([#234](https://github.com/abofs/stonyx-orm/issues/234),
     [#235](https://github.com/abofs/stonyx-orm/issues/235)), which decides
     which ids another model's document may name.

   A **write** to another collection can still reach one of its records through
   a relationship — [#207](https://github.com/abofs/stonyx-orm/issues/207),
   which is **not** closed here. That is the half of the old sentence that
   survives, and it is a read/write asymmetry now rather than a blanket
   statement about cross-model reach.
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

8. **Server-assigned ids change value on string-id models, numeric ids stop
   being monotonic at the numeric ceiling, and the create route gains a
   `409`.** Three consumer-visible changes from
   [#203](https://github.com/abofs/stonyx-orm/issues/203).

   **The value.** A `POST` with no `id` against a model declaring
   `id = attr('string')` previously produced the *last-inserted* id with `1`
   concatenated onto it — an owner store holding `['gina', 'bob']` answered
   `'bob1'`. It now answers `'owner-1'`: the model name, a hyphen, and the
   lowest positive integer whose landing key is free. **No test in this repo
   pinned the old value**, so a consumer relying on it gets no failing test, no
   deprecation and no other signal — which is why it is recorded here. Numeric
   id models (`id = attr('number')`, the default) are unaffected in shape: they
   still get an integer, but it is now the **maximum** existing id plus one
   rather than the last-inserted id plus one, which is the defect #203 is about.
   They are **not** unaffected in *sequence* — see the monotonicity half below.

   The value is deliberately **not** numeric-looking, and that is not cosmetic.
   Every id-bearing surface resolves a numeric-looking string id to a **number**
   (`GET /owners/1` looks up `1`), while a string-id model files its records
   under the **string** key `'1'`. A server-assigned `'1'` would therefore be a
   record that was created successfully and could not be fetched, updated or
   deleted by id, and whose after-`create` hook received
   `context.record === undefined`
   ([#209](https://github.com/abofs/stonyx-orm/issues/209)).

   **Numeric ids are no longer monotonic, and deleted ids can be re-issued.**
   The precondition is narrow but it is reachable, and there is no signal when
   it is met: **one record filed at or above 2^53** (`9007199254740992`). `max
   + 1` is not representable there, so assignment restarts from `1` and walks
   up to the lowest free key — which means the id of a *deleted* record is
   handed to the next `POST`. Both `dev` and every prior release were strictly
   monotonic and never re-issued a numeric id, so a consumer that relied on
   that — audit rows, cursors, cached authorization decisions, external
   references keyed on the id — now has a stale reference that silently points
   at a **different record, created by a different caller**, rather than at a
   deleted one. Nothing fails; the reference simply resolves to the wrong
   record.

   The restart is deliberate and is not itself optional: without it, one record
   at the ceiling made every subsequent server-assigned create on that
   collection fail permanently. Re-use is the cost of keeping the collection
   writable. **If you need monotonic ids, assign them yourself** rather than
   letting the server assign, and note that a ceiling record can be planted by
   an unauthenticated caller — see *And the id itself is an occupancy signal*
   under [Filter functions](#filter-functions) for the reachability path.
   String-id models are unaffected by this half: their keys are
   `<model>-<n>` and were never monotonic over an integer sequence.

   **The status.** `POST /{collection}` can now answer `409` for a reason other
   than a duplicate id: the server could not derive a free id. That requires a
   **non-injective** id transform — one that maps distinct candidates onto the
   same store key, such as `boolean`, or anything you registered on
   `Orm.instance.transforms` and named as an id type. It is a configuration
   fault rather than a request fault; the message is logged through
   `stonyx/log`. Previously this case threw out of the handler and express
   answered `500` with a stack trace.

9. **Both relationship route families now resolve the *related* model's own
   access class, so a related record that is hidden on its own routes is no
   longer served through another model's.**
   [#232](https://github.com/abofs/stonyx-orm/issues/232). Affects
   function-style `access` users with relationships between filtered models. The
   old behaviour was a bypass at **zero query parameters** and with no
   `include=`: measured on `dev @ 8dda5d6`, `GET /animals/1/owner` returned
   angela's full document and `GET /animals/1/relationships/owner` returned
   `{"type":"owner","id":"angela"}`, while `GET /owners/angela` answered `404`.
   The severe case is a model claimed by **no** access class — `getAccess()`
   returns `undefined`, no route is mounted for it at all, and it was still
   readable as a related resource.

   **The shapes, on both families.** A denied `hasMany` member is **dropped from
   the array**: `200`, `links` intact, no `errors` member. A denied `belongsTo`
   target answers **`200` with `data: null`**, byte-identical to a target that
   genuinely does not exist — same status, same bytes modulo the parent id the
   caller put in the URL. `404` on these routes is now reserved for the
   **parent**.

   **`data: null` and not `404`, deliberately.** The 404 spelling was an
   existence oracle and was measured as one on this branch: unauthenticated, no
   query string, one request each, against `tag` — the model with no route
   mounted at all — `GET /traits/1/tag` (absent) answered `200`
   `application/json` at 68 bytes while `GET /traits/2/tag` (denied) answered
   `404` `text/plain` at 9 bytes, and the document surface reported both as
   `{"data":null}`. It also brings these two routes into line with this module's
   rule that every status on a record route is identical for filtered-out and
   does-not-exist (see [Filter functions](#filter-functions)), which the `404`
   spelling was the one exception to.

   **What to check before you upgrade.** If a consumer reaches a related record
   through `GET /:models/:id/{relationship}` that it cannot reach on that
   record's own collection route, it was relying on the bypass and will now get
   `data: null` or a shorter array. And the related model's class is resolved
   through the same `Orm.instance.getAccess` path as the linkage filter, so it
   inherits the same arity limit: a **single-argument** predicate answers about
   the collection the request was *addressed to*, not the one it was asked
   about, and that is the direction that **grants**. See
   [Known limitations](#known-limitations) and
   [#221](https://github.com/abofs/stonyx-orm/issues/221).

   **Not closed here:** whether a related resource appears in `included` at all
   ([#233](https://github.com/abofs/stonyx-orm/issues/233)), and the
   re-parenting write ([#207](https://github.com/abofs/stonyx-orm/issues/207)).
   A **per-record** deny for a related resource is not expressible on these
   routes at all — see [Consumer Contracts](#consumer-contracts).

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
5. Each related record is judged by **its own** model's access class at the
   push site before it is added, so a denied record neither enters `included`
   nor becomes a parent at the next depth
   ([#233](https://github.com/abofs/stonyx-orm/issues/233)) — see the
   Limitations below for what "denied" does and does not cover
6. Each included record gets full `toJSON()` representation, with its
   **linkage filtered** by the same verdict object the primary document was
   serialized with ([#235](https://github.com/abofs/stonyx-orm/issues/235))

#### Limitations

- Only available on GET endpoints (not POST/PATCH)
- **`included` is access-filtered on both of the two questions.** *Re-specified
  by [#233](https://github.com/abofs/stonyx-orm/issues/233). The sentence this
  replaces said membership "is still unfiltered (#233): a record that is 404 on
  its own routes is still served as an `included` resource, attributes and
  all."* What a record already in `included` may **name** in its own
  `relationships.*.data` is filtered
  ([#235](https://github.com/abofs/stonyx-orm/issues/235)) — `?include=` no
  longer republishes ids the primary document withholds. Whether a resource
  appears in `included` **at all** is *membership*, and #233 filters it: a
  related resource is judged by **its own** model's access class at the
  traversal's push site, so a record that class's **per-record filter** rejects
  is not a member, and the subtree beneath it is never traversed.
- **Membership is filtered by the per-record filter, not by everything a
  record-addressed route refuses.** A deny expressed as a request-scoped
  `return false` — the shape the shipped sample uses for the `archived`
  owner — is **not** expressible on this path, because the linkage ask carries
  `recordId: null`. Measured on this branch and byte-identically on `dev`:
  `GET /owners/archived` is `403` while `GET /animals/9500?include=owner`
  serves her document in full. That is
  [#243](https://github.com/abofs/stonyx-orm/issues/243)'s mechanism, not
  #233's, and it reaches every linkage surface rather than only `GET /owners`.
  Express a per-record deny as a **filter** if you need `?include=` to honour
  it. See [Consumer Contracts](#consumer-contracts).

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
- **`context.recordId` here is NOT `AccessContext.recordId`.** Same name, same-shaped
  object, different coverage: `_withHooks` sets this key **only** under
  `operation === 'delete'`, so on `get` / `list` / `create` / `update` the key is
  **absent** — `beforeHook('update', 'owner', ctx => ctx.recordId === 'archived' ? 403 : undefined)`
  never fires (measured: `PATCH /owners/{id}` → 200 with `ctx.recordId === undefined`
  and the id sitting in `ctx.params`). The access context, by contrast, carries
  `recordId` on every route it classifies and spells absence as `null`, never
  `undefined`. Tracked as
  [#242](https://github.com/abofs/stonyx-orm/issues/242); see
  `AccessContext.recordId` in `src/types/orm-types.ts` for the other side.
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
