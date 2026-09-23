import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { Store } from '../store';
import type { Actor } from '../types';
import { failCode } from '../diagnostics';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export class Auth {
    private attempts = new Map<string, {
        count: number;
        until: number;
    }>();
    constructor(readonly store: Store) {}
    seed(id: string, password: string, role: Actor['role'] = 'engineer') { if (!/^[A-Za-z0-9_.@-]{1,100}$/.test(id) || password.length < 12)
        failCode('SATURN_VALUE_INVALID',{field:'credentials',reason:'invalid'},{user:id,minPasswordLength:12}); if (this.store.db.all('SELECT id FROM users WHERE id=?', [id]).length)
        return false; const salt = randomBytes(16).toString('hex'); this.store.db.exec('INSERT INTO users VALUES(?,?,?,?)', [id, role, salt, scryptSync(password, salt, 32).toString('hex')]); return true; }
    login(user: string, password: string, remote: string) {
        if (typeof user !== 'string' || typeof password !== 'string' || user.length > 100 || password.length > 1024)
            failCode('SATURN_PERMISSION',{role:'authenticated'},{user},{status:401});
        const now = Date.now();
        let attempts = this.attempts.get(remote);
        if (!attempts || attempts.until < now) {
            attempts = { count: 0, until: now + 60000 };
            if (this.attempts.size > 1024)
                this.attempts.clear();
            this.attempts.set(remote, attempts);
        }
        if (++attempts.count > 10)
            failCode('SATURN_LIMIT',{resource:'login.attempts',reason:'tooMany'},{remote,max:10},{status:429});
        const row = this.store.db.all<{
            id: string;
            role: Actor['role'];
            salt: string;
            hash: string;
        }>('SELECT * FROM users WHERE id=?', [user])[0];
        const computed = scryptSync(password, row?.salt ?? 'missing-user-dummy-salt', 32);
        if (!row || !timingSafeEqual(computed, Buffer.from(row.hash, 'hex')))
            failCode('SATURN_PERMISSION',{role:'authenticated'},{user},{status:401});
        attempts.count = 0;
        const token = randomBytes(32).toString('base64url'), csrf = randomBytes(24).toString('base64url');
        this.store.db.exec('DELETE FROM sessions WHERE expires<?', [now]);
        this.store.db.exec('INSERT INTO sessions VALUES(?,?,?,?)', [hash(token), user, csrf, now + 8 * 3600000]);
        return { token, csrf, actor: { id: user, role: row.role } };
    }
    session(cookie: string | undefined, authorization?: string) {
        const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '')?.[1];
        const token = bearer ?? /(?:^|;\s*)scada_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(cookie ?? '')?.[1];
        if (!token)
            failCode('SATURN_PERMISSION',{role:'authenticated'},{resource:'session'},{status:401});
        const sessionId = hash(token); const row = this.store.db.all<{
        user_id: string;
        role: Actor['role'];
        csrf: string;
    }>('SELECT s.user_id,u.role,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires>?', [sessionId, Date.now()])[0]; if (!row)
        failCode('SATURN_PERMISSION',{role:'authenticated'},{resource:'session',reason:'expired'},{status:401}); return { actor: { id: row.user_id, role: row.role }, csrf: row.csrf, sessionId, bearer: !!bearer }; }
    logout(sessionId: string) { this.store.db.transaction(() => { this.store.db.exec('DELETE FROM sessions WHERE id=?', [sessionId]); this.store.db.exec('DELETE FROM subscriptions WHERE session_id=?', [sessionId]); }); }
}
