import { fileToDirectory, directoryToFile } from './migrate.js';

function getAdapterConfig(config) {
  if (config.orm.postgres) return { type: 'postgres', config: config.orm.postgres };
  if (config.orm.mysql) return { type: 'mysql', config: config.orm.mysql };
  return null;
}

function getAdapterImports(type) {
  if (type === 'postgres') return {
    connection: () => import('./postgres/connection.js'),
    runner: () => import('./postgres/migration-runner.js'),
    generator: () => import('./postgres/migration-generator.js'),
  };
  return {
    connection: () => import('./mysql/connection.js'),
    runner: () => import('./mysql/migration-runner.js'),
    generator: () => import('./mysql/migration-generator.js'),
  };
}

export default {
  'db:migrate-to-directory': {
    description: 'Migrate DB from single file to directory mode',
    bootstrap: true,
    run: async () => {
      await fileToDirectory();
      console.log('DB migration to directory mode complete.');
    }
  },
  'db:migrate-to-file': {
    description: 'Migrate DB from directory mode to single file',
    bootstrap: true,
    run: async () => {
      await directoryToFile();
      console.log('DB migration to file mode complete.');
    }
  },
  'db:generate-migration': {
    description: 'Generate a database migration from current model schemas',
    bootstrap: true,
    run: async (args) => {
      const description = args.join(' ') || 'migration';
      const config = (await import('stonyx/config')).default;
      const adapter = getAdapterConfig(config);

      if (!adapter) {
        console.error('No SQL database configured. Set PG_HOST or MYSQL_HOST in your environment.');
        process.exit(1);
      }

      const imports = getAdapterImports(adapter.type);
      const { generateMigration } = await imports.generator();
      const result = await generateMigration(description);

      if (result) {
        console.log(`Migration created: ${result.filename}`);
      } else {
        console.log('No schema changes detected. No migration generated.');
      }
    }
  },
  'db:migrate': {
    description: 'Apply pending database migrations',
    bootstrap: true,
    run: async () => {
      const config = (await import('stonyx/config')).default;
      const adapter = getAdapterConfig(config);

      if (!adapter) {
        console.error('No SQL database configured. Set PG_HOST or MYSQL_HOST in your environment.');
        process.exit(1);
      }

      const { type, config: adapterConfig } = adapter;
      const imports = getAdapterImports(type);

      const { getPool, closePool } = await imports.connection();
      const { ensureMigrationsTable, getAppliedMigrations, getMigrationFiles, applyMigration, parseMigrationFile } = await imports.runner();
      const { readFile } = await import('@stonyx/utils/file');
      const path = await import('path');

      const pool = await getPool(adapterConfig);
      const migrationsPath = path.resolve(config.rootPath, adapterConfig.migrationsDir);

      try {
        await ensureMigrationsTable(pool, adapterConfig.migrationsTable);

        const applied = await getAppliedMigrations(pool, adapterConfig.migrationsTable);
        const files = await getMigrationFiles(migrationsPath);
        const pending = files.filter(f => !applied.includes(f));

        if (pending.length === 0) {
          console.log('No pending migrations.');
          return;
        }

        console.log(`Applying ${pending.length} migration(s)...`);

        for (const filename of pending) {
          const content = await readFile(path.join(migrationsPath, filename));
          const { up } = parseMigrationFile(content);

          await applyMigration(pool, filename, up, adapterConfig.migrationsTable);
          console.log(`  Applied: ${filename}`);
        }

        console.log('All migrations applied.');
      } finally {
        await closePool();
      }
    }
  },
  'db:migrate:rollback': {
    description: 'Rollback the most recent database migration',
    bootstrap: true,
    run: async () => {
      const config = (await import('stonyx/config')).default;
      const adapter = getAdapterConfig(config);

      if (!adapter) {
        console.error('No SQL database configured. Set PG_HOST or MYSQL_HOST in your environment.');
        process.exit(1);
      }

      const { type, config: adapterConfig } = adapter;
      const imports = getAdapterImports(type);

      const { getPool, closePool } = await imports.connection();
      const { ensureMigrationsTable, getAppliedMigrations, rollbackMigration, parseMigrationFile } = await imports.runner();
      const { readFile } = await import('@stonyx/utils/file');
      const path = await import('path');

      const pool = await getPool(adapterConfig);
      const migrationsPath = path.resolve(config.rootPath, adapterConfig.migrationsDir);

      try {
        await ensureMigrationsTable(pool, adapterConfig.migrationsTable);

        const applied = await getAppliedMigrations(pool, adapterConfig.migrationsTable);

        if (applied.length === 0) {
          console.log('No migrations to rollback.');
          return;
        }

        const lastFilename = applied[applied.length - 1];
        const content = await readFile(path.join(migrationsPath, lastFilename));
        const { down } = parseMigrationFile(content);

        if (!down) {
          console.error(`No DOWN section found in ${lastFilename}. Cannot rollback.`);
          process.exit(1);
        }

        await rollbackMigration(pool, lastFilename, down, adapterConfig.migrationsTable);
        console.log(`Rolled back: ${lastFilename}`);
      } finally {
        await closePool();
      }
    }
  },
  'db:migrate:status': {
    description: 'Show status of database migrations',
    bootstrap: true,
    run: async () => {
      const config = (await import('stonyx/config')).default;
      const adapter = getAdapterConfig(config);

      if (!adapter) {
        console.error('No SQL database configured. Set PG_HOST or MYSQL_HOST in your environment.');
        process.exit(1);
      }

      const { type, config: adapterConfig } = adapter;
      const imports = getAdapterImports(type);

      const { getPool, closePool } = await imports.connection();
      const { ensureMigrationsTable, getAppliedMigrations, getMigrationFiles } = await imports.runner();
      const path = await import('path');

      const pool = await getPool(adapterConfig);
      const migrationsPath = path.resolve(config.rootPath, adapterConfig.migrationsDir);

      try {
        await ensureMigrationsTable(pool, adapterConfig.migrationsTable);

        const applied = new Set(await getAppliedMigrations(pool, adapterConfig.migrationsTable));
        const files = await getMigrationFiles(migrationsPath);

        if (files.length === 0) {
          console.log('No migration files found.');
          return;
        }

        console.log('Migration status:');

        for (const filename of files) {
          const status = applied.has(filename) ? 'applied' : 'pending';
          console.log(`  [${status}] ${filename}`);
        }
      } finally {
        await closePool();
      }
    }
  },
};
