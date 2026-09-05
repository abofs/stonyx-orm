#!/bin/bash
#
# stonyx-orm#280 — consumer-tarball harness.
#
# Builds throwaway consumer projects against a PACKED tarball (not the repo) and
# installs them with a plain default `pnpm install`, which is the state that
# exposes the defect: `@stonyx/rest-server` is an OPTIONAL peer, so a default
# install does not put it on disk.
#
# This is a manual harness, not part of `pnpm test`: it runs `pnpm install`
# against the network and binds a TCP port. It is committed because it is the
# only evidence for #280's acceptance criteria, and evidence that lives in a
# scratch directory is not evidence.
#
#   Usage: test/manual/orm280-consumer-harness.sh <tarball> <label>
#
#   # RED  (pre-fix)
#   git checkout dev && pnpm build
#   npm pack --ignore-scripts --pack-destination /tmp/red
#   test/manual/orm280-consumer-harness.sh /tmp/red/stonyx-orm-*.tgz RED
#
#   # GREEN (this branch)
#   pnpm build && npm pack --ignore-scripts --pack-destination /tmp/green
#   test/manual/orm280-consumer-harness.sh /tmp/green/stonyx-orm-*.tgz GREEN
#
# Env:
#   ORM280_PORT  port scenario C binds (default 2917). NEVER 2666 — that is a
#                live daemon on the dev machines this runs on.
#
# Scenarios
#   A  bare `import('@stonyx/orm')`, plain install          -> link-time resolution
#   B  ORM-only app, restServer.enabled: 'false'            -> the config the fix was first tested against
#   C  REST app, @stonyx/rest-server installed, enabled     -> control: the supported REST path still works
#   D  README-VERBATIM ORM-only app                         -> config/environment.js extracted byte-for-byte
#                                                              from README.md's usage example. This is the
#                                                              acceptance criterion: a consumer who follows
#                                                              the shipped docs must get a working app.
set -u

TARBALL="${1:?usage: orm280-consumer-harness.sh <tarball> <label>}"
LABEL="${2:?usage: orm280-consumer-harness.sh <tarball> <label>}"
PORT="${ORM280_PORT:-2917}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"

# Pin one `stonyx` for every consumer. Without this, @stonyx/rest-server pulls
# its own stonyx alongside the ORM's, giving two uninitialised Stonyx singletons
# and a spurious "Stonyx has not been initialized yet" in scenario C.
STONYX_VERSION="$(node -p "require('$REPO_ROOT/package.json').dependencies.stonyx")"
RESTSERVER_VERSION="$(node -p "require('$REPO_ROOT/package.json').devDependencies['@stonyx/rest-server']")"

ROOT=$(mktemp -d "/tmp/orm280-$LABEL.XXXXXX")

# The README scenario D reads is the one INSIDE THE TARBALL, not the working
# copy — "follow the shipped docs" is only meaningful about the shipped bytes.
README="$ROOT/README-shipped.md"
tar -xzOf "$TARBALL" package/README.md > "$README" || { echo "FATAL: no README.md in $TARBALL"; exit 1; }

echo "### HARNESS [$LABEL]  root=$ROOT"
echo "### tarball=$TARBALL  stonyx=$STONYX_VERSION  rest-server=$RESTSERVER_VERSION  port=$PORT"

# --- shared consumer fixtures -----------------------------------------------
write_app_fixtures() {
  mkdir -p models access
  cat > models/widget.js <<'EOF'
import { Model, attr } from '@stonyx/orm';
export default class WidgetModel extends Model {
  name = attr('string');
}
EOF
  cat > config/db-schema.js <<'EOF'
import { Model, hasMany } from '@stonyx/orm';
export default class DBModel extends Model {
  widgets = hasMany('widget');
}
EOF
  echo '{}' > db.json
}

write_boot_app() {
  cat > app.mjs <<'EOF'
import { pathToFileURL } from 'url';
const cwd = process.cwd();
try {
  const { default: Stonyx } = await import('stonyx');
  const { default: config } = await import(pathToFileURL(`${cwd}/config/environment.js`).href);
  new Stonyx(config, cwd);
  await Stonyx.ready;
  const { default: Orm } = await import('@stonyx/orm');
  console.log('RESULT: ORM-ONLY APP BOOTED   Orm.initialized=' + Orm.initialized
    + '  models=' + JSON.stringify(Object.keys(Orm.instance.models)));
} catch (e) {
  console.log('RESULT: ORM-ONLY APP FAILED  code=' + e.code);
  console.log('  ' + String(e.message).split('\n')[0]);
}
process.exit(0);
EOF
}

########## SCENARIO A: bare `import('@stonyx/orm')`, plain default install ##########
A="$ROOT/A-bare"; mkdir -p "$A"; cd "$A" || exit 1
cat > package.json <<EOF
{ "name": "orm-only-bare", "version": "1.0.0", "private": true, "type": "module",
  "dependencies": { "@stonyx/orm": "file:$TARBALL" },
  "pnpm": { "overrides": { "stonyx": "$STONYX_VERSION" } } }
EOF
cat > boot.mjs <<'EOF'
try { await import('@stonyx/orm'); console.log('RESULT: IMPORT OK'); }
catch (e) { console.log('RESULT: IMPORT FAILED  code=' + e.code); console.log('  ' + String(e.message).split('\n')[0]); }
EOF
pnpm install --silent >/dev/null 2>&1
echo ""
echo "--- [A] plain default pnpm install; installed @stonyx packages: $(ls node_modules/@stonyx/ | tr '\n' ' ')"
echo "--- [A] node boot.mjs   (AC1: import('@stonyx/orm') resolution)"
node boot.mjs 2>&1

########## SCENARIO B: ORM-only app, restServer explicitly disabled ##########
B="$ROOT/B-app"; mkdir -p "$B/config"; cd "$B" || exit 1
cat > package.json <<EOF
{ "name": "orm-only-app", "version": "1.0.0", "private": true, "type": "module",
  "dependencies": { "stonyx": "$STONYX_VERSION" },
  "devDependencies": { "@stonyx/orm": "file:$TARBALL" },
  "pnpm": { "overrides": { "stonyx": "$STONYX_VERSION" } } }
EOF
cat > config/environment.js <<'EOF'
export default {
  orm: {
    db: { file: './db.json', autosave: 'false' },
    paths: { model: './models', serializer: './serializers', transform: './transforms', view: './views', access: './access' },
    restServer: { enabled: 'false' }
  }
};
EOF
write_app_fixtures
write_boot_app
pnpm install --silent >/dev/null 2>&1
echo ""
echo "--- [B] plain default pnpm install; installed @stonyx packages: $(ls node_modules/@stonyx/ | tr '\n' ' ')"
echo "--- [B] node app.mjs   (ORM-only consumer boots with restServer.enabled='false')"
node app.mjs 2>&1 | grep -v "^$"

########## SCENARIO D: README-VERBATIM ORM-only app ##########
# config/environment.js is EXTRACTED from the TARBALL's README.md rather than
# written here, so what is measured is the bytes a reader copies out of the
# published package, not a paraphrase of them.
D="$ROOT/D-readme"; mkdir -p "$D/config"; cd "$D" || exit 1
node -e '
  const fs = require("fs");
  const lines = fs.readFileSync(process.argv[1], "utf8").split("\n");
  const fences = lines.map((l, i) => [l, i]).filter(([l]) => /^\s*```/.test(l)).map(([, i]) => i);
  let block = null;
  for (let i = 0; i + 1 < fences.length; i += 2) {
    const body = lines.slice(fences[i] + 1, fences[i + 1]);
    if (body.some(l => l.includes("ORM_USE_REST_SERVER")) && body.some(l => l.includes("export default"))) {
      block = body.join("\n") + "\n";
      break;
    }
  }
  if (!block) { console.error("FATAL: no README config block naming ORM_USE_REST_SERVER"); process.exit(1); }
  fs.writeFileSync(process.argv[2], block);
' "$README" "$D/config/environment.js" || exit 1
cat > package.json <<EOF
{ "name": "orm-readme-app", "version": "1.0.0", "private": true, "type": "module",
  "dependencies": { "stonyx": "$STONYX_VERSION" },
  "devDependencies": { "@stonyx/orm": "file:$TARBALL" },
  "pnpm": { "overrides": { "stonyx": "$STONYX_VERSION" } } }
EOF
write_app_fixtures
write_boot_app
pnpm install --silent >/dev/null 2>&1
echo ""
echo "--- [D] config/environment.js extracted VERBATIM from the tarball's README.md ($(wc -l < config/environment.js | tr -d ' ') lines, sha256 $(shasum -a 256 config/environment.js | cut -c1-16))"
echo "--- [D] its restServer block, and no ORM_* env var is set:"
grep -A 4 'restServer: {' config/environment.js | sed 's/^/      /'
echo "--- [D] plain default pnpm install; installed @stonyx packages: $(ls node_modules/@stonyx/ | tr '\n' ' ')"
echo "--- [D] node app.mjs   (ACCEPTANCE: a consumer who follows the shipped README gets a working ORM-only app)"
node app.mjs 2>&1 | grep -v "^$"

########## SCENARIO C: rest-server INSTALLED + restServer.enabled='true' ##########
C="$ROOT/C-rest"; mkdir -p "$C/config" "$C/requests"; cd "$C" || exit 1
cat > package.json <<EOF
{ "name": "orm-rest-app", "version": "1.0.0", "private": true, "type": "module",
  "dependencies": { "stonyx": "$STONYX_VERSION" },
  "devDependencies": { "@stonyx/orm": "file:$TARBALL", "@stonyx/rest-server": "$RESTSERVER_VERSION" },
  "pnpm": { "overrides": { "stonyx": "$STONYX_VERSION" } } }
EOF
cat > config/environment.js <<EOF
export default {
  orm: {
    db: { file: './db.json', autosave: 'false' },
    paths: { model: './models', serializer: './serializers', transform: './transforms', view: './views', access: './access' },
    restServer: { enabled: 'true', route: '/api' }
  },
  restServer: { dir: './requests', port: $PORT }
};
EOF
write_app_fixtures
cat > access/public.js <<'EOF'
export default class PublicAccess {
  models = '*';
  access() { return true; }
}
EOF
cat > app.mjs <<EOF
import { pathToFileURL } from 'url';
const cwd = process.cwd();
try {
  const { default: Stonyx } = await import('stonyx');
  const { default: config } = await import(pathToFileURL(\`\${cwd}/config/environment.js\`).href);
  new Stonyx(config, cwd);
  await Stonyx.ready;
  const { createRecord } = await import('@stonyx/orm');
  createRecord('widget', { id: '1', name: 'anvil' });
  const res = await fetch('http://localhost:$PORT/api/widgets');
  const body = await res.text();
  console.log('RESULT: REST PATH OK   status=' + res.status);
  console.log('  GET /api/widgets -> ' + body.slice(0, 200));
} catch (e) {
  console.log('RESULT: REST PATH FAILED  code=' + e.code);
  console.log('  ' + String(e.message).split('\n')[0]);
}
process.exit(0);
EOF
pnpm install --silent >/dev/null 2>&1
echo ""
echo "--- [C] pnpm install WITH @stonyx/rest-server; installed @stonyx packages: $(ls node_modules/@stonyx/ | tr '\n' ' ')"
echo "--- [C] node app.mjs   (control: the REST path still works when the peer IS installed and enabled='true')"
node app.mjs 2>&1 | grep -viE "^\s*$"
