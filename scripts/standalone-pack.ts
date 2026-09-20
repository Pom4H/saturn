import { mkdir, readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { demoFiles } from '../plant/demo/files';

const args = process.argv.slice(2);
const value = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};
const has = (name: string) => args.includes(name);

const aliases: Record<string, Bun.Build.Target> = {
    'windows-x64': 'bun-windows-x64',
    'windows-x64-baseline': 'bun-windows-x64-baseline',
    'windows-arm64': 'bun-windows-arm64',
    'linux-x64': 'bun-linux-x64',
    'linux-x64-baseline': 'bun-linux-x64-baseline',
    'linux-arm64': 'bun-linux-arm64',
    'linux-x64-musl': 'bun-linux-x64-musl',
    'linux-arm64-musl': 'bun-linux-arm64-musl',
    'darwin-x64': 'bun-darwin-x64',
    'darwin-arm64': 'bun-darwin-arm64',
};

const rawTarget = value('--target') ?? (process.platform === 'win32' ? 'windows-x64' : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64') : (process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64'));
const target = (aliases[rawTarget] ?? rawTarget) as Bun.Build.Target;
if (!String(target).startsWith('bun-')) throw new Error(`Unsupported target: ${rawTarget}`);

const projectDirectory = value('--project');
async function loadProject(): Promise<Record<string, string>> {
    if (!projectDirectory || projectDirectory === 'demo') return demoFiles;
    const root = resolve(projectDirectory);
    const manifestPath = resolve(root, 'scada.project.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.version !== 1 || manifest.entry !== 'plant.ts' || !Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > 128) {
        throw new Error('scada.project.json must be version 1 with entry "plant.ts" and 1..128 files');
    }
    const result: Record<string, string> = {};
    let total = 0;
    for (const item of manifest.files) {
        if (typeof item !== 'string' || item.length > 180 || item.includes('\\') || item.startsWith('/') || item.split('/').some((part: string) => part === '..' || part === '')) {
            throw new Error(`Unsafe project path: ${String(item)}`);
        }
        const path = resolve(root, item);
        const rel = relative(root, path);
        if (rel.startsWith('..' + sep) || rel === '..') throw new Error(`Project path escapes root: ${item}`);
        const source = await readFile(path, 'utf8');
        total += Buffer.byteLength(source);
        if (Buffer.byteLength(source) > 200_000 || total > 2_500_000) throw new Error('Project source exceeds standalone pack limits');
        result[item] = source;
    }
    if (!result['plant.ts']) throw new Error('Packed project must include plant.ts');
    return result;
}

if (!has('--skip-web-build')) {
    const child = Bun.spawn(['node', 'scripts/plant-build.mjs'], { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' });
    const exit = await child.exited;
    if (exit !== 0) process.exit(exit);
}

const project = await loadProject();
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const defaultName = target.includes('windows') ? 'saturn.exe' : 'saturn';
const outfile = resolve(value('--outfile') ?? resolve('dist/standalone', defaultName));
await mkdir(resolve(outfile, '..'), { recursive: true });

const build = await Bun.build({
    entrypoints: [resolve('standalone/entry.ts')],
    target: 'bun',
    minify: true,
    sourcemap: 'none',
    define: {
        SATURN_PACKED_PROJECT: JSON.stringify(project),
        SATURN_VERSION: JSON.stringify(packageJson.version),
    },
    compile: {
        target,
        outfile,
        assets: ['dist/plant'],
        autoloadBunfig: false,
        autoloadDotenv: true,
        autoloadPackageJson: false,
        autoloadTsconfig: false,
        ...(target.includes('windows') ? {
            windows: {
                title: 'Saturn',
                publisher: 'Saturn',
                version: packageJson.version,
                description: 'Saturn standalone engineering runtime',
                copyright: 'MIT © Roman Popov',
                hideConsole: false,
            },
        } : {}),
    },
});

if (!build.success) {
    for (const log of build.logs) console.error(log);
    process.exit(1);
}

console.log(`Packed ${Object.keys(project).length} project files -> ${outfile}`);
console.log(`Target: ${target}`);
