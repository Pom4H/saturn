import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { resolve, join } from 'node:path';
import type { Repository, Revision } from '../types';
import { failCode, SaturnDiagnosticError } from '../diagnostics';
import { validateFiles, projectPath } from '../compiler';
const oid = (v: string) => /^[a-f0-9]{40,64}$/.test(v);
const gitNull = process.platform === 'win32' ? 'NUL' : devNull;
/** Immutable Git object I/O, no checkout, hooks, project execution or shell interpolation. */
export class GitRepository implements Repository {
    private tracking: { remote: string; sourceBranch: string; releaseBranch: string } | null = null;
    constructor(
        readonly directory: string,
        readonly branch = 'refs/heads/main',
        readonly activeRef = 'refs/scada/plant/published',
    ) {
        const validRef = (ref: string) => /^refs\/(?:heads|remotes|scada)\/[A-Za-z0-9._/-]+$/.test(ref) && !ref.includes('..');
        if (!validRef(branch) || !validRef(activeRef))
            failCode('SATURN_STORAGE_INVALID',{reason:'invalid'},{field:'git.ref',branch,activeRef});
    }
    track(remote: string, sourceBranch = 'main', releaseBranch = 'production'): this {
        const validName = (value: string) => /^[A-Za-z0-9._/-]+$/.test(value) && !value.includes('..') && !value.startsWith('/') && !value.endsWith('/');
        if (!/^[A-Za-z0-9._-]+$/.test(remote) || !validName(sourceBranch) || !validName(releaseBranch))
            failCode('SATURN_STORAGE_INVALID',{reason:'invalid'},{field:'git.tracking',remote,sourceBranch,releaseBranch});
        this.tracking = { remote, sourceBranch, releaseBranch };
        return this;
    }
    private git(args: string[], input?: string, extra: Record<string, string> = {}, quietFailure = false): Promise<string> {
        return new Promise((accept, reject) => {
            const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
            const child = spawn('git', ['-c', `core.hooksPath=${gitNull}`, '-c', 'core.fsmonitor=false', '-c', 'protocol.ext.allow=never', '--git-dir', resolve(this.directory), '-C', resolve(this.directory), ...args], { shell: false, env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: gitNull, GIT_CONFIG_NOSYSTEM: '1', ...extra }, stdio: ['pipe', 'pipe', 'pipe'] });
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
                    reject(new SaturnDiagnosticError({code:'SATURN_STORAGE_INVALID',severity:'error',message:{key:'storage.invalid',args:{reason:'malformed'}},data:{field:'git.object'}},'en',400));
                }
            } };
            const timer = setTimeout(() => { child.kill('SIGKILL'); done(new SaturnDiagnosticError({code:'SATURN_STORAGE_INVALID',severity:'error',message:{key:'storage.invalid',args:{reason:'stateChanged'}},data:{operation:args[0]}},'en',503)); }, 15000);
            child.stdout.on('data', b => { size += b.length; if (size > 2500000) {
                child.kill('SIGKILL');
                done(new SaturnDiagnosticError({code:'SATURN_LIMIT',severity:'error',message:{key:'limits.exceeded',args:{resource:'git.result',reason:'tooLarge'}},data:{limit:2500000}},'en',400));
            }
            else
                chunks.push(b); });
            child.stderr.on('data', b => { stderrSize += b.length; if (stderrSize <= 16384) stderr.push(b); });
            child.stdin.on('error', () => { });
            child.on('error', error => { console.error('Git spawn failed:', args[0] ?? '(none)', error.message); done(new SaturnDiagnosticError({code:'SATURN_STORAGE_INVALID',severity:'error',message:{key:'storage.invalid',args:{reason:'disabled'}},data:{operation:args[0]}},'en',503)); });
            child.on('close', code => {
                if (code !== 0 && !quietFailure) console.error('Git command failed:', args[0] ?? '(none)', 'exit', code, Buffer.concat(stderr).toString('utf8').trim());
                done(code === 0 ? undefined : new SaturnDiagnosticError({code:'SATURN_CONFLICT',severity:'error',message:{key:'resource.conflict',args:{resource:'git',reason:'stateChanged'}},data:{operation:args[0],exitCode:code}},'en',409));
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
            failCode('SATURN_STORAGE_INVALID',{reason:'invalid'},{field:'git.repository',expected:'bare'});
        return this;
    }
    private async ref(name: string) { try {
        const sha = (await this.git(['rev-parse', '--verify', '--end-of-options', `${name}^{commit}`], undefined, {}, true)).trim();
        if (!oid(sha))
            failCode('SATURN_STORAGE_INVALID',{reason:'invalid'},{field:'git.oid'});
        return sha;
    }
    catch (error) {
        if (error instanceof SaturnDiagnosticError && error.status === 409)
            return null;
        throw error;
    } }
    head() { return this.ref(this.branch); }
    desired() { return this.ref(this.activeRef); }
    async refresh() {
        if (!this.tracking)
            return;
        const { remote, sourceBranch, releaseBranch } = this.tracking;
        await this.git([
            'fetch', '--no-tags', '--prune', remote,
            `+refs/heads/${sourceBranch}:refs/remotes/${remote}/${sourceBranch}`,
            `+refs/heads/${releaseBranch}:refs/remotes/${remote}/${releaseBranch}`,
        ]);
    }
    async publish(sha: string, expected: string | null) {
        if (!this.activeRef.startsWith('refs/heads/') && !this.activeRef.startsWith('refs/scada/'))
            failCode('SATURN_CONFLICT',{resource:'git.releaseRef',reason:'disabled'},{ref:this.activeRef},{status:409});
        if (!oid(sha))
            failCode('SATURN_VALUE_INVALID',{field:'revision',reason:'invalid'},{sha});
        await this.read(sha);
        await this.git(['update-ref', this.activeRef, sha, expected ?? '0'.repeat(sha.length)]);
    }
    async read(sha: string): Promise<Revision> {
        if (!oid(sha))
            failCode('SATURN_VALUE_INVALID',{field:'revision',reason:'invalid'},{sha});
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
            failCode('SATURN_STORAGE_INVALID',{reason:'invalid'},{field:'published.file',path}); return this.git(['cat-file', 'blob', e.sha]); };
        const manifest = JSON.parse(await read('scada.project.json'));
        if (manifest.version !== 1 || manifest.entry !== 'plant.ts' || !Array.isArray(manifest.files) || manifest.files.length > 128 || !manifest.files.every(projectPath))
            failCode('SATURN_PROJECT_INVALID',{reason:'malformed'},{field:'scada.project.json'});
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
        if (!this.branch.startsWith('refs/heads/'))
            failCode('SATURN_CONFLICT',{resource:'git.sourceRef',reason:'disabled'},{ref:this.branch},{status:409});
        validateFiles(files);
        if (await this.head() !== expected)
            failCode('SATURN_CONFLICT',{resource:'git.revision',reason:'stateChanged'},{expected},{status:409});
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
