import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SqlDatabase } from '../types';

interface BunStatement {
    run(...bind: unknown[]): unknown;
    all(...bind: unknown[]): unknown[];
}
interface BunDatabase {
    exec(sql: string): unknown;
    query(sql: string): BunStatement;
    close(): void;
}
type BunDatabaseConstructor = new (path?: string, options?: {
    create?: boolean;
    strict?: boolean;
}) => BunDatabase;

const moduleName = 'bun:sqlite';
const { Database } = await import(moduleName) as unknown as { Database: BunDatabaseConstructor };

/** Native Bun SQLite adapter. Keeps the portable Store synchronous and transaction-safe. */
export class BunSql implements SqlDatabase {
    readonly db: BunDatabase;
    private statements = new Map<string, BunStatement>();

    constructor(path = ':memory:') {
        if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
        this.db = new Database(path, { create: true, strict: true });
        this.db.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000;');
        if (path !== ':memory:') this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    }

    private query(sql: string): BunStatement {
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
            this.db.exec(sql);
            return;
        }
        const statement = this.query(sql);
        Array.isArray(bind) ? statement.run(...bind) : statement.run(bind);
    }

    all<T = Record<string, unknown>>(sql: string, bind: unknown[] | Record<string, unknown> = []): T[] {
        const statement = this.query(sql);
        return (Array.isArray(bind) ? statement.all(...bind) : statement.all(bind)) as T[];
    }

    transaction<T>(fn: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = fn();
            if (result instanceof Promise) throw new Error('SQL transaction callback must be synchronous');
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            try { this.db.exec('ROLLBACK'); } catch { /* BEGIN itself may have failed. */ }
            throw error;
        }
    }

    close(): void {
        this.statements.clear();
        this.db.close();
    }
}
