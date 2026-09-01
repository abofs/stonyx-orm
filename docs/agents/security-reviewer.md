# SME Template: Security Reviewer — Stonyx ORM

> **Inherits from:** `beatrix-shared/docs/framework/templates/agents/security-reviewer.md`
> Load the base template first, then layer this project-specific context on top.

## Project Context

**Repo:** `abofs/stonyx-orm`
**Framework:** Data persistence layer for the Stonyx ecosystem
**Domain:** ORM handling data storage, retrieval, and mutation across JSON file, MySQL, PostgreSQL, and TimescaleDB backends — with REST API auto-registration and access control

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ES Modules) |
| Database Adapters | JSON file, MySQL (`mysql2`), PostgreSQL (`pg`), TimescaleDB |
| REST Integration | `@stonyx/rest-server` (Express-based, optional peer dependency) |
| Auth Model | Access classes with per-model `access(request, { model, operation })` methods |

## Architecture Patterns

- **Access class authorization:** Access classes define which models are exposed and return allowed operations (`['read', 'create', 'update', 'delete']`) or `false` per request — this is the primary authorization gate for REST endpoints
- **Before-hook halting:** `beforeHook` middleware can return HTTP status codes (e.g., 400, 403) to block operations before they reach the store or database — this is the secondary validation layer
- **SQL query parameterization:** MySQL, PostgreSQL, and TimescaleDB adapters use parameterized queries via their respective drivers (`mysql2`, `pg`) — review query builders for injection vectors
- **JSON file persistence:** In file/directory mode, data is written directly to disk as JSON — no encryption, no access control beyond filesystem permissions

## Live Knowledge

- Access classes are called as `access(request, { model, operation })`. Argument **one** is the raw Express `request` object — any authorization logic that reads headers, cookies, or tokens runs in this layer and must validate inputs defensively. Argument **two** is the access context, and `model` is fixed at mount time, so a predicate that identifies its collection by parsing argument one is re-deriving a fact the framework already holds — the five ways that has failed open are in README "Identifying the collection". A predicate that ignores argument two answers about the collection the request is *addressed to*, which is the wrong answer whenever it is resolved through `Orm.instance.getAccess(<another model>)`, and it is wrong in the direction that **grants**
- **That is not a blanket prohibition on reading argument one, and reviewing it as one turns a deny into an allow.** The context names which *model* and which *verb*, **not which route** — `GET /owners`, `GET /owners/gina` and `GET /owners/archived` all produce `{ model: 'owner', operation: 'read' }` — so a rule that depends on the **sub-path** still needs `request.path`, and the shipped sample keeps exactly one such read for its `/archived` deny. Migrating that read away does not remove a rule, it converts a deny into a silent allow. Two consequences for review: a fail-closed guard on argument **two** does not protect a read of argument **one** (they are different objects, and both must be guarded at their own read), and `request.path` is the **raw, undecoded** pathname while the router decodes `:id`, so `.toLowerCase()` is not a sufficient normalisation — see [#228](https://github.com/abofs/stonyx-orm/issues/228)
- The `include` query parameter for relationship sideloading traverses relationships recursively — unbounded `include` depth could expose more data than intended or cause performance issues
- The `__data` / `__relationships` internals on records are accessible via the proxy but marked as private — consumer code that bypasses the proxy can skip transforms and write arbitrary values
- SQL migration generation compares model schemas against database state — the generated SQL runs with the configured database user's permissions, so privilege escalation depends on the DB user's grants
- `DB_AUTO_SAVE` in `onUpdate` mode writes to disk after every REST mutation — high write volumes can cause filesystem contention; `DB_FILE` / `DB_DIRECTORY` paths are taken from config without path traversal validation
- The `body` property in hook context (`context.body.data.attributes`) comes directly from the parsed JSON request body — hooks that read these values must treat them as untrusted input
- Connection credentials for MySQL/PostgreSQL are read from environment variables and passed to driver constructors — ensure these are not logged or exposed in error messages
