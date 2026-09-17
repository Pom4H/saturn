import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { SqlDatabase } from '../types';
/** Exactly one worker owns the OPFS database. Opening failure is never a silent empty fallback. */
export async function openBrowserSql(options: {
    memory?: boolean;
} = {}): Promise<{
    db: SqlDatabase;
    persistent: boolean;
}> {
    const sqlite = await (sqlite3InitModule as unknown as (o: object) => ReturnType<typeof sqlite3InitModule>)({ locateFile: () => new URL('./sqlite3.wasm', import.meta.url).href });
    let handle: any;
    if (options.memory)
        handle = new sqlite.oo1.DB(':memory:', 'ct');
    else {
        const pool = await sqlite.installOpfsSAHPoolVfs({ name: 'scada-plant', directory: '/scada-plant-v1', initialCapacity: 6 });
        handle = new pool.OpfsSAHPoolDb('/plant.sqlite3');
    }
    handle.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
    const db: SqlDatabase = {
        exec(sql, bind) { handle.exec({ sql, bind: bind ?? [] }); },
        all<T>(sql: string, bind: unknown[] | Record<string, unknown> = []): T[] { return handle.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' }) as T[]; },
        transaction<T>(fn: () => T): T { handle.exec('BEGIN IMMEDIATE'); try {
            const v = fn();
            if (v instanceof Promise)
                throw new Error('Transaction must be synchronous');
            handle.exec('COMMIT');
            return v;
        }
        catch (error) {
            handle.exec('ROLLBACK');
            throw error;
        } },
        close() { handle.close(); }
    };
    return { db, persistent: !options.memory };
}
