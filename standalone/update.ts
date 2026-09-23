import { createHash, verify as verifySignature } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

export type UpdateChannel = 'stable' | 'preview' | 'nightly';

export interface UpdateArtifact {
    url: string;
    sha256: string;
    signature: string;
    size?: number;
}

export interface UpdateManifest {
    schema: 1;
    version: string;
    channel: UpdateChannel;
    publishedAt: string;
    artifacts: Record<string, UpdateArtifact>;
}

export interface UpdateContext {
    currentVersion: string;
    publicKeyPem: string;
    defaultManifestUrl: string;
    appData: string;
    executable: string;
    standaloneExecutable: boolean;
    restartArgs?: string[];
}

export interface ApplicationUpdateStatus {
    configured: boolean;
    available: boolean;
    currentVersion: string;
    version?: string;
    channel?: UpdateChannel;
    publishedAt?: string;
    target?: string;
}

const versionPattern = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function compareVersions(a: string, b: string): number {
    const parse = (value: string) => {
        const match = versionPattern.exec(value);
        if (!match)
            throw new Error(`Invalid Saturn version: ${value}`);
        return { numbers: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? '' };
    };
    const left = parse(a), right = parse(b);
    for (let i = 0; i < 3; i++) {
        if (left.numbers[i] !== right.numbers[i])
            return left.numbers[i] < right.numbers[i] ? -1 : 1;
    }
    if (left.pre === right.pre)
        return 0;
    if (!left.pre)
        return 1;
    if (!right.pre)
        return -1;
    return left.pre.localeCompare(right.pre);
}

export function updateTarget(platform = process.platform, arch = process.arch): string {
    const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : platform;
    const cpu = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : arch;
    return `${os}-${cpu}`;
}

export function updateSignaturePayload(manifest: Pick<UpdateManifest, 'schema' | 'version' | 'channel'>, target: string, artifact: Pick<UpdateArtifact, 'url' | 'sha256'>): Buffer {
    return Buffer.from(JSON.stringify({
        schema: manifest.schema,
        version: manifest.version,
        channel: manifest.channel,
        target,
        url: artifact.url,
        sha256: artifact.sha256.toLowerCase(),
    }), 'utf8');
}

function decodeSignature(value: string): Buffer {
    if (!/^[A-Za-z0-9_-]{64,256}$/.test(value))
        throw new Error('Invalid update signature encoding');
    return Buffer.from(value, 'base64url');
}

export function verifyUpdateArtifact(manifest: UpdateManifest, target: string, publicKeyPem: string): UpdateArtifact {
    if (manifest.schema !== 1 || !versionPattern.test(manifest.version) || !['stable', 'preview', 'nightly'].includes(manifest.channel))
        throw new Error('Invalid Saturn update manifest');
    const artifact = manifest.artifacts?.[target];
    if (!artifact || typeof artifact.url !== 'string' || !/^https?:\/\//.test(artifact.url) || !/^[a-f0-9]{64}$/i.test(artifact.sha256))
        throw new Error(`No valid Saturn artifact for ${target}`);
    if (!publicKeyPem.trim())
        throw new Error('Saturn update public key is not configured in this build');
    const valid = verifySignature(null, updateSignaturePayload(manifest, target, artifact), publicKeyPem, decodeSignature(artifact.signature));
    if (!valid)
        throw new Error('Saturn update signature verification failed');
    return artifact;
}

export async function fetchUpdateManifest(url: string): Promise<UpdateManifest> {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash)
        throw new Error('Invalid Saturn update manifest URL');
    if (parsed.protocol !== 'https:' && !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname))
        throw new Error('Saturn update manifest requires HTTPS outside loopback');
    const response = await fetch(parsed, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok)
        throw new Error(`Update manifest HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 512_000)
        throw new Error('Update manifest is too large');
    return JSON.parse(text) as UpdateManifest;
}

export async function downloadAndVerifyUpdate(manifest: UpdateManifest, target: string, artifact: UpdateArtifact, directory: string): Promise<string> {
    const response = await fetch(artifact.url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!response.ok)
        throw new Error(`Update download HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (artifact.size !== undefined && bytes.length !== artifact.size)
        throw new Error('Downloaded update size does not match manifest');
    if (bytes.length < 1024 * 1024 || bytes.length > 512 * 1024 * 1024)
        throw new Error('Downloaded update size is outside allowed bounds');
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== artifact.sha256.toLowerCase())
        throw new Error('Downloaded update digest does not match manifest');
    await mkdir(directory, { recursive: true });
    const extension = target.startsWith('windows-') ? '.exe' : '';
    const staged = resolve(directory, `saturn-${manifest.version}-${target}${extension}`);
    await writeFile(staged, bytes, { mode: 0o755 });
    if (process.platform !== 'win32')
        await chmod(staged, 0o755);
    return staged;
}

async function waitForExit(pid: number, timeoutMs = 30000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            process.kill(pid, 0);
        }
        catch {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for Saturn process ${pid} to exit`);
}

function spawnAndWait(file: string, args: string[]): Promise<number> {
    return new Promise((resolveExit, reject) => {
        const child = spawn(file, args, { shell: false, stdio: 'ignore', windowsHide: true });
        child.once('error', reject);
        child.once('exit', code => resolveExit(code ?? 1));
    });
}

export async function applyStagedUpdate(args: string[]): Promise<void> {
    const [pidText, target, staged, backup, expectedVersion, restartEncoded] = args;
    const pid = Number(pidText);
    if (!Number.isSafeInteger(pid) || pid <= 0 || !target || !staged || !backup || !expectedVersion || !versionPattern.test(expectedVersion))
        throw new Error('Invalid internal update arguments');
    let restartArgs: string[] = [];
    if (restartEncoded) {
        const parsed = JSON.parse(Buffer.from(restartEncoded, 'base64url').toString('utf8'));
        if (!Array.isArray(parsed) || parsed.length > 32 || parsed.some(value => typeof value !== 'string' || value.length > 4096))
            throw new Error('Invalid update restart arguments');
        restartArgs = parsed;
    }
    await waitForExit(pid);
    const temporary = target + '.next';
    await rm(temporary, { force: true });
    await copyFile(staged, temporary);
    if (process.platform !== 'win32')
        await chmod(temporary, 0o755);
    await rm(backup, { force: true });
    await rename(target, backup);
    try {
        await rename(temporary, target);
        const health = await spawnAndWait(target, ['__healthcheck', '--expect-version', expectedVersion]);
        if (health !== 0)
            throw new Error(`Updated Saturn failed health check with exit code ${health}`);
        await rm(staged, { force: true });
        if (process.env.SATURN_UPDATE_NO_RELAUNCH !== '1') {
            const child = spawn(target, restartArgs, { detached: true, stdio: 'ignore', windowsHide: true });
            child.unref();
        }
    }
    catch (error) {
        await rm(target, { force: true }).catch(() => {});
        await rename(backup, target).catch(() => {});
        throw error;
    }
}

export async function scheduleUpdateApply(context: UpdateContext, staged: string, expectedVersion: string): Promise<void> {
    if (!context.standaloneExecutable)
        throw new Error('Self-update installation is available only in the packaged Saturn application');
    const helperName = process.platform === 'win32' ? `saturn-updater-${process.pid}.exe` : `saturn-updater-${process.pid}`;
    const helper = resolve(tmpdir(), helperName);
    await copyFile(context.executable, helper);
    if (process.platform !== 'win32')
        await chmod(helper, 0o755);
    const backup = resolve(dirname(context.executable), process.platform === 'win32' ? 'saturn.previous.exe' : 'saturn.previous');
    const restartEncoded = Buffer.from(JSON.stringify(context.restartArgs ?? []), 'utf8').toString('base64url');
    const child = spawn(helper, ['__apply-update', String(process.pid), context.executable, staged, backup, expectedVersion, restartEncoded], {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
    });
    child.unref();
}

function manifestUrl(context: UpdateContext): string {
    return process.env.SATURN_UPDATE_MANIFEST_URL ?? context.defaultManifestUrl;
}

async function resolveUpdate(context: UpdateContext, channel: UpdateChannel) {
    if (!context.standaloneExecutable || !context.publicKeyPem.trim() || !manifestUrl(context))
        return null;
    const manifest = await fetchUpdateManifest(manifestUrl(context));
    if (manifest.channel !== channel)
        throw new Error(`Manifest channel is ${manifest.channel}, expected ${channel}`);
    const target = updateTarget();
    const artifact = verifyUpdateArtifact(manifest, target, context.publicKeyPem);
    return { manifest, target, artifact, comparison: compareVersions(context.currentVersion, manifest.version) };
}

export async function checkApplicationUpdate(context: UpdateContext, channel: UpdateChannel = 'stable'): Promise<ApplicationUpdateStatus> {
    const candidate = await resolveUpdate(context, channel);
    if (!candidate)
        return { configured: false, available: false, currentVersion: context.currentVersion };
    return {
        configured: true,
        available: candidate.comparison < 0,
        currentVersion: context.currentVersion,
        version: candidate.manifest.version,
        channel: candidate.manifest.channel,
        publishedAt: candidate.manifest.publishedAt,
        target: candidate.target,
    };
}

export async function installApplicationUpdate(context: UpdateContext, channel: UpdateChannel = 'stable'): Promise<{ scheduled: true; version: string }> {
    const candidate = await resolveUpdate(context, channel);
    if (!candidate)
        throw new Error('Saturn self-update is not configured in this build');
    if (candidate.comparison >= 0)
        throw new Error(candidate.comparison === 0 ? 'Saturn is already up to date' : 'The configured update is older than this Saturn build');
    const updateDir = resolve(context.appData, 'updates', candidate.manifest.version);
    const staged = await downloadAndVerifyUpdate(candidate.manifest, candidate.target, candidate.artifact, updateDir);
    await scheduleUpdateApply(context, staged, candidate.manifest.version);
    return { scheduled: true, version: candidate.manifest.version };
}

function option(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}

export async function runUpdateCommand(args: string[], context: UpdateContext): Promise<'none' | 'scheduled'> {
    const manifestUrl = option(args, '--manifest') ?? process.env.SATURN_UPDATE_MANIFEST_URL ?? context.defaultManifestUrl;
    if (!manifestUrl)
        throw new Error('This Saturn build has no update manifest URL; use --manifest or build with one');
    const requestedChannel = (option(args, '--channel') ?? 'stable') as UpdateChannel;
    if (!['stable', 'preview', 'nightly'].includes(requestedChannel))
        throw new Error('Update channel must be stable, preview or nightly');
    const manifest = await fetchUpdateManifest(manifestUrl);
    if (manifest.channel !== requestedChannel)
        throw new Error(`Manifest channel is ${manifest.channel}, expected ${requestedChannel}`);
    const target = updateTarget();
    const artifact = verifyUpdateArtifact(manifest, target, context.publicKeyPem);
    const comparison = compareVersions(context.currentVersion, manifest.version);
    const allowDowngrade = args.includes('--allow-downgrade');
    const checkOnly = args.includes('--check');
    console.log(`Saturn ${context.currentVersion} → ${manifest.version} (${manifest.channel}, ${target})`);
    if (comparison === 0) {
        console.log('Saturn is already up to date.');
        return 'none';
    }
    if (comparison > 0 && !allowDowngrade)
        throw new Error('Refusing Saturn downgrade without --allow-downgrade');
    if (checkOnly) {
        console.log(comparison < 0 ? 'Update available.' : 'Downgrade available.');
        return 'none';
    }
    const updateDir = resolve(context.appData, 'updates', manifest.version);
    const staged = await downloadAndVerifyUpdate(manifest, target, artifact, updateDir);
    await scheduleUpdateApply(context, staged, manifest.version);
    console.log(`Verified Saturn ${manifest.version}; update will be applied after this process exits.`);
    return 'scheduled';
}
