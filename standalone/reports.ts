import type { ReportArtifact, ReportTask } from '../plant/types';
import { executeReport } from '../plant/workflows';
import { BunSql } from './bun-sql';

export async function runStandaloneReport(task: ReportTask): Promise<ReportArtifact> {
    const db = new BunSql();
    try {
        db.exec('PRAGMA hard_heap_limit=67108864');
        return executeReport(task, db);
    } finally {
        db.close();
    }
}
