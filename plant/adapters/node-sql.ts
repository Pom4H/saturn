import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SqlDatabase } from '../types';
import { failCode } from '../diagnostics';
type SqlValue = null | number | bigint | string | Uint8Array;
const sqlValue = (value: unknown): SqlValue => {
    if (value === null || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string' || value instanceof Uint8Array) return value;
    failCode('SATURN_STORAGE_INVALID',{reason:'invalid'},{field:'sql.bind',valueType:typeof value});
};
const sqlObject = (value: Record<string, unknown>): Record<string, SqlValue> => Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sqlValue(item)]));
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
        Array.isArray(bind) ? q.run(...bind.map(sqlValue)) : q.run(sqlObject(bind));
    }
    else
        this.db.exec(sql); }
    all<T = Record<string, unknown>>(sql: string, bind: unknown[] | Record<string, unknown> = []): T[] { const q = this.query(sql); return (Array.isArray(bind) ? q.all(...bind.map(sqlValue)) : q.all(sqlObject(bind))) as T[]; }
    transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try {
        const result = fn();
        if (result instanceof Promise)
            failCode('SATURN_STORAGE_INVALID',{reason:'invalid'},{field:'transaction.async'});
        this.db.exec('COMMIT');
        return result;
    }
    catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
    } }
    close() { this.db.close(); }
}
