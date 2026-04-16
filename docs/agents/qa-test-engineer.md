# SME Template: QA Test Engineer — Stonyx ORM

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/qa-test-engineer.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx-orm`
**Framework:** Data persistence layer for the Stonyx ecosystem
**Domain:** ORM with model definitions, relationships, serializers, hooks, aggregate helpers, views, and multi-backend persistence

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Test Runner | QUnit (via `stonyx test`) |
| Mocking | Sinon |
| Build (tests) | `tsc -p tsconfig.test.json` (outputs to `dist-test/`) |
| Test Command | `npm run build && npm run build:test && stonyx test 'dist-test/test/**/*-test.js'` |
| Test Fixtures | `test/sample/` directory with sample models, serializers, transforms, access classes |
| Test Config | `test/config/environment.js` with overrides for file paths and DB settings |
| Integration DB | MySQL (optional, via `scripts/setup-test-db.sh` — creates `stonyx_orm_test` database) |

## Architecture Patterns

- **Three test tiers:** `test/unit/` for isolated logic, `test/integration/` for full ORM lifecycle with REST server, `test/helpers/` for shared test utilities
- **Sample fixtures:** `test/sample/` contains real model, serializer, transform, and access class files that the ORM discovers during integration tests — changes here affect test behavior
- **Singleton cleanup:** Tests must call `clearAllHooks()` in teardown and reset `Orm.instance`, `Store.instance`, and relationship registries between test runs to prevent state leakage
- **Optional MySQL tests:** Integration tests that require MySQL check availability at runtime; they skip gracefully in CI (`CI=true`) when MySQL is not present

## Live Knowledge

- The `store` singleton (`Store.instance`) persists across tests — always reset it in `afterEach` or use the helper cleanup functions to avoid false positives from cached records
- Hook tests should verify both the halting path (before hook returns a value) and the pass-through path (returns `undefined`) — the distinction between `return undefined` and no return statement matters
- Relationship wiring tests need to create records in the correct order: parent records must exist in the store before child records reference them via `belongsTo` — out-of-order creation triggers the pending relationship queue
- `createRecord` and `updateRecord` are the programmatic entry points; `Orm.create()` / `Orm.update()` / `Orm.remove()` add SQL persistence on top — test both paths separately
- The proxy-based record access means `record.age` and `record.__data.age` can diverge if transforms are involved — test assertions should always use the proxy interface
- View resolver tests need both source models populated in the store and view definitions registered — views are read-only, so `store.remove()` on a view model name should throw
- Auto-save tests (`DB_AUTO_SAVE: 'onUpdate'`) need to verify that file writes happen after each mutation and that `DB_AUTO_SAVE: 'true'` uses the cron interval instead
