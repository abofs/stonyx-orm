import Orm from '@stonyx/orm';

const { db } = Orm;

export default db;
export const data = db.record;
export const saveDB = db.save.bind(db);