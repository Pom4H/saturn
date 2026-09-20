import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

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

if (!has('--skip-web-build')) {
    const child = Bun.spawn(['node', 'scripts/plant-build.mjs'], { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' });
    const exit = await child.exited;
    if (exit !== 0) process.exit(exit);
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const buildVersion = value('--version') ?? packageJson.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(buildVersion))
    throw new Error('Invalid --version');
const updatePublicKeyFile = value('--update-public-key-file');
const updatePublicKey = updatePublicKeyFile ? await readFile(resolve(updatePublicKeyFile), 'utf8') : '';
const updateManifestUrl = value('--update-manifest-url') ?? '';
const demoNames = ['views.ts','commissioning.ts','wiring.ts','plant.ts','core.ts','cooling.ts','steam.ts','safety.ts','reports.ts','auxiliary.ts','services.ts','training.ts'];
const demoFiles = Object.fromEntries(await Promise.all(demoNames.map(async name => [name, await readFile(resolve('plant/demo', name), 'utf8')] as const)));
const webAssetNames = (await readdir(resolve('dist/plant'), { recursive: true }))
    .map(value => String(value).replaceAll('\\', '/'))
    .sort();
const webAssets: Record<string, string> = {};
let webAssetBytes = 0;
for (const name of webAssetNames) {
    const file = resolve('dist/plant', name);
    const info = await stat(file);
    if (!info.isFile())
        continue;
    const bytes = await readFile(file);
    webAssetBytes += bytes.length;
    if (webAssetBytes > 32 * 1024 * 1024)
        throw new Error('Saturn web assets exceed 32 MiB standalone embedding limit');
    webAssets[name] = bytes.toString('base64');
}
const defaultName = target.includes('windows') ? 'saturn.exe' : 'saturn';
const outfile = resolve(value('--outfile') ?? resolve('dist/standalone', defaultName));
await mkdir(resolve(outfile, '..'), { recursive: true });

const build = await Bun.build({
    entrypoints: [resolve('standalone/entry.ts')],
    target: 'bun',
    minify: true,
    sourcemap: 'none',
    define: {
        SATURN_VERSION: JSON.stringify(buildVersion),
        SATURN_DEMO_FILES: JSON.stringify(demoFiles),
        SATURN_WEB_ASSETS: JSON.stringify(webAssets),
        SATURN_UPDATE_PUBLIC_KEY: JSON.stringify(updatePublicKey),
        SATURN_UPDATE_MANIFEST_URL: JSON.stringify(updateManifestUrl),
    },
    compile: {
        target,
        outfile,
        autoloadBunfig: false,
        autoloadDotenv: true,
        autoloadPackageJson: false,
        autoloadTsconfig: false,
        ...(target.includes('windows') ? {
            windows: {
                title: 'Saturn',
                publisher: 'Saturn',
                version: buildVersion,
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

console.log(`Packed Saturn ${buildVersion} application -> ${outfile}`);
console.log(`Embedded web assets: ${Object.keys(webAssets).length} files, ${(webAssetBytes / 1024 / 1024).toFixed(1)} MiB`);
console.log(`Target: ${target}`);
