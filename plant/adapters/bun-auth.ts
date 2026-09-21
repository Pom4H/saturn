import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Auth } from './auth';
import type { Store } from '../store';
import { AppError, type Actor } from '../types';

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const marker = 'bun:argon2id';

interface BunPasswordRuntime {
    password: {
        hash(password: string, algorithm?: 'argon2id'): Promise<string>;
        verify(password: string, hash: string, algorithm?: 'argon2id'): Promise<boolean>;
    };
}
const runtime = (() => {
    const value = (globalThis as typeof globalThis & { Bun?: BunPasswordRuntime }).Bun;
    if (!value) throw new Error('Bun authentication requires Bun');
    return value;
})();

/**
 * Bun-native credential adapter.
 * Sessions stay compatible with the portable Auth contract; credentials use Argon2id.
 * Existing scrypt rows are upgraded after the first successful login.
 */
export class BunAuth {
    private readonly sessions: Auth;
    private readonly attempts = new Map<string, { count: number; until: number }>();
    private readonly dummyHash: Promise<string>;

    constructor(readonly store: Store) {
        this.sessions = new Auth(store);
        this.dummyHash = runtime.password.hash(randomBytes(32).toString('base64url'), 'argon2id');
    }

    async seed(id: string, password: string, role: Actor['role'] = 'engineer'): Promise<boolean> {
        if (!/^[A-Za-z0-9_.@-]{1,100}$/.test(id) || password.length < 12)
            throw new AppError('Use a named user and a password of at least 12 characters');
        if (this.store.db.all('SELECT id FROM users WHERE id=?', [id]).length) return false;
        const hash = await runtime.password.hash(password, 'argon2id');
        this.store.db.exec('INSERT INTO users VALUES(?,?,?,?)', [id, role, marker, hash]);
        return true;
    }

    async login(user: string, password: string, remote: string) {
        if (typeof user !== 'string' || typeof password !== 'string' || user.length > 100 || password.length > 1024)
            throw new AppError('Invalid credentials', 401);
        const now = Date.now();
        let attempts = this.attempts.get(remote);
        if (!attempts || attempts.until < now) {
            attempts = { count: 0, until: now + 60_000 };
            if (this.attempts.size > 1024) this.attempts.clear();
            this.attempts.set(remote, attempts);
        }
        if (++attempts.count > 10) throw new AppError('Too many login attempts', 429);

        const row = this.store.db.all<{
            id: string;
            role: Actor['role'];
            salt: string;
            hash: string;
        }>('SELECT * FROM users WHERE id=?', [user])[0];

        let valid = false;
        let legacy = false;
        if (row?.salt === marker) {
            valid = await runtime.password.verify(password, row.hash, 'argon2id');
        } else if (row) {
            const computed = scryptSync(password, row.salt, 32);
            valid = row.hash.length === computed.byteLength * 2
                && timingSafeEqual(computed, Buffer.from(row.hash, 'hex'));
            legacy = valid;
        } else {
            await runtime.password.verify(password, await this.dummyHash, 'argon2id');
        }
        if (!row || !valid) throw new AppError('Invalid credentials', 401);

        attempts.count = 0;
        if (legacy) {
            const upgraded = await runtime.password.hash(password, 'argon2id');
            this.store.db.exec('UPDATE users SET salt=?,hash=? WHERE id=?', [marker, upgraded, row.id]);
        }

        const token = randomBytes(32).toString('base64url');
        const csrf = randomBytes(24).toString('base64url');
        this.store.db.exec('DELETE FROM sessions WHERE expires<?', [now]);
        this.store.db.exec('INSERT INTO sessions VALUES(?,?,?,?)', [tokenHash(token), row.id, csrf, now + 8 * 3_600_000]);
        return { token, csrf, actor: { id: row.id, role: row.role } };
    }

    session(cookie: string | undefined) { return this.sessions.session(cookie); }
    logout(sessionId: string) { return this.sessions.logout(sessionId); }
}
