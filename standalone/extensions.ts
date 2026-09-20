import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface SaturnExtensionManifest {
    api: 1;
    entry: string;
    capabilities: Array<'elements' | 'protocol' | 'datasource' | 'panel' | 'command' | 'report'>;
    elements?: Array<{ type: string; title: string; tag: string }>;
}

export interface InstalledExtension {
    name: string;
    version: string;
    path: string;
    entry: string;
    capabilities: SaturnExtensionManifest['capabilities'];
}

interface ExtensionState {
    schema: 1;
    active: Record<string, string>;
}

interface RegistryVersion {
    name: string;
    version: string;
    dist: { tarball: string; integrity?: string };
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    saturn?: SaturnExtensionManifest;
}

interface RegistryDocument {
    name: string;
    'dist-tags'?: Record<string, string>;
    versions?: Record<string, RegistryVersion>;
}

const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const pathPattern = /^[A-Za-z0-9_./-]+\.(?:js|mjs)$/;

export function parseExtensionSpecifier(specifier: string): { name: string; selector: string } {
    if (typeof specifier !== 'string' || specifier.length > 220)
        throw new Error('Invalid extension package specifier');
    let name = specifier, selector = 'latest';
    if (specifier.startsWith('@')) {
        const slash = specifier.indexOf('/');
        const at = specifier.lastIndexOf('@');
        if (slash <= 1)
            throw new Error('Invalid scoped extension package name');
        if (at > slash) {
            name = specifier.slice(0, at);
            selector = specifier.slice(at + 1);
        }
    }
    else {
        const at = specifier.lastIndexOf('@');
        if (at > 0) {
            name = specifier.slice(0, at);
            selector = specifier.slice(at + 1);
        }
    }
    if (!packageNamePattern.test(name) || !/^[A-Za-z0-9._-]{1,100}$/.test(selector))
        throw new Error('Invalid extension package specifier');
    return { name, selector };
}

function safeRelativePath(value: string): boolean {
    return value.length > 0 && value.length < 240 && !value.startsWith('/') && !value.includes('\\') &&
        value.split('/').every(part => part && part !== '.' && part !== '..');
}

export function validateExtensionPackage(pkg: RegistryVersion & { saturn?: SaturnExtensionManifest }): SaturnExtensionManifest {
    if (!packageNamePattern.test(pkg.name) || !versionPattern.test(pkg.version))
        throw new Error('Invalid extension package identity');
    const manifest = pkg.saturn;
    if (!manifest || manifest.api !== 1 || !safeRelativePath(manifest.entry) || !pathPattern.test(manifest.entry))
        throw new Error('Extension must declare saturn.api=1 and a safe bundled JS entry');
    const allowed = new Set(['elements', 'protocol', 'datasource', 'panel', 'command', 'report']);
    if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length > 16 || manifest.capabilities.some(value => !allowed.has(value)))
        throw new Error('Invalid Saturn extension capabilities');
    if (Object.keys(pkg.dependencies ?? {}).length || Object.keys(pkg.optionalDependencies ?? {}).length)
        throw new Error('Saturn extensions must be published as self-contained bundles without runtime dependencies');
    for (const element of manifest.elements ?? []) {
        if (!/^[A-Za-z0-9_.-]{1,100}$/.test(element.type) || typeof element.title !== 'string' || element.title.length > 100 || !/^[a-z][a-z0-9.-]*-[a-z0-9.-]+$/.test(element.tag))
            throw new Error('Invalid custom element declaration');
    }
    return manifest;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

function tarString(bytes: Uint8Array, start: number, length: number): string {
    const slice = bytes.slice(start, start + length);
    const zero = slice.indexOf(0);
    return new TextDecoder().decode(zero >= 0 ? slice.slice(0, zero) : slice).trim();
}

export async function extractNpmTarball(tgz: Uint8Array, destination: string): Promise<void> {
    const tar = await gunzip(tgz);
    if (tar.length > 64 * 1024 * 1024)
        throw new Error('Extension archive expands beyond 64 MiB');
    let offset = 0, files = 0;
    while (offset + 512 <= tar.length) {
        const header = tar.slice(offset, offset + 512);
        if (header.every(byte => byte === 0))
            break;
        const name = tarString(header, 0, 100);
        const prefix = tarString(header, 345, 155);
        const fullName = (prefix ? prefix + '/' : '') + name;
        const sizeText = tarString(header, 124, 12).replace(/\0/g, '').trim();
        const size = sizeText ? parseInt(sizeText, 8) : 0;
        const type = String.fromCharCode(header[156] || 48);
        if (!Number.isSafeInteger(size) || size < 0 || size > 32 * 1024 * 1024)
            throw new Error('Invalid extension tar entry size');
        const dataStart = offset + 512;
        const dataEnd = dataStart + size;
        if (dataEnd > tar.length)
            throw new Error('Truncated extension tarball');
        if (type === '0' || type === '\0') {
            const relative = fullName.startsWith('package/') ? fullName.slice('package/'.length) : fullName;
            if (!safeRelativePath(relative))
                throw new Error(`Unsafe extension archive path: ${relative}`);
            if (++files > 4096)
                throw new Error('Extension archive has too many files');
            const target = resolve(destination, relative);
            const root = resolve(destination);
            if (target !== root && !target.startsWith(root + (process.platform === 'win32' ? '\\' : '/')))
                throw new Error('Extension archive path escapes destination');
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, tar.slice(dataStart, dataEnd));
        }
        else if (!['5', 'x', 'g'].includes(type)) {
            throw new Error('Extension archive may contain only regular files and directories');
        }
        offset = dataStart + Math.ceil(size / 512) * 512;
    }
    if (!files)
        throw new Error('Extension archive contains no files');
}

function statePath(root: string) { return resolve(root, 'state.json'); }
function packageKey(name: string) { return name.replace(/^@/, '').replaceAll('/', '__'); }

async function readState(root: string): Promise<ExtensionState> {
    try {
        const parsed = JSON.parse(await readFile(statePath(root), 'utf8'));
        if (parsed?.schema !== 1 || typeof parsed.active !== 'object' || Array.isArray(parsed.active))
            throw new Error('Invalid extension state');
        return parsed;
    }
    catch (error: any) {
        if (error?.code === 'ENOENT')
            return { schema: 1, active: {} };
        throw error;
    }
}

async function writeState(root: string, state: ExtensionState): Promise<void> {
    await mkdir(root, { recursive: true });
    const path = statePath(root), temporary = path + '.tmp';
    await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, path);
}

function canonical(value: unknown): string {
    if (Array.isArray(value))
        return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object')
        return '{' + Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
    return JSON.stringify(value);
}

function registryHeaders(token?: string): HeadersInit {
    return token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Accept: 'application/json' };
}

export class ExtensionManager {
    constructor(
        readonly root: string,
        readonly registry = process.env.SATURN_NPM_REGISTRY ?? 'https://registry.npmjs.org',
        readonly token = process.env.SATURN_NPM_TOKEN,
    ) {}

    async list(): Promise<InstalledExtension[]> {
        const state = await readState(this.root);
        const result: InstalledExtension[] = [];
        for (const [name, version] of Object.entries(state.active)) {
            const path = resolve(this.root, 'packages', packageKey(name), version);
            const pkg = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8')) as RegistryVersion;
            const manifest = validateExtensionPackage(pkg);
            result.push({ name, version, path, entry: resolve(path, manifest.entry), capabilities: manifest.capabilities });
        }
        return result.sort((a, b) => a.name.localeCompare(b.name));
    }

    async install(specifier: string): Promise<InstalledExtension> {
        const { name, selector } = parseExtensionSpecifier(specifier);
        const registry = new URL(this.registry.endsWith('/') ? this.registry : this.registry + '/');
        if (registry.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(registry.hostname))
            throw new Error('Extension registry requires HTTPS outside loopback');
        const metadataUrl = new URL(encodeURIComponent(name), registry);
        const metadataResponse = await fetch(metadataUrl, {
            headers: registryHeaders(this.token),
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
        });
        if (!metadataResponse.ok)
            throw new Error(`Extension registry HTTP ${metadataResponse.status}`);
        const metadata = await metadataResponse.json() as RegistryDocument;
        const version = versionPattern.test(selector) ? selector : metadata['dist-tags']?.[selector];
        const pkg = version ? metadata.versions?.[version] : undefined;
        if (!pkg || pkg.name !== name || !pkg.dist?.integrity)
            throw new Error(`Extension ${specifier} was not found with npm integrity metadata`);
        const manifest = validateExtensionPackage(pkg);
        if (!pkg.dist.integrity.startsWith('sha512-'))
            throw new Error('Saturn requires sha512 npm integrity for extensions');
        const tarballUrl = new URL(pkg.dist.tarball);
        if (tarballUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(tarballUrl.hostname))
            throw new Error('Extension tarball requires HTTPS outside loopback');
        const tarballResponse = await fetch(tarballUrl, {
            headers: registryHeaders(this.token),
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(60000),
        });
        if (!tarballResponse.ok)
            throw new Error(`Extension tarball HTTP ${tarballResponse.status}`);
        const bytes = new Uint8Array(await tarballResponse.arrayBuffer());
        if (bytes.length > 32 * 1024 * 1024)
            throw new Error('Extension package exceeds 32 MiB');
        const expected = pkg.dist.integrity.slice('sha512-'.length);
        const actual = createHash('sha512').update(bytes).digest('base64');
        if (actual !== expected)
            throw new Error('Extension npm integrity verification failed');

        const packageRoot = resolve(this.root, 'packages', packageKey(name));
        const target = resolve(packageRoot, pkg.version);
        const temporary = resolve(packageRoot, `.install-${pkg.version}-${crypto.randomUUID()}`);
        await rm(temporary, { recursive: true, force: true });
        await mkdir(temporary, { recursive: true });
        try {
            await extractNpmTarball(bytes, temporary);
            const installedPkg = JSON.parse(await readFile(resolve(temporary, 'package.json'), 'utf8')) as RegistryVersion;
            const installedManifest = validateExtensionPackage(installedPkg);
            if (installedPkg.name !== name || installedPkg.version !== pkg.version || canonical(installedManifest) !== canonical(manifest))
                throw new Error('Installed extension manifest does not match registry metadata');
            await rm(target, { recursive: true, force: true });
            await mkdir(packageRoot, { recursive: true });
            await rename(temporary, target);
        }
        catch (error) {
            await rm(temporary, { recursive: true, force: true });
            throw error;
        }
        const state = await readState(this.root);
        state.active[name] = pkg.version;
        await writeState(this.root, state);
        return { name, version: pkg.version, path: target, entry: resolve(target, manifest.entry), capabilities: manifest.capabilities };
    }

    async remove(name: string): Promise<void> {
        if (!packageNamePattern.test(name))
            throw new Error('Invalid extension package name');
        const state = await readState(this.root);
        delete state.active[name];
        await writeState(this.root, state);
        await rm(resolve(this.root, 'packages', packageKey(name)), { recursive: true, force: true });
    }
}

export async function runExtensionCommand(args: string[], appData: string): Promise<void> {
    const [action = 'list', value] = args;
    const manager = new ExtensionManager(resolve(appData, 'extensions'));
    if (action === 'list') {
        const extensions = await manager.list();
        if (!extensions.length)
            console.log('No Saturn extensions installed.');
        for (const extension of extensions)
            console.log(`${extension.name}@${extension.version} · ${extension.capabilities.join(', ')}`);
        return;
    }
    if (action === 'add' || action === 'update') {
        if (!value)
            throw new Error(`Usage: saturn extension ${action} <package[@version]>`);
        const extension = await manager.install(value);
        console.log(`${action === 'add' ? 'Installed' : 'Updated'} ${extension.name}@${extension.version}`);
        return;
    }
    if (action === 'remove') {
        if (!value)
            throw new Error('Usage: saturn extension remove <package>');
        await manager.remove(value);
        console.log(`Removed ${value}`);
        return;
    }
    throw new Error('Usage: saturn extension <list|add|update|remove> [package]');
}
