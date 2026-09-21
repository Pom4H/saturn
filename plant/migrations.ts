import initial from './migrations/001_runtime.sql?raw';
import type { SqlDatabase } from './types';

const MIGRATIONS = [initial] as const;

export function migrate(db: SqlDatabase): void {
  const row = db.all<{ user_version: number }>('PRAGMA user_version')[0];
  let version = Number(row?.user_version ?? 0);
  if (!Number.isInteger(version) || version < 0 || version > MIGRATIONS.length) {
    throw new Error(`Unsupported Saturn database schema version: ${version}`);
  }
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    db.transaction(() => db.exec(sql));
    version++;
  }
}
