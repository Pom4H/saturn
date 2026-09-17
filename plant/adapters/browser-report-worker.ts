import { openBrowserSql } from './browser-sql';
import { executeReport } from '../workflows';
self.onmessage = async (event) => { try {
    const { db } = await openBrowserSql({ memory: true });
    db.exec('PRAGMA hard_heap_limit=67108864');
    self.postMessage({ result: executeReport(event.data, db) });
}
catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
} };
