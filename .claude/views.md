# Views

Views are read-only, model-like structures that compute derived data from existing models. They work in both JSON file mode (in-memory computation) and MySQL mode (auto-generated SQL VIEWs).

## What Views Are

A View defines a read-only projection over source model data. Use views when you need:
- Aggregated data (counts, averages, sums) derived from model relationships
- Computed read-only summaries that shouldn't be persisted as separate records
- MySQL VIEWs that are auto-generated from your JavaScript definition

## Defining a View

Views extend the `View` base class and are placed in the `views/` directory (configurable via `paths.view`).

```javascript
// views/owner-stats.js
import { View, attr, belongsTo, count, avg } from '@stonyx/orm';

export default class OwnerStatsView extends View {
  static source = 'owner'; // The model whose records are iterated

  animalCount = count('pets');    // COUNT of hasMany relationship
  averageAge = avg('pets', 'age'); // AVG of a field on related records
  owner = belongsTo('owner');     // Link back to the source record
}
```

### File Naming

- File: `owner-stats.js` → Class: `OwnerStatsView` → Store name: `'owner-stats'`
- Directory: configured via `paths.view` (default: `'./views'`)
- Environment variable: `ORM_VIEW_PATH`

### Key Static Properties

| Property | Default | Description |
|----------|---------|-------------|
| `source` | `undefined` | **(Required)** The model name whose records produce view records |
| `resolve` | `undefined` | Optional escape-hatch map for custom derivations |
| `memory` | `false` | `false` = computed on demand; `true` = cached on startup |
| `readOnly` | `true` | **Enforced** — cannot be overridden to `false` |
| `pluralName` | `undefined` | Custom plural name (same as Model) |

## Aggregate Helpers

Aggregate helpers define fields that compute values from related records. Each helper knows both its JavaScript computation logic and its MySQL SQL translation.

| Helper | JS Behavior | MySQL Translation |
|--------|-------------|-------------------|
| `count(relationship)` | `relatedRecords.length` | `COUNT(table.id)` |
| `avg(relationship, field)` | Average of field values | `AVG(table.field)` |
| `sum(relationship, field)` | Sum of field values | `SUM(table.field)` |
| `min(relationship, field)` | Minimum field value | `MIN(table.field)` |
| `max(relationship, field)` | Maximum field value | `MAX(table.field)` |

### Empty/Null Handling

- `count` with empty/null relationship → `0`
- `avg` with empty/null relationship → `0`
- `sum` with empty/null relationship → `0`
- `min` with empty/null relationship → `null`
- `max` with empty/null relationship → `null`
- Non-numeric values are filtered/treated as 0

## Resolve Map (Escape Hatch)

For computed fields that can't be expressed as aggregates, use `static resolve`:

```javascript
export default class OwnerStatsView extends View {
  static source = 'owner';

  static resolve = {
    gender: 'gender',           // String path: maps from source record data
    score: (owner) => {         // Function: custom computation
      return owner.__data.age * 10;
    },
    nestedVal: 'details.nested', // Nested string paths supported
  };

  // Must also define as attr() for the serializer to process
  gender = attr('string');
  score = attr('number');
  nestedVal = attr('passthrough');

  animalCount = count('pets');
}
```

**Important:** Each resolve map entry needs a corresponding `attr()` field definition on the view.

## Querying Views

Views use the same store API as models:

```javascript
// All view records (computed fresh each call in JSON mode)
const stats = await store.findAll('owner-stats');

// Single view record by source ID
const stat = await store.find('owner-stats', ownerId);

// With conditions
const filtered = await store.findAll('owner-stats', { animalCount: 5 });
```

## Read-Only Enforcement

Views are strictly read-only at all layers:

```javascript
// All of these throw errors:
createRecord('owner-stats', data);        // Error: Cannot create records for read-only view
updateRecord(viewRecord, data);            // Error: Cannot update records for read-only view
store.remove('owner-stats', id);           // Error: Cannot remove records from read-only view

// Internal use only — bypasses guard:
createRecord('owner-stats', data, { isDbRecord: true }); // Used by resolver/loader
```

## REST API Behavior

When a view is included in an access configuration, only GET endpoints are mounted:

- `GET /view-plural-name` — Returns list of view records
- `GET /view-plural-name/:id` — Returns single view record
- `GET /view-plural-name/:id/{relationship}` — Related resources
- No POST, PATCH, DELETE endpoints

## JSON Mode (In-Memory Resolver)

In JSON/non-MySQL mode, the ViewResolver:

1. Iterates all records of the `source` model from the store
2. For each source record:
   - Computes aggregate properties from relationships
   - Applies resolve map entries (string paths or functions)
   - Maps regular attr fields from source data
3. Creates view records via `createRecord` with `isDbRecord: true`
4. Returns computed array

## MySQL Mode

In MySQL mode:

1. **Schema introspection** generates VIEW metadata via `introspectViews()`
2. **DDL generation** creates `CREATE OR REPLACE VIEW` SQL from aggregates and relationships
3. **Queries** use `SELECT * FROM \`view_name\`` just like tables
4. **Migrations** include `CREATE OR REPLACE VIEW` after table statements
5. **persist()** is a no-op for views
6. **loadMemoryRecords()** loads views with `memory: true` from the MySQL VIEW

### Generated SQL Example

For `OwnerStatsView` with `count('pets')` and `avg('pets', 'age')`:

```sql
CREATE OR REPLACE VIEW `owner-stats` AS
SELECT
  `owners`.`id` AS `id`,
  COUNT(`animals`.`id`) AS `animalCount`,
  AVG(`animals`.`age`) AS `avgAge`
FROM `owners`
  LEFT JOIN `animals` ON `animals`.`owner_id` = `owners`.`id`
GROUP BY `owners`.`id`
```

## Migration Support

Views are handled in migrations alongside tables:

- **Added views** → `CREATE OR REPLACE VIEW ...` in UP, `DROP VIEW IF EXISTS ...` in DOWN
- **Removed views** → Commented `DROP VIEW` warning in UP (matching model removal pattern)
- **Changed views** → `CREATE OR REPLACE VIEW ...` in UP (replaces automatically)
- Views appear AFTER table statements in migrations (dependency order)
- Snapshots include view entries with `isView: true` and `viewQuery`

## Memory Flag

- `static memory = false` (default) — View records are computed fresh on each query
- `static memory = true` — View records are loaded from MySQL VIEW on startup and cached

## Testing Views

```javascript
import QUnit from 'qunit';
import { store } from '@stonyx/orm';

QUnit.test('view returns computed data', async function(assert) {
  // Create source data
  createRecord('owner', { id: 1, name: 'Alice' }, { serialize: false });
  createRecord('animal', { id: 1, age: 3, owner: 1 }, { serialize: false });

  // Query the view
  const results = await store.findAll('owner-stats');
  const stat = results.find(r => r.id === 1);

  assert.strictEqual(stat.__data.animalCount, 1);
});
```

## Architecture

### Source Files

| File | Purpose |
|------|---------|
| `src/view.js` | View base class |
| `src/aggregates.js` | AggregateProperty class + helper functions |
| `src/view-resolver.js` | In-memory view resolver |
| `src/mysql/schema-introspector.js` | `introspectViews()`, `buildViewDDL()` |
| `src/mysql/migration-generator.js` | `diffViewSnapshots()`, view migration generation |

### Key Design Decisions

1. **View does NOT extend Model** — conceptually separate; shared behavior is minimal
2. **Driver-agnostic API** — No SQL in view definitions; MySQL driver generates SQL automatically
3. **Aggregate helpers follow the transform pattern** — Each knows both JS computation and MySQL mapping
4. **Resolve map mirrors Serializer.map** — String paths or function resolvers
5. **View schemas are separate** — `introspectViews()` is separate from `introspectModels()`
