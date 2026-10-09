import * as SQLite from 'expo-sqlite';
import { createResearchStore, type ResearchStore } from './calibrationStoreCore';
let pending: Promise<ResearchStore> | undefined;
export function getResearchStore(): Promise<ResearchStore> {
  if (!pending) {
    pending = (async () => {
      const db = await SQLite.openDatabaseAsync('cdd-research-calibration-v1.db');
      const store = createResearchStore({
        execAsync: sql => db.execAsync(sql),
        runAsync: (sql, params) => db.runAsync(sql, params),
        getAllAsync: (sql, params) => db.getAllAsync<{[key: string]: string | null}>(sql, params),
      });
      await store.init();
      return store;
    })().catch(error => { pending = undefined; throw error; });
  }
  return pending;
}
