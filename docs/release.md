# Release Process

Verified against the three workflow files in this repo — `.github/workflows/ci.yml`, `.github/workflows/publish.yml`, `.github/workflows/security-audit.yml` — and `package.json`'s `prepublishOnly` script, as they stand on `dev` at the time of writing. This is the code's-eye view of release: what triggers what, and what gates what. It does not cover infrastructure (AWS, secrets, branch protection) — that is out of scope here and not inspectable from this repo's code anyway.

## What still matches the previous `docs/release.md`

The previous file's one substantive claim — "this package follows the Stonyx shared release pipeline managed by stonyx-workflows" — still holds. Both `ci.yml` and `publish.yml` confirm the delegation: every job in both files is a single `uses: abofs/stonyx-workflows/.github/workflows/<name>@main` line, with this repo's workflow file supplying only triggers, concurrency, permissions, and (for publish) inputs. The npm package name, `@stonyx/orm`, is also unchanged (`package.json` `name`).

What the previous file did not say, and could not without reading three separate workflow files plus `package.json`, is below.

## CI — `.github/workflows/ci.yml`

- **Trigger:** `pull_request` targeting `dev`, `main`, or any `fix/**` branch.
- **Concurrency:** one run per `github.head_ref` (or `github.ref`); a new push cancels the in-flight run (`cancel-in-progress: true`).
- **Permissions:** `contents: read` only.
- **Job:** a single job, `test`, which is entirely `uses: abofs/stonyx-workflows/.github/workflows/ci.yml@main`. No inputs or secrets are passed. The actual build/test steps that run are defined in that reusable workflow, in the separate `abofs/stonyx-workflows` repo — not visible from this repo's code, and not verified here.

## Publish — `.github/workflows/publish.yml`

- **Triggers (four):**
  1. `repository_dispatch` with type `cascade-publish` — fired by another package's publish, for cascading version bumps across the Stonyx monorepo-of-repos.
  2. `workflow_dispatch`, manual, with a required `version-type` choice (`patch`/`minor`/`major`) and an optional `custom-version` string override.
  3. `pull_request` (`opened`, `synchronize`, `reopened`) targeting `dev` or `main`.
  4. `push` to `dev` or `main`.
- **Concurrency:** group `cascade-update` for `repository_dispatch` events, else `publish-<ref>`; `cancel-in-progress: false` — publishes are allowed to queue, never cancelled mid-flight.
- **Permissions:** `contents: write`, `id-token: write` (OIDC — consistent with `publishConfig.provenance: true` in `package.json`), `pull-requests: write`.
- **Jobs (two, sequential):**
  1. `publish` — `uses: abofs/stonyx-workflows/.github/workflows/npm-publish.yml@main`, given `version-type`, `custom-version`, and `cascade-source` (from the dispatch payload) as inputs, `secrets: inherit`. It is expected to output `package-name` and `published-version`, consumed by the next job.
  2. `cascade` (`needs: publish`) — `uses: abofs/stonyx-workflows/.github/workflows/cascade.yml@main`, given `publish`'s two outputs, `secrets: inherit`.
- **What is not verifiable from this repo's code:** how `version-type`/`custom-version` are turned into an actual semver bump, how the tag/commit is produced, how `npm publish` is actually invoked (provenance flags, registry auth), and what the cascade step does to downstream packages are all implemented inside `abofs/stonyx-workflows`, a separate repository. None of that logic exists in `stonyx-orm`, so it cannot be confirmed by reading this repo alone — flagged here rather than assumed.

## Security audit — `.github/workflows/security-audit.yml`

- **Trigger:** scheduled, daily at 08:00 UTC (`cron: '0 8 * * *'`), plus manual `workflow_dispatch`.
- **Permissions:** `contents: read`.
- **Job:** a single job, `audit`, `uses: abofs/stonyx-workflows/.github/workflows/security-audit.yml@main`. No inputs or secrets are passed from this repo's file. Same caveat as CI: the actual audit steps live in the shared workflow repo, not here.

## `prepublishOnly` — `package.json`

```json
"prepublishOnly": "npm test"
```

`npm test` runs the full chain described in [docs/index.md — Build, Run, Test](index.md#build-run-test) and [testing.md](testing.md): build, the main `test/**/*-test.ts` run, `test:mounted` once per `ORM_TEST_ROUTE` value, then `test:readme`, then `test:reference`. Any failure in that chain — including the README- and reference-sample REST integration tests, which bind local ports and boot a real REST server — blocks `npm publish` from proceeding, for both a human running `npm publish` locally and the `npm-publish.yml` reusable workflow if it shells out to `npm publish` (not verifiable from this repo; see above). This is the only release-gating logic that lives in `stonyx-orm`'s own code rather than in the shared workflow repo.

## Summary of discrepancies / unverifiable items (code's-eye view only)

- The actual publish mechanics (version bump computation, tagging, `npm publish` invocation, provenance/OIDC handling, cascade behavior toward dependent packages) live in `abofs/stonyx-workflows`, not in `stonyx-orm`. This document states the trigger/permission/input surface visible from `stonyx-orm`'s workflow files and stops there; it does not restate the previous file's pointer into `stonyx-workflows/docs/release.md`, because that is a separate repo's documentation and was not re-verified here.
- `publish.yml`'s CI-adjacent trigger on `pull_request` (`opened`/`synchronize`/`reopened`) against `dev`/`main` is easy to misread as "publishes on every PR" — it does not; it only *becomes relevant* for the `publish` job's own gating logic inside the reusable workflow, which this repo's code does not show. Flagging the trigger's existence rather than guessing at its effect.
- `security-audit.yml` runs on a fixed daily cron plus manual dispatch; it is unrelated to the publish pipeline and does not gate it from anything visible in this repo's workflow files.
