#!/usr/bin/env node
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const command = args[0] ?? 'open';
const bun = process.platform === 'win32' ? 'bun.exe' : 'bun';

let childArgs;
if (command === 'pack') {
    childArgs = ['run', 'scripts/standalone-pack.ts', ...args.slice(1)];
}
else if (['open', 'run', 'update', 'extension', 'extensions', 'ide'].includes(command)) {
    childArgs = ['run', 'standalone/entry.ts', command, ...args.slice(1)];
}
else {
    console.error([
        'Usage:',
        '  saturn open [PROJECT]',
        '  saturn run PROJECT [--kiosk]',
        '  saturn update [--check] [--channel stable|preview|nightly]',
        '  saturn extension <list|add|update|remove> [package]',
        '  saturn ide catalog --json',
        '  saturn ide docs --locale en|ru --json',
        '  saturn ide check --project PROJECT --locale en|ru --json',
        '  saturn ide diagram --project PROJECT --json',
        '  saturn ide reports --project PROJECT --json',
        '  saturn ide report --project PROJECT --id REPORT --json',
        '  saturn pack [--target windows-x64|linux-x64|linux-arm64|darwin-arm64] [--outfile PATH]',
    ].join('\n'));
    process.exit(2);
}

const child = spawn(bun, childArgs, { stdio: 'inherit', shell: false });
child.on('error', error => {
    console.error('Bun is required when running Saturn from the source checkout:', error.message);
    process.exit(1);
});
child.on('exit', code => process.exit(code ?? 1));
