/**
 * TODO:
 * 
 * ORM DB usage assumes that 100% of the data is ORM driven
 * With that assumption, we can safely do the following
 * - On save: Remove computed properties (getters) from data set
 * - On load: Compute computed properties from data set
 *   - Error handling: Warn of non-ORM properties found in data (but load them)
 *   - Optional configuration flag to disable these warnings
 */
import Cron from '@stonyx/cron';
import config from 'stonyx/config';
import log from 'stonyx/log';
import { createFile, updateFile, readFile } from '@stonyx/utils/file';
import { deepCopy } from '@stonyx/utils/object';

export default class DB {
  constructor() {
    if (DB.instance) return DB.instance;
    
    DB.instance = this;
  }

  async init() {
    await this.retrieve();

    const { autosave, saveInterval } = config.orm.db;

    if (autosave !== 'true') return;

    new Cron().register('save', this.save.bind(this), saveInterval);
  }

  async create() {
    const { rootPath } = config;
    const { file, schema } = config.orm.db;

    if (!file) throw new Error('Configuration Error: ORM DB file path must be defined.');

    let dbSchema;

    try {
      dbSchema = (await import(`${rootPath}/${schema}`)).default;
    } catch (error) {
      throw new Error('Configuration Error: ORM DB schema must be defined.');
    }

    const data = deepCopy(dbSchema);
    
    createFile(`${rootPath}/${file}`, data, { json: true });

    return data;
  }
  
  async save() {
    const { file } = config.orm.db;

    await updateFile(`${config.rootPath}/${file}`, this.data, { json: true });

    log.db(`DB has been successfully saved to ${file}`);
  }

  async retrieve() {
    const { file } = config.orm.db;

    this.data = await readFile(file, { json: true, missingFileCallback: this.create.bind(this) });
  }
}
