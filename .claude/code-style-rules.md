# Stonyx Code Style Rules

Strict prettier/eslint rules to apply across all Stonyx projects. These will be formalized into an ESLint/Prettier config once enough patterns are collected.

---

## Rules

### 1. Destructure config objects in function signatures

When a function receives a config/options object and only uses specific properties, destructure them in the function signature rather than accessing them via dot notation in the body.

**Bad:**
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

**Good:**
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

**Source:** PR #14, `src/mysql/connection.js`
**ESLint rule (candidate):** `prefer-destructuring` (with custom config for function parameters)
