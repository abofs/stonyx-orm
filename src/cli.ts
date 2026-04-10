#!/usr/bin/env node

/**
 * Standalone CLI for ORM database operations.
 *
 * Performs CRUD operations on the JSON database without requiring
 * the full Stonyx bootstrap. Supports both file and directory modes.
 *
 * Usage:
 *   stonyx-orm create <collection> <json-data>
 *   stonyx-orm list <collection>
 *   stonyx-orm get <collection> <id>
 *   stonyx-orm delete <collection> <id>
 *
 * Configuration (environment variables):
 *   DB_MODE      -- 'file' or 'directory' (default: 'directory')
 *   DB_PATH      -- Path to db.json (default: 'db.json')
 *   DB_DIRECTORY  -- Directory name for collection files (default: 'db')
 *
 * Configuration (CLI flag):
 *   --config <path>  -- Path to a JSON config file with { mode, dbPath, directory }
 */

import StandaloneDB from './standalone-db.js';
import fs from 'fs/promises';

interface CLIConfig {
  mode: 'file' | 'directory';
  dbPath: string;
  directory: string;
}

const USAGE = `Usage: stonyx-orm <command> [options]

Commands:
  create <collection> <json-data>   Create a record
  list   <collection>               List all records
  get    <collection> <id>          Get a record by ID
  delete <collection> <id>          Delete a record by ID

Options:
  --config <path>   Path to JSON config file
  --help            Show this help message

Environment variables:
  DB_MODE       'file' or 'directory' (default: 'directory')
  DB_PATH       Path to db.json (default: 'db.json')
  DB_DIRECTORY  Directory name for collection files (default: 'db')`;

async function loadConfig(args: string[]): Promise<CLIConfig> {
  const config: Record<string, string> = {};

  // Check for --config flag
  const configIndex = args.indexOf('--config');

  if (configIndex !== -1 && args[configIndex + 1]) {
    const configPath = args[configIndex + 1];

    try {
      const content = await fs.readFile(configPath, 'utf-8');
      Object.assign(config, JSON.parse(content));
    } catch (err) {
      console.error(`Error reading config file '${configPath}': ${(err as Error).message}`);
      process.exit(1);
    }

    // Remove --config and its value from args
    args.splice(configIndex, 2);
  }

  // Environment variables override config file, config file overrides defaults
  return {
    mode: (process.env.DB_MODE || config.mode || 'directory') as 'file' | 'directory',
    dbPath: process.env.DB_PATH || config.dbPath || 'db.json',
    directory: process.env.DB_DIRECTORY || config.directory || 'db',
  };
}

function parseArgs(argv: string[]): string[] {
  // Strip node binary and script path
  const args = argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(USAGE);
    process.exit(0);
  }

  return args;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv);
  const config = await loadConfig(args);
  const db = new StandaloneDB(config);

  const [command, collection, ...rest] = args;

  if (!command) {
    console.error('Error: No command specified.\n');
    console.log(USAGE);
    process.exit(1);
  }

  if (!collection && command !== '--help') {
    console.error(`Error: No collection specified for '${command}' command.\n`);
    console.log(USAGE);
    process.exit(1);
  }

  try {
    switch (command) {
      case 'list': {
        const records = await db.list(collection);
        console.log(JSON.stringify(records, null, 2));
        break;
      }

      case 'get': {
        const id = rest[0];

        if (!id) {
          console.error("Error: 'get' command requires an <id> argument.");
          process.exit(1);
        }

        const record = await db.get(collection, id);

        if (!record) {
          console.error(`Record with id '${id}' not found in '${collection}'.`);
          process.exit(1);
        }

        console.log(JSON.stringify(record, null, 2));
        break;
      }

      case 'create': {
        const jsonStr = rest.join(' ');

        if (!jsonStr) {
          console.error("Error: 'create' command requires <json-data> argument.");
          process.exit(1);
        }

        let data;

        try {
          data = JSON.parse(jsonStr);
        } catch {
          console.error(`Error: Invalid JSON data: ${jsonStr}`);
          process.exit(1);
        }

        const created = await db.create(collection, data);
        console.log(JSON.stringify(created, null, 2));
        break;
      }

      case 'delete': {
        const deleteId = rest[0];

        if (!deleteId) {
          console.error("Error: 'delete' command requires an <id> argument.");
          process.exit(1);
        }

        const removed = await db.delete(collection, deleteId);
        console.log(JSON.stringify(removed, null, 2));
        break;
      }

      default:
        console.error(`Error: Unknown command '${command}'.\n`);
        console.log(USAGE);
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

run();
