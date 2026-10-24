# Code Style

Conventions for this repo's source. None of them is enforced by tooling yet: the repo has no ESLint or Prettier config, so a reviewer applies them by hand.

## Destructure config objects in function signatures

When a function receives a config or options object and only uses specific properties, destructure them in the signature rather than reading them with dot notation in the body.

**Avoid:**

```javascript
export async function getPool(mysqlConfig) {
  pool = mysql.createPool({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    database: mysqlConfig.database,
    connectionLimit: mysqlConfig.connectionLimit,
    // ...
  });
}
```

**Prefer:**

```javascript
export async function getPool({ host, port, user, password, database, connectionLimit }) {
  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    connectionLimit,
    // ...
  });
}
```

Current state of the source: `getPool` in `src/postgres/connection.ts` destructures in the body, which avoids the dot reads but is not the signature form. `getPool` in `src/mysql/connection.ts` is still written the "avoid" way shown above.
