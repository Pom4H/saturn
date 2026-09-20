import { executeReport } from '../workflows';
import { BunSql } from './bun-sql';
import type { ReportTask } from '../types';

process.once('message', (task: ReportTask) => {
    let message: { result?: unknown; error?: string };
    try {
        const db = new BunSql();
        db.exec('PRAGMA hard_heap_limit=67108864');
        message = { result: executeReport(task, db) };
    } catch (error) {
        message = { error: error instanceof Error ? error.message : String(error) };
    }
    if (!process.send) process.exit(1);
    process.send(message, () => process.exit(0));
});
