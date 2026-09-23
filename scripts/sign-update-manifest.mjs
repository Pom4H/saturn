#!/usr/bin/env node
import { createHash, sign } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const value = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};
const version = value('--version');
const channel = value('--channel') ?? 'stable';
const privateKeyFile = value('--private-key-file');
const output = resolve(value('--output') ?? 'saturn-update-manifest.json');
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error('Use --version X.Y.Z');
if (!['stable', 'preview', 'nightly'].includes(channel))
    throw new Error('Use --channel stable|preview|nightly');
if (!privateKeyFile)
    throw new Error('Use --private-key-file PATH');

const artifacts = {};
for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--artifact')
        continue;
    const target = args[++i], file = args[++i], url = args[++i];
    if (!target || !/^(windows|linux|darwin)-(x64|arm64)$/.test(target) || !file || !url)
        throw new Error('--artifact requires TARGET FILE HTTPS_URL');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:')
        throw new Error('Published update artifact URLs must use HTTPS');
    const path = resolve(file);
    const bytes = readFileSync(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    artifacts[target] = { url: parsed.href, sha256, signature: '', size: statSync(path).size };
}
if (!Object.keys(artifacts).length)
    throw new Error('At least one --artifact is required');

const privateKey = readFileSync(resolve(privateKeyFile), 'utf8');
const manifest = { schema: 1, version, channel, publishedAt: new Date().toISOString(), artifacts };
for (const [target, artifact] of Object.entries(artifacts)) {
    const payload = Buffer.from(JSON.stringify({
        schema: 1,
        version,
        channel,
        target,
        url: artifact.url,
        sha256: artifact.sha256,
    }), 'utf8');
    artifact.signature = sign(null, payload, privateKey).toString('base64url');
}
writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 });
console.log(output);
