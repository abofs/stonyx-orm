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
| Auth Model | Access classes with per-model `access(request)` methods |

## Architecture Patterns

- **Access class authorization:** Access classes define which models are exposed and return allowed operations (`['read', 'create', 'update', 'delete']`) or `false` per request — this is the primary authorization gate for REST endpoints
- **Before-hook halting:** `beforeHook` middleware can return HTTP status codes (e.g., 400, 403) to block operations before they reach the store or database — this is the secondary validation layer
- **SQL query parameterization:** MySQL, PostgreSQL, and TimescaleDB adapters use parameterized queries via their respective drivers (`mysql2`, `pg`) — review query builders for injection vectors
- **JSON file persistence:** In file/directory mode, data is written directly to disk as JSON — no encryption, no access control beyond filesystem permissions

## Live Knowledge

- Access classes receive the raw Express `request` object — any authorization logic that reads headers, cookies, or tokens runs in this layer and must validate inputs defensively
- Authorize on `request.params`, never on a URL property: inside the mounted sub-app `request.url` is rewritten relative to the mount point, and `originalUrl` / `baseUrl` / `path` are raw client text that varies with query strings, trailing slashes, casing and percent-encoding (abofs/stonyx-orm#265)
- `request.params.id` is raw text too — the ORM coerces a numeric-looking id with `parseInt` (no radix) *before* it resolves the record, so a predicate comparing the raw value denies one spelling and grants its aliases (`007`, `7.0`, `0x7`, `%207`). Normalise before comparing; abofs/stonyx-orm#270 tracks exporting the normaliser
- A function return from `access()` is an unconditional allow — `auth()` applies the operations list only on the array branch, so a collection filter also authorizes writes on that collection
- The `include` query parameter for relationship sideloading traverses relationships recursively — unbounded `include` depth could expose more data than intended or cause performance issues
- The `__data` / `__relationships` internals on records are accessible via the proxy but marked as private — consumer code that bypasses the proxy can skip transforms and write arbitrary values
- SQL migration generation compares model schemas against database state — the generated SQL runs with the configured database user's permissions, so privilege escalation depends on the DB user's grants
- `DB_AUTO_SAVE` in `onUpdate` mode writes to disk after every REST mutation — high write volumes can cause filesystem contention; `DB_FILE` / `DB_DIRECTORY` paths are taken from config without path traversal validation
- The `body` property in hook context (`context.body.data.attributes`) comes directly from the parsed JSON request body — hooks that read these values must treat them as untrusted input
- Connection credentials for MySQL/PostgreSQL are read from environment variables and passed to driver constructors — ensure these are not logged or exposed in error messages
