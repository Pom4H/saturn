import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const secretBytes = 32;

export function newToken(): string {
    return randomBytes(secretBytes).toString('base64url');
}

export function newPassword(): string {
    return randomBytes(18).toString('base64url');
}

export function hashSecret(secret: string): string {
    const salt = randomBytes(16);
    const digest = scryptSync(secret, salt, 32);
    return ['s1', salt.toString('base64url'), digest.toString('base64url')].join(':');
}

export function verifySecret(secret: string, encoded: string): boolean {
    const [version, saltText, digestText] = encoded.split(':');
    if (version !== 's1' || !saltText || !digestText)
        return false;
    try {
        const salt = Buffer.from(saltText, 'base64url');
        const expected = Buffer.from(digestText, 'base64url');
        const actual = scryptSync(secret, salt, expected.byteLength);
        return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
    }
    catch {
        return false;
    }
}

export function tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export function safeSecretEqual(left: string, right: string): boolean {
    const a = createHash('sha256').update(left).digest();
    const b = createHash('sha256').update(right).digest();
    return timingSafeEqual(a, b);
}
