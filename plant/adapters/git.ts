import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { resolve, join } from 'node:path';
import { AppError, type Repository, type Revision } from '../types';
import { validateFiles, projectPath } from '../compiler';
const oid = (v: string) => /^[a-f0-9]{40,64}$/.test(v);
/** Immutable Git object I/O, no checkout, hooks, project execution or shell interpolation. */
export class GitRepository implements Repository {
    readonly activeRef = 'refs/scada/plant/published';
    constructor(readonly directory: string, readonly branch = 'refs/heads/main') {
        if (!/^refs\/heads\/[A-Za-z0-9_/-]+$/.test(branch) || branch.includes('..'))
            throw new AppError('Invalid configured project branch');
    }
    private git(args: string[], input?: string, extra: Record<string, string> = {}): Promise<string> {
        return new Promise((accept, reject) => {
            const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
            const child = spawn('git', ['-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false', '-c', 'protocol.ext.allow=never', '--git-dir', resolve(this.directory), '-C', resolve(this.directory), ...args], { shell: false, env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', ...extra }, stdio: ['pipe', 'pipe', 'pipe'] });
            const chunks: Buffer[] = [], stderr: Buffer[] = [];
            let size = 0, stderrSize = 0, settled = false;
            const done = (error?: Error) => { if (settled)
                return; settled = true; clearTimeout(timer); if (error)
                reject(error);
            else {
                try {
                    accept(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
                }
                catch {
                    reject(new AppError('Invalid UTF-8 Git object'));
                }
            } };
            const timer = setTimeout(() => { child.kill('SIGKILL'); done(new AppError('Git operation timed out', 503)); }, 15000);
            child.stdout.on('data', b => { size += b.length; if (size > 2500000) {
                child.kill('SIGKILL');
                done(new AppError('Git result exceeds limits'));
            }
            else
                chunks.push(b); });
            child.stderr.on('data', b => { stderrSize += b.length; if (stderrSize <= 16384) stderr.push(b); });
            child.stdin.on('error', () => { });
            child.on('error', error => { console.error('Git spawn failed:', args[0] ?? '(none)', error.message); done(new AppError('Git unavailable', 503)); });
            child.on('close', code => {
                if (code !== 0) console.error('Git command failed:', args[0] ?? '(none)', 'exit', code, Buffer.concat(stderr).toString('utf8').trim());
                done(code === 0 ? undefined : new AppError('Git operation failed', 409));
            });
            child.stdin.end(input);
        });
    }
    async initialize() {
        await mkdir(this.directory, { recursive: true });
        // A nested data directory must never discover or modify its parent checkout.
        if ((await readdir(this.directory)).length === 0)
            await this.git(['init', '--bare']);
        if ((await this.git(['rev-parse', '--is-bare-repository'])).trim() !== 'true')
            throw new AppError('Use a dedicated bare Git repository for installation data');
        return this;
    }
    private async ref(name: string) { try {
        const sha = (await this.git(['rev-parse', '--verify', '--end-of-options', `${name}^{commit}`])).trim();
        if (!oid(sha))
            throw new AppError('Invalid object ID');
        return sha;
    }
    catch (error) {
        if (error instanceof AppError && error.status === 409)
            return null;
        throw error;
    } }
    head() { return this.ref(this.branch); }
    desired() { return this.ref(this.activeRef); }
    async publish(sha: string, expected: string | null) { if (!oid(sha))
        throw new AppError('Invalid revision'); await this.read(sha); await this.git(['update-ref', this.activeRef, sha, expected ?? '0'.repeat(sha.length)]); }
    async read(sha: string): Promise<Revision> {
        if (!oid(sha))
            throw new AppError('Invalid revision');
        const entries = new Map<string, {
            mode: string;
            sha: string;
            size: number;
        }>();
        for (const line of (await this.git(['ls-tree', '-r', '-l', '-z', sha])).split('\0')) {
            const m = /^(\d+) (\w+) ([a-f0-9]+)\s+(\d+)\t(.*)$/s.exec(line);
            if (m)
                entries.set(m[5], { mode: m[1], sha: m[3], size: Number(m[4]) });
        }
        const read = async (path: string) => { const e = entries.get(path); if (!e || e.mode !== '100644' || e.size > 200000)
            throw new AppError('Published files must be bounded regular UTF-8 text'); return this.git(['cat-file', 'blob', e.sha]); };
        const manifest = JSON.parse(await read('scada.project.json'));
        if (manifest.version !== 1 || manifest.entry !== 'plant.ts' || !Array.isArray(manifest.files) || manifest.files.length > 128 || !manifest.files.every(projectPath))
            throw new AppError('Invalid plant manifest');
        const files: Record<string, string> = {};
        for (const path of manifest.files)
            files[path] = await read(path);
        validateFiles(files);
        const metadata = (await this.git(['show', '--no-patch', '--format=%P%n%ct%n%an%n%B', sha])).split('\n');
        return { id: sha, parent: metadata[0].split(' ')[0] || null, time: Number(metadata[1]) * 1000, actor: metadata[2], message: metadata.slice(3).join('\n').trim(), files };
    }
    async log(limit = 20) { const head = await this.head(); if (!head)
        return []; const result: Revision[] = []; for (const sha of (await this.git(['rev-list', `--max-count=${Math.min(100, Math.max(1, limit))}`, head])).trim().split('\n'))
        result.push(await this.read(sha)); return result; }
    async commit(files: Record<string, string>, expected: string | null, message: string, actor: string): Promise<Revision> {
        validateFiles(files);
        if (await this.head() !== expected)
            throw new AppError('Git revision changed', 409);
        const dir = await mkdtemp(join(tmpdir(), 'scada-plant-'));
        const env = { GIT_INDEX_FILE: join(dir, 'index') };
        try {
            if (expected)
                await this.git(['read-tree', expected], undefined, env);
            else
                await this.git(['read-tree', '--empty'], undefined, env);
            if (expected) {
                const previous = await this.read(expected);
                for (const path of Object.keys(previous.files))
                    if (!(path in files))
                        await this.git(['update-index', '--force-remove', '--', path], undefined, env);
            }
            const published = { ...files, 'scada.project.json': JSON.stringify({ version: 1, entry: 'plant.ts', files: Object.keys(files).sort() }) };
            for (const [path, text] of Object.entries(published)) {
                const blob = (await this.git(['hash-object', '-w', '--stdin'], text)).trim();
                await this.git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], undefined, env);
            }
            const tree = (await this.git(['write-tree'], undefined, env)).trim();
            const sha = (await this.git(['-c', `user.name=${actor.replace(/[\r\n<>]/g, '').slice(0, 80)}`, '-c', 'user.email=scada@localhost', 'commit-tree', tree, ...(expected ? ['-p', expected] : [])], message + '\n')).trim();
            await this.git(['update-ref', this.branch, sha, expected ?? '0'.repeat(sha.length)]);
            return this.read(sha);
        }
        finally {
            await rm(dir, { recursive: true, force: true });
        }
    }
}
