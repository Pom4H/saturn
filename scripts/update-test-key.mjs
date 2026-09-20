import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'standalone-test-key');
mkdirSync(directory, { recursive: true });
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(resolve(directory, 'public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
writeFileSync(resolve(directory, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
console.log(directory);
