import Orm from '../main.js';

const db = Orm.db as { record: unknown; save(): Promise<void> };

export default db;
export const data = db.record;
export const saveDB = db.save.bind(db);
