/**
 * Standalone JSON database layer for CLI usage.
 *
 * Reads and writes directly to JSON files without requiring the Stonyx
 * bootstrap, ORM init, or any framework dependencies. Supports both
 * single-file and directory modes.
 */

import fs from 'fs/promises';
import path from 'path';
// `./utils.js` pulls in `@stonyx/utils/string` and nothing else -- no ORM
// bootstrap, no `@stonyx/orm` index, no side effects -- so the "no framework
// dependencies" property above still holds.
import { maxNumericId } from './utils.js';

interface StandaloneDBOptions {
  dbPath?: string;
  mode?: 'file' | 'directory';
  directory?: string;
}

interface DBRecord {
  id: string | number;
  [key: string]: unknown;
}

export default class StandaloneDB {
  readonly mode: 'file' | 'directory';
  readonly dbPath: string;
  readonly directory: string;

  constructor(options: StandaloneDBOptions = {}) {
    this.mode = options.mode || 'directory';
    this.dbPath = options.dbPath || 'db.json';
    this.directory = options.directory || 'db';
  }

  /**
   * Resolve the directory path for directory mode.
   */
  getDirPath(): string {
    const dbDir = path.dirname(path.resolve(this.dbPath));
    return path.join(dbDir, this.directory);
  }

  /**
   * List available collections by inspecting either the db.json keys
   * or the files in the db directory.
   */
  async getCollections(): Promise<string[]> {
    if (this.mode === 'directory') {
      const dirPath = this.getDirPath();

      try {
        const files = await fs.readdir(dirPath);
        return files
          .filter(f => f.endsWith('.json'))
          .map(f => f.replace('.json', ''));
      } catch {
        return [];
      }
    }

    // File mode -- read db.json and return its top-level keys
    try {
      const data = await this._readJSON(this.dbPath) as Record<string, unknown>;
      return Object.keys(data).filter(key => Array.isArray(data[key]));
    } catch {
      return [];
    }
  }

  /**
   * Read all records for a collection.
   */
  async readCollection(collection: string): Promise<DBRecord[]> {
    if (this.mode === 'directory') {
      const filePath = path.join(this.getDirPath(), `${collection}.json`);
      return this._readJSON(filePath) as Promise<DBRecord[]>;
    }

    const data = await this._readJSON(this.dbPath) as Record<string, DBRecord[]>;
    return data[collection] || [];
  }

  /**
   * Write all records for a collection.
   */
  async writeCollection(collection: string, records: DBRecord[]): Promise<void> {
    if (this.mode === 'directory') {
      const dirPath = this.getDirPath();
      await fs.mkdir(dirPath, { recursive: true });

      const filePath = path.join(dirPath, `${collection}.json`);
      await this._writeJSON(filePath, records);
      return;
    }

    // File mode -- read full db, update collection, write back
    let data: Record<string, unknown>;

    try {
      data = await this._readJSON(this.dbPath) as Record<string, unknown>;
    } catch {
      data = {};
    }

    data[collection] = records;
    await this._writeJSON(this.dbPath, data);
  }

  /**
   * Get a single record by id.
   */
  async get(collection: string, id: string | number): Promise<DBRecord | null> {
    const records = await this.readCollection(collection);
    const numericId = Number(id);

    return records.find(r =>
      r.id === id || r.id === numericId
    ) || null;
  }

  /**
   * List all records in a collection.
   */
  async list(collection: string): Promise<DBRecord[]> {
    return this.readCollection(collection);
  }

  /**
   * Create a new record. Auto-assigns an integer id if none provided.
   */
  async create(collection: string, data: DBRecord): Promise<DBRecord> {
    const records = await this.readCollection(collection);

    if (!data.id) {
      // SHARED WITH `assignRecordId` (src/manage-record.ts), which is the other
      // place this repo picks a server-assigned id. It was a second copy of the
      // reduce, and nothing here pointed at it — a maintainer editing this
      // method could not discover the other existed. See `maxNumericId` for why
      // it is not `Math.max` (abofs/stonyx-orm#203).
      //
      // THE TWO ARE NOT THE SAME FUNCTION beyond this line, deliberately.
      // `StandaloneDB` has no model, id-type or transform concept, so `maxId + 1`
      // IS its store key; `assignRecordId` has to map the candidate through the
      // model's declared id transform first, and then walk past occupied keys.
      // Transplanting this method's remaining logic into the ORM reproduces
      // #203's landing-key defect exactly — which is what AC4 pins.
      data.id = maxNumericId(records) + 1;
    }

    // Check for duplicate id
    const existing = records.find(r => r.id === data.id);
    if (existing) {
      throw new Error(`Record with id ${data.id} already exists in '${collection}'`);
    }

    records.push(data);
    await this.writeCollection(collection, records);

    return data;
  }

  /**
   * Delete a record by id.
   */
  async delete(collection: string, id: string | number): Promise<DBRecord> {
    const records = await this.readCollection(collection);
    const numericId = Number(id);

    const index = records.findIndex(r =>
      r.id === id || r.id === numericId
    );

    if (index === -1) {
      throw new Error(`Record with id '${id}' not found in '${collection}'`);
    }

    const [removed] = records.splice(index, 1);
    await this.writeCollection(collection, records);

    return removed;
  }

  // -- Private helpers --

  private async _readJSON(filePath: string): Promise<unknown> {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  }

  private async _writeJSON(filePath: string, data: unknown): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }
}
