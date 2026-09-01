# Usage Patterns

## 1. Model Definition

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
- Override auto-pluralization with `static pluralName` (see [Overriding Plural Names](#overriding-plural-names))

### Overriding Plural Names

By default, model names are auto-pluralized (e.g., `animal` → `animals`) for REST routes, JSON:API URLs, and DB table names. When auto-pluralization produces the wrong result, override it with `static pluralName`:

```javascript
import { Model, attr } from '@stonyx/orm';

export default class PersonModel extends Model {
  static pluralName = 'people';

  name = attr('string');
}
```

The override is picked up automatically during ORM initialization — no additional registration is needed. All internal call sites (REST routes, JSON:API type references, MySQL table names, foreign key references) use the overridden value.

## 2. Serializers (Data Transformation)

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

## 3. Custom Transforms

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

## 4. CRUD Operations

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

## 5. Database Schema

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

## 6. Persistence

```javascript
import Orm from '@stonyx/orm';

// Save to file
await Orm.db.save();

// Data auto-serializes to JSON file
// Reload using createRecord with serialize:false, transform:false
```

## 7. Access Control

> **DO NOT RECONSTRUCT THE REQUEST PATH — and since
> [#202](https://github.com/abofs/stonyx-orm/issues/202) you do not have to.**
> `access()` receives a second argument, `{ model, operation }`, and `model`
> already names the collection. Every version of this example that worked the
> collection out from the request target instead failed **open** — five distinct
> variants (mount-relative `url`, query string, case, mount prefix, and an
> absolute-form request-target), each found only after the previous was fixed.
> The five are recorded in the sample below as **history, not as rules to
> follow**: they are unconstructible against a predicate that reads `model`. See
> README "Identifying the collection", which replaces any
> matching at all with the model, operation and record.
>
> **One read of argument one survives, and it must:** `request.path`, for the
> `/archived` sub-path deny. The context names which model and which verb, not
> which route, so that deny cannot be expressed from the context alone and a
> context-only rewrite would silently turn it into an allow. Guard it where it
> is read — a fail-closed check on the *context* does not protect a read of the
> *request*.
>
> **Case-folding is not a sufficient normalisation.** `request.path` is the raw,
> undecoded pathname while the router decodes `:id`, so `/owners/%61rchived`
> steps around a `path === '/archived'` deny. Live in the sample below, tracked
> as [#228](https://github.com/abofs/stonyx-orm/issues/228), not fixed here.
>
> **This file does not ship.** `npm pack` includes `dist`, `src`, `config` and
> `README.md` only, so a consumer sees the README section and the header of
> `src/orm-request.ts` — the two copies that must stay complete. Treat this as
> the working notes, not the delivered warning.

```javascript
// This is the shipped fixture (test/sample/access/global-access.ts) and the
// README sample, which are asserted to be the same code line for line.
export default class GlobalAccess {
  models = ['owner', 'animal']; // or '*' for all

  access(request, { model, operation, recordId }) {
    // WHY THERE IS NO MATCHING HERE. `model` is the model name
    // setup-rest-server mounted this route for, assigned once at mount time.
    // No request can influence it, so there is nothing to parse and no variant
    // to miss. Before #202 this method identified its collection from the
    // request target, and VARIANTS 1, 2, 4 AND 5 WERE ALL THE SAME MISTAKE:
    //
    //   1. `request.url` is mount-relative — RestServer.mountRoute mounts each
    //      model as an Express sub-app, so GET /owners/angela arrives with
    //      url === '/angela'. A prefix match against it is ALWAYS false, the
    //      branch never fires, and access() falls through to the CRUD array
    //      below with no filter on any surface.
    //   2. `request.originalUrl` carries the query string, so a bare
    //      `=== '/owners'` misses /owners?filter[age]=30 and that collection
    //      comes back UNFILTERED.
    //   3. A case-SENSITIVE matcher is stricter than the router that dispatched
    //      the request (RestServer mounts with a bare express(), whose default
    //      is caseSensitive:false), so it can be stepped around:
    //        GET /owners/angela -> 404   but  GET /OwNeRs/angela -> 200, in full
    //        DELETE /animals/22 -> 404   but  DELETE /ANIMALS/22 -> 204, destroyed
    //      Router-side fix: abofs/stonyx-rest-server#47.
    //   4. A hard-coded '/owners' matches nothing under ORM_REST_ROUTE=/api.
    //      And the documented remediation was itself broken:
    //      `${config.orm.restServer.route}owners` is '/apiowners', so a reader
    //      who followed the correction still failed open.
    //   5. HTTP/1.1 permits an ABSOLUTE-FORM request-target. Express routes on
    //      parseurl(req).pathname so the request dispatches normally, but
    //      originalUrl is the RAW target:
    //        GET http://anything.example/owners/angela
    //      has no '/owners' prefix. Measured: angela came back in full, DELETE
    //      succeeded, and it walked past the hard `return false` deny too.
    //
    // An intermediate revision read `request.baseUrl`, the mount Express
    // MATCHED, which closed all five. It was still a transport artifact
    // standing in for a structural fact. `model` is the structural fact, so
    // VARIANTS 1, 2, 4 AND 5 are now unconstructible rather than handled — and
    // neither `baseUrl` nor `originalUrl` appears below. THE STRING COMPARISON
    // VARIANT 3 LIVED IN IS GONE TOO, as of abofs/stonyx-orm#236: the sub-path
    // rule is now a comparison against `recordId`, the record this route was
    // ADDRESSED TO — decoded by the router and coerced to the key the store
    // lookup uses. Nothing below reads argument one at all. (Retiring the
    // "variant 3 survives" wording across the copies that still carry it is
    // abofs/stonyx-orm#238.)
    //
    // `operation` is destructured to name the whole contract at the point of
    // use; this sample's rules are per-model and per-record, so the verb is
    // answered by the permission array at the bottom.

    // FAIL CLOSED ON AN UNIDENTIFIABLE MODEL. `String(request.originalUrl ?? '')`
    // was once added to stop a TypeError and traded fail-closed for fail-OPEN:
    // '' matched no collection, so access() fell through and granted full CRUD.
    // The same rule applies to the context — an input this function cannot
    // identify DENIES.
    if (typeof model !== 'string' || model === '') return false;

    if (model === 'owner') {
      // FAIL CLOSED ON AN ABSENT `recordId` TOO, AND `undefined` IS THE ONLY
      // SPELLING OF ABSENT. `auth()` ALWAYS sets the key — `null` on a
      // collection route, which is addressed to no record — so `undefined`
      // means the context did not come from `auth()`: it was hand-assembled by
      // a caller resolving this predicate through the documented
      // `Orm.instance.getAccess()` path. Letting that through falls straight to
      // the per-record filter below: a DENY becoming an ALLOW. This is the same
      // rule the old guard on `request.path` enforced, moved to the argument
      // this predicate now actually reads.
      if (recordId === undefined) return false;

      // THE /archived DENY, AGAINST THE DECODED ID. It was
      // `request.path.toLowerCase()` compared against '/archived', and that was
      // wrong in BOTH directions at once.
      //
      // TOO PERMISSIVE: express sets `request.path` from the RAW pathname while
      // the router DECODES `:id`, so GET /owners/%61rchived reached the
      // comparison as /%61rchived, walked past the deny and was dispatched as
      // the record `archived` — 200 with the record in full, and DELETE
      // answered 204 with the record DESTROYED, unauthenticated. 255
      // non-canonical spellings of that 8-character id decode to the same key.
      //
      // TOO STRICT: a record id is a VALUE, not a literal route segment, and
      // express's `case sensitive routing` governs literal segments only. With
      // a distinct owner seeded at ARCHIVED the .toLowerCase() 403'd
      // GET /owners/ARCHIVED — the wrong record — while still admitting
      // GET /owners/%41RCHIVED, the same record encoded.
      //
      // SO DO NOT NORMALISE `recordId`: it is already decoded, exactly once,
      // which is what a route parameter means. /owners/%2561rchived is the
      // legitimate id %61rchived and decoding until stable would deny it; do
      // not case-fold; do not rebuild it from `request.path`, which decodes
      // THEN splits while the router splits THEN decodes and so over-denies the
      // distinct record at /owners/archived%2fx.
      //
      // THE DENY IS NOW EXPRESSIBLE FROM THE CONTEXT ALONE — that is what
      // `recordId` bought — and it still must not be dropped. Deleting it does
      // not remove a rule, it turns a deny into an ALLOW, silently.
      if (recordId === 'archived') return false;

      // Per-record filter. Enforced on every surface ADDRESSED TO a record — the
      // collection, GET/PATCH/DELETE by id, and both relationship route families
      // — not on the collection alone. A rejected record is 404 on record routes
      // (indistinguishable from a record that does not exist) and 403 on POST.
      //
      // NOTE: with a filter in force, a POST carrying a client-supplied `id` is
      // refused with 403 whatever the payload, and BEFORE any store lookup —
      // that is what stops POST being an id-enumeration oracle, in status and in
      // latency. Let the server assign the id.
      //
      // "Whatever the payload" is a claim about the `id` member of the resource
      // object, and it holds only because that is the sole channel a caller id
      // can arrive on for THIS model's create route. `attributes.id` and
      // `relationships.id` are both stripped for that reason. A `relationships`
      // key that is NOT a declared relationship is still applied —
      // abofs/stonyx-orm#204.
      //
      // AND IT IS NOT A GUARANTEE THAT A HIDDEN RECORD CANNOT BE MODIFIED. A
      // write to ANOTHER collection can re-parent one and de-hide it —
      // abofs/stonyx-orm#207, blocked on #196.
      return record => record.id !== 'angela' && record.id !== 'restricted';
    }

    // `record.owner` resolves to an OrmRecord, not to the owner's id string.
    // Comparing it directly against a string is never equal, which is the bug
    // that made this predicate inert while looking like it worked.
    if (model === 'animal') return record => record.owner?.id !== 'restricted';

    // Grant CRUD permissions. A bare string ('read') is ONE permission, not a
    // grant of all four. Any shape that is not a boolean, a string, an array or
    // a function returns 403 — unknown shapes fail closed.
    return ['read', 'create', 'update', 'delete'];
  }
}
```

## 8. REST API (Auto-generated)

```javascript
// Endpoints auto-generated for models:
// GET    /owners          - List all
// GET    /owners/:id       - Get one
// POST   /animals          - Create
// PATCH  /animals/:id      - Update (attributes and/or relationships)
// DELETE /animals/:id      - Delete
```

**PATCH supports both attributes and relationships:**
```javascript
// Update attributes only
PATCH /animals/1
{ data: { type: 'animal', attributes: { age: 5 } } }

// Update relationship only
PATCH /animals/1
{ data: { type: 'animal', relationships: { owner: { data: { type: 'owner', id: 'gina' } } } } }

// Update both
PATCH /animals/1
{ data: { type: 'animal', attributes: { age: 5 }, relationships: { owner: { data: { type: 'owner', id: 'gina' } } } } }
```

## 9. Include Parameter (Sideloading)

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
1. Query param parsed into path segments: `owner.pets` -> `[['owner'], ['owner', 'pets'], ['traits']]`
2. `traverseIncludePath()` recursively traverses relationships depth-first
3. Deduplication still by type+id (no duplicates in included array)
4. Gracefully handles null/missing relationships at any depth
5. Each included record gets full `toJSON()` representation — **unfiltered**.
   `buildResponse` calls `toJSON({ baseUrl })` with no `linkage` verdict, so a
   permitted included record still names every related id, including ones the
   primary document withheld (abofs/stonyx-orm#235). Whether the resource is
   included at all is a separate, also-unfiltered question
   (abofs/stonyx-orm#233).

**Key Functions:**
- `parseInclude()` - Splits comma-separated includes and parses nested paths
- `traverseIncludePath()` - Recursively traverses relationship paths
- `collectIncludedRecords()` - Orchestrates traversal and deduplication
- All implemented in [src/orm-request.js](../src/orm-request.js)

## 10. Views (Read-Only Computed Data)

Views are read-only projections that compute derived data from existing models. They work in both JSON mode (in-memory) and MySQL mode (auto-generated SQL VIEWs). See the full guide at [views.md](views.md).

### Defining a View

```javascript
// views/owner-stats.js
import { View, attr, belongsTo, count, avg } from '@stonyx/orm';

export default class OwnerStatsView extends View {
  static source = 'owner';  // Required: model whose records produce view records

  animalCount = count('pets');     // COUNT of hasMany relationship
  averageAge = avg('pets', 'age'); // AVG of a field on related records
  owner = belongsTo('owner');      // Link back to source record
}
```

### Aggregate Helpers

| Helper | Example | JS Behavior | MySQL |
|--------|---------|-------------|-------|
| `count(rel)` | `count('pets')` | `records.length` | `COUNT(table.id)` |
| `avg(rel, field)` | `avg('pets', 'age')` | Average of values | `AVG(table.field)` |
| `sum(rel, field)` | `sum('pets', 'age')` | Sum of values | `SUM(table.field)` |
| `min(rel, field)` | `min('pets', 'age')` | Minimum value | `MIN(table.field)` |
| `max(rel, field)` | `max('pets', 'age')` | Maximum value | `MAX(table.field)` |

### Resolve Map (Escape Hatch)

For fields that can't be expressed as aggregates:

```javascript
export default class OwnerStatsView extends View {
  static source = 'owner';
  static resolve = {
    gender: 'gender',              // String path from source data
    score: (owner) => owner.age * 10,  // Function
  };

  gender = attr('string');  // Must also define as attr()
  score = attr('number');
  animalCount = count('pets');
}
```

### Querying Views

```javascript
const stats = await store.findAll('owner-stats');
const stat = await store.find('owner-stats', ownerId);
```

### Read-Only Enforcement

```javascript
createRecord('owner-stats', data);   // Throws: Cannot create records for read-only view
updateRecord(viewRecord, data);       // Throws: Cannot update records for read-only view
store.remove('owner-stats', id);      // Throws: Cannot remove records from read-only view
```

### REST API

Only GET endpoints are mounted for views — no POST, PATCH, or DELETE.

## 11. Field Assignment Semantics

ModelProperty treats `undefined` and `null` as **distinct sentinels** by design:

- `undefined` means **"not provided — leave the existing value alone"**
- `null` means **"explicitly clear the field"**

This split is what makes PATCH-style partial updates work: a payload that omits a field (`undefined` at that key) leaves the stored value untouched, while a payload that sets a field to `null` actually clears it.

### The Four Assignment Paths

| Path | Result |
|------|--------|
| `record.field = undefined` | **No-op** — existing value preserved |
| `record.field = null` | Sets to `null` (clears the field) |
| Update payload omits the field | Field not touched |
| Update payload sets field to `null` | Sets to `null` |

### Example

```javascript
import { createRecord, updateRecord } from '@stonyx/orm';

const record = createRecord('owner', { id: 'bob', gender: 'female' }, { serialize: false });

record.gender = undefined; // no-op — still 'female'
record.gender = null;      // clears — now null

// Partial update: omitted fields stay untouched
record.gender = 'male';
updateRecord(record, { age: 31 });  // gender still 'male'
updateRecord(record, { sex: null }); // explicitly clears gender (mapped via serializer)
```

**Key Points:**
- Direct assignment of `undefined` is safe — it never overwrites
- Direct assignment of `null` is the canonical way to clear a field (no `setNull()` helper is needed)
- Update payloads behave the same way: missing key = untouched, explicit `null` = cleared
- The setter lives in [`src/model-property.ts`](../src/model-property.ts) (the `if (newValue === undefined) return;` no-op); the partial-update skip lives in [`src/serializer.ts`](../src/serializer.ts) (`if (data === undefined && options.update) continue;`)

