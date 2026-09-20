#!/usr/bin/env node
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
if (command !== 'pack') {
    console.error('Usage: saturn pack [--project DIR] [--target windows-x64|linux-x64|linux-arm64|darwin-arm64] [--outfile PATH]');
    process.exit(2);
}

const child = spawn(process.platform === 'win32' ? 'bun.exe' : 'bun', ['run', 'scripts/standalone-pack.ts', ...args], {
    stdio: 'inherit',
    shell: false,
});
child.on('error', (error) => {
    console.error('Bun is required to create a standalone executable:', error.message);
    process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
