# SME Template: Architect — Stonyx ORM

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/architect.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx-orm`
**Framework:** Data persistence layer for the Stonyx ecosystem
**Domain:** ORM with model definitions, relationships (hasMany/belongsTo), serializers, transforms, lifecycle hooks, aggregate helpers, views, and multi-backend persistence (JSON file, MySQL, PostgreSQL, TimescaleDB)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ES Modules) |
| Runtime | Node.js |
| Framework | Stonyx (auto-discovered as `@stonyx/orm` module) |
| Database Adapters | JSON file (single/directory mode), MySQL (`mysql2`), PostgreSQL (`pg`), TimescaleDB |
| Events | `@stonyx/events` (pub/sub for hook system) |
| Scheduling | `@stonyx/cron` (auto-save intervals) |
| REST Integration | `@stonyx/rest-server` (optional peer dependency for auto-route registration) |
| Testing | QUnit + Sinon, with optional MySQL/PostgreSQL integration tests |

## Architecture Patterns

- **Singleton ORM with in-memory store:** `Orm` class enforces single instance; `Store` holds all records in nested `Map<modelName, Map<id, record>>` — SQL-backed models can optionally skip memory caching via `memory: false` flag
- **Proxy-based record access:** Records use ES `Proxy` to intercept property reads/writes, routing through transforms and change tracking — direct `__data` access bypasses this and is forbidden in consumer code
- **Auto-discovery pipeline:** Models, serializers, transforms, and access classes are loaded from configured directory paths via `forEachFileImport` with recursive scanning and kebab-to-PascalCase naming convention
- **Dual persistence path:** REST API operations go through `orm-request.ts` (hooks + store + optional SQL persist); programmatic operations use `Orm.create()` / `Orm.update()` / `Orm.remove()` static methods
- **Middleware hook system:** Events follow `{timing}:{operation}:{modelName}` naming (e.g., `before:create:animal`); before hooks can halt operations by returning a status code or response object
- **SQL adapter abstraction:** MySQL, PostgreSQL, and TimescaleDB each implement the `SqlDb` interface (`init`, `startup`, `shutdown`, `persist`, `findRecord`, `findAll`) with adapter-specific query builders, migration generators, and schema introspectors
- **View layer:** Read-only computed models resolved via `ViewResolver` that compose data from other models without direct database tables
- **Relationship registry:** Global maps track `hasMany`, `belongsTo`, `pending`, and `pendingBelongsTo` relationships; records are wired after creation, with cascading unload for cleanup

## Live Knowledge

- The store has two read paths: `get()` (sync, memory-only) and `find()` / `findAll()` (async, hits SQL for `memory: false` models) — using the wrong one causes silent data staleness
- JSON file mode supports two storage layouts: single `db.json` file or directory mode with one `{collection}.json` per model — migration commands (`db:migrate-to-directory`, `db:migrate-to-file`) handle conversion
- The `pluralName` static override on models affects REST route paths, JSON:API type references, AND database table names — a mismatch causes 404s or table-not-found errors
- `oldState` in hooks is captured via `JSON.parse(JSON.stringify())` deep copy before the operation — this means non-serializable values (functions, circular refs) are silently dropped
- The module waits for `@stonyx/rest-server` via `waitForModule('rest-server')` before mounting routes — if rest-server is not in `devDependencies`, the ORM still works but REST integration is silently skipped
- PostgreSQL and TimescaleDB adapters share connection and migration infrastructure but TimescaleDB adds hypertable creation and time-partitioned query building
