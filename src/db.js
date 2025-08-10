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
      dbSchema = {};
      log.db('Unable to load DB schema from file, using empty schema instead');
    }

    const data = deepCopy(dbSchema);
    
    createFile(`${rootPath}/${file}`, data, { json: true });

    return data;
  }
  
  async save() {
    const { file } = config.orm.db;

    await updateFile(file, this.data, { json: true });

    log.db(`DB has been successfully saved to ${file}`);
  }

  async retrieve() {
    const { file } = config.orm.db;

    this.data = await readFile(file, { json: true, missingFileCallback: this.create.bind(this) });
  }

  /** TODO: We need ORM specific reload logic that replaces models attributes when loading from DB */
  // _tempORMSerializeMeta(data) {
  //   const { meta } = data;

  //   // HACK: Create map to ensure we have no duplicate references
  //   // This will no longer be necessary once once gatherer method prevents duplicates
  //   const referenceIds = {};
  //   const { shipmentReportReferences } = meta;

  //   // Fix reference dates & remove duplicates
  //   for (let i = shipmentReportReferences.length - 1; i >= 0; i--) {
  //     const record = shipmentReportReferences[i];

  //     if (!referenceIds[record.id]) {
  //       referenceIds[record.id] = record;
  //     } else {
  //       shipmentReportReferences.splice(i, 1);
  //     }

  //     if (!record.date) continue;

  //     record.date = new Date(record.date);
  //   }

  //   // Re-compute
  //   const metaModel = new MODELS.MetaModel();

  //   // Serialize computed properties
  //   for (const [key, method] of getComputedProperties(metaModel)) {
  //      const value = method.bind(meta)();
      
  //      meta[key] = value;
  //   }

  //   return data;
  // }
}
