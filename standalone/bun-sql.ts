import { Database } from 'bun:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { SqlDatabase } from '../plant/types';

export class BunSql implements SqlDatabase {
    readonly db: Database;
    private statements = new Map<string, ReturnType<Database['query']>>();

    constructor(path = ':memory:') {
        if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
        this.db = new Database(path, { create: true, strict: true });
        this.db.run('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000;');
        if (path !== ':memory:') this.db.run('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    }

    private query(sql: string) {
        let statement = this.statements.get(sql);
        if (!statement) {
            if (this.statements.size >= 256) this.statements.clear();
            statement = this.db.query(sql);
            this.statements.set(sql, statement);
        }
        return statement;
    }

    exec(sql: string, bind?: unknown[] | Record<string, unknown>): void {
        if (!bind) {
            this.db.run(sql);
            return;
        }
        const statement = this.query(sql);
        if (Array.isArray(bind)) statement.run(...bind);
        else statement.run(bind);
    }

    all<T = Record<string, unknown>>(sql: string, bind: unknown[] | Record<string, unknown> = []): T[] {
        const statement = this.query(sql);
        return (Array.isArray(bind) ? statement.all(...bind) : statement.all(bind)) as T[];
    }

    transaction<T>(fn: () => T): T {
        this.db.run('BEGIN IMMEDIATE');
        try {
            const result = fn();
            if (result instanceof Promise) throw new Error('SQL transaction callback must be synchronous');
            this.db.run('COMMIT');
            return result;
        } catch (error) {
            this.db.run('ROLLBACK');
            throw error;
        }
    }

    close(): void {
        this.db.close();
    }
}
