import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SqlDatabase } from '../types';
export class NodeSql implements SqlDatabase {
    readonly db: DatabaseSync;
    private statements = new Map<string, ReturnType<DatabaseSync['prepare']>>();
    private query(sql: string) { let q = this.statements.get(sql); if (!q) {
        if (this.statements.size >= 256)
            this.statements.clear();
        q = this.db.prepare(sql);
        this.statements.set(sql, q);
    } return q; }
    constructor(path = ':memory:') { if (path !== ':memory:')
        mkdirSync(dirname(path), { recursive: true }); this.db = new DatabaseSync(path); this.db.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000;'); if (path !== ':memory:')
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;'); }
    exec(sql: string, bind?: unknown[] | Record<string, unknown>): void { if (bind) {
        const q = this.query(sql);
        Array.isArray(bind) ? q.run(...bind as any[]) : q.run(bind as any);
    }
    else
        this.db.exec(sql); }
    all<T = Record<string, unknown>>(sql: string, bind: unknown[] | Record<string, unknown> = []): T[] { const q = this.query(sql); return (Array.isArray(bind) ? q.all(...bind as any[]) : q.all(bind as any)) as T[]; }
    transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try {
        const result = fn();
        if (result instanceof Promise)
            throw new Error('SQL transaction callback must be synchronous');
        this.db.exec('COMMIT');
        return result;
    }
    catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
    } }
    close() { this.db.close(); }
}
