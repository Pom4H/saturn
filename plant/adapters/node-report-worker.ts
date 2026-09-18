import { executeReport } from '../workflows';
import { NodeSql } from './node-sql';
import type { ReportTask } from '../types';
process.once('message', (task: ReportTask) => {
    let result;
    try {
        const db = new NodeSql();
        db.exec('PRAGMA hard_heap_limit=67108864');
        result = { result: executeReport(task, db) };
    } catch (error) {
        result = { error: error instanceof Error ? error.message : String(error) };
    }
    process.send!(result, () => process.exit(0));
});
