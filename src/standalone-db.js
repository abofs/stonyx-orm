/**
 * Standalone JSON database layer for CLI usage.
 *
 * Reads and writes directly to JSON files without requiring the Stonyx
 * bootstrap, ORM init, or any framework dependencies. Supports both
 * single-file and directory modes.
 */

import fs from 'fs/promises';
import path from 'path';

export default class StandaloneDB {
  /**
   * @param {Object} options
   * @param {string} options.dbPath - Path to db.json (file mode) or parent of db dir (directory mode)
   * @param {string} [options.mode='directory'] - 'file' or 'directory'
   * @param {string} [options.directory='db'] - Directory name when mode is 'directory'
   */
  constructor(options = {}) {
    this.mode = options.mode || 'directory';
    this.dbPath = options.dbPath || 'db.json';
    this.directory = options.directory || 'db';
  }

  /**
   * Resolve the directory path for directory mode.
   */
  getDirPath() {
    const dbDir = path.dirname(path.resolve(this.dbPath));
    return path.join(dbDir, this.directory);
  }

  /**
   * List available collections by inspecting either the db.json keys
   * or the files in the db directory.
   */
  async getCollections() {
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

    // File mode — read db.json and return its top-level keys
    try {
      const data = await this._readJSON(this.dbPath);
      return Object.keys(data).filter(key => Array.isArray(data[key]));
    } catch {
      return [];
    }
  }

  /**
   * Read all records for a collection.
   */
  async readCollection(collection) {
    if (this.mode === 'directory') {
      const filePath = path.join(this.getDirPath(), `${collection}.json`);
      return this._readJSON(filePath);
    }

    const data = await this._readJSON(this.dbPath);
    return data[collection] || [];
  }

  /**
   * Write all records for a collection.
   */
  async writeCollection(collection, records) {
    if (this.mode === 'directory') {
      const dirPath = this.getDirPath();
      await fs.mkdir(dirPath, { recursive: true });

      const filePath = path.join(dirPath, `${collection}.json`);
      await this._writeJSON(filePath, records);
      return;
    }

    // File mode — read full db, update collection, write back
    let data;

    try {
      data = await this._readJSON(this.dbPath);
    } catch {
      data = {};
    }

    data[collection] = records;
    await this._writeJSON(this.dbPath, data);
  }

  /**
   * Get a single record by id.
   */
  async get(collection, id) {
    const records = await this.readCollection(collection);
    const numericId = Number(id);

    return records.find(r =>
      r.id === id || r.id === numericId
    ) || null;
  }

  /**
   * List all records in a collection.
   */
  async list(collection) {
    return this.readCollection(collection);
  }

  /**
   * Create a new record. Auto-assigns an integer id if none provided.
   */
  async create(collection, data) {
    const records = await this.readCollection(collection);

    if (!data.id) {
      const maxId = records.reduce((max, r) => {
        const rid = typeof r.id === 'number' ? r.id : 0;
        return rid > max ? rid : max;
      }, 0);

      data.id = maxId + 1;
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
  async delete(collection, id) {
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

  async _readJSON(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  }

  async _writeJSON(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }
}
