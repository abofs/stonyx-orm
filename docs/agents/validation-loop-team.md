# SME Template: Validation Loop Team — Stonyx ORM

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/validation-loop-team.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx-orm`
**Framework:** Data persistence layer for the Stonyx ecosystem
**Domain:** ORM covering models, relationships, serialization, hooks, views, aggregates, and persistence across JSON file, MySQL, PostgreSQL, and TimescaleDB

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ES Modules) |
| Runtime | Node.js |
| Testing | QUnit + Sinon |
| CI | GitHub Actions (`ci.yml`) |
| Database Adapters | JSON file, MySQL, PostgreSQL, TimescaleDB |

## Architecture Patterns

- **Multi-backend persistence with shared interface:** All SQL adapters implement `SqlDb` (`init`, `startup`, `shutdown`, `persist`, `findRecord`, `findAll`) — changes to this interface require validation across MySQL, PostgreSQL, and TimescaleDB adapters
- **Two record creation paths:** REST-originated records go through `orm-request.ts` (with hooks and access control); programmatic records use `Orm.create()` / `Orm.update()` / `Orm.remove()` — both must produce identical store and database states
- **Event-driven hooks:** Hook events are registered via `@stonyx/events` setup during `init()` — the event name list is derived from discovered models, so adding a new model automatically creates its hook events
- **Store dual-read API:** Sync `store.get()` for memory-cached models, async `store.find()` / `store.findAll()` for SQL-backed models — the `_memoryResolver` callback determines which path is used

## Live Knowledge

- Relationship cascading on unload is order-sensitive: `hasMany` arrays are spliced, `belongsTo` references are nullified, then registry entries are cleaned — validation must cover all three cleanup phases, especially for bidirectional relationships
- The `plural-registry.ts` maps model names to their plural forms for REST routes and DB table names — `pluralize()` from `@stonyx/utils` handles most cases, but models with irregular plurals need `static pluralName` — missing overrides cause silent route/table mismatches
- Migration drift detection compares model attribute definitions against live database schemas — the schema introspectors for MySQL and PostgreSQL handle type mapping differently (e.g., `attr('number')` maps to `INT` in MySQL but `INTEGER` in PostgreSQL)
- The `include` parameter for relationship sideloading supports arbitrary nesting depth (`owner.pets.traits`) with deduplication by type+id — deep nesting with circular relationships must terminate without infinite recursion
- Published package includes both `dist/` and `src/` (per `files` in package.json) — validate that TypeScript source files don't contain debug code or test-only imports
- `Orm.ready` is assigned from `Promise.all(promises)` in `init()` — if any sub-initialization (DB, rest-server setup, model loading) fails, the entire ORM init rejects, but partial state may already exist in the store
