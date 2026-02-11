import { fileToDirectory, directoryToFile } from './migrate.js';

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
    description: 'Generate a MySQL migration from current model schemas',
    bootstrap: true,
    run: async (args) => {
      const description = args.join(' ') || 'migration';
      const { generateMigration } = await import('./mysql/migration-generator.js');
      const result = await generateMigration(description);

      if (result) {
        console.log(`Migration created: ${result.filename}`);
      } else {
        console.log('No schema changes detected. No migration generated.');
      }
    }
  },
  'db:migrate': {
    description: 'Apply pending MySQL migrations',
    bootstrap: true,
    run: async () => {
      const config = (await import('stonyx/config')).default;
      const mysqlConfig = config.orm.mysql;

      if (!mysqlConfig) {
        console.error('MySQL is not configured. Set MYSQL_HOST to enable MySQL mode.');
        process.exit(1);
      }

      const { getPool, closePool } = await import('./mysql/connection.js');
      const { ensureMigrationsTable, getAppliedMigrations, getMigrationFiles, applyMigration, parseMigrationFile } = await import('./mysql/migration-runner.js');
      const { readFile } = await import('@stonyx/utils/file');
      const path = await import('path');

      const pool = await getPool(mysqlConfig);
      const migrationsPath = path.resolve(config.rootPath, mysqlConfig.migrationsDir);

      try {
        await ensureMigrationsTable(pool, mysqlConfig.migrationsTable);

        const applied = await getAppliedMigrations(pool, mysqlConfig.migrationsTable);
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

          await applyMigration(pool, filename, up, mysqlConfig.migrationsTable);
          console.log(`  Applied: ${filename}`);
        }

        console.log('All migrations applied.');
      } finally {
        await closePool();
      }
    }
  },
  'db:migrate:rollback': {
    description: 'Rollback the most recent MySQL migration',
    bootstrap: true,
    run: async () => {
      const config = (await import('stonyx/config')).default;
      const mysqlConfig = config.orm.mysql;

      if (!mysqlConfig) {
        console.error('MySQL is not configured. Set MYSQL_HOST to enable MySQL mode.');
        process.exit(1);
      }

      const { getPool, closePool } = await import('./mysql/connection.js');
      const { ensureMigrationsTable, getAppliedMigrations, rollbackMigration, parseMigrationFile } = await import('./mysql/migration-runner.js');
      const { readFile } = await import('@stonyx/utils/file');
      const path = await import('path');

      const pool = await getPool(mysqlConfig);
      const migrationsPath = path.resolve(config.rootPath, mysqlConfig.migrationsDir);

      try {
        await ensureMigrationsTable(pool, mysqlConfig.migrationsTable);

        const applied = await getAppliedMigrations(pool, mysqlConfig.migrationsTable);

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

        await rollbackMigration(pool, lastFilename, down, mysqlConfig.migrationsTable);
        console.log(`Rolled back: ${lastFilename}`);
      } finally {
        await closePool();
      }
    }
  },
  'db:migrate:status': {
    description: 'Show status of MySQL migrations',
    bootstrap: true,
    run: async () => {
      const config = (await import('stonyx/config')).default;
      const mysqlConfig = config.orm.mysql;

      if (!mysqlConfig) {
        console.error('MySQL is not configured. Set MYSQL_HOST to enable MySQL mode.');
        process.exit(1);
      }

      const { getPool, closePool } = await import('./mysql/connection.js');
      const { ensureMigrationsTable, getAppliedMigrations, getMigrationFiles } = await import('./mysql/migration-runner.js');
      const path = await import('path');

      const pool = await getPool(mysqlConfig);
      const migrationsPath = path.resolve(config.rootPath, mysqlConfig.migrationsDir);

      try {
        await ensureMigrationsTable(pool, mysqlConfig.migrationsTable);

        const applied = new Set(await getAppliedMigrations(pool, mysqlConfig.migrationsTable));
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
