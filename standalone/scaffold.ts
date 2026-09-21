import { basename, resolve } from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import { NodeProjectFs } from './node-project-fs';
import { writeText } from '../src/project/fs';

function packageName(name: string): string {
  const value = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!value) throw new Error('Project directory must have a package-compatible name');
  return value;
}

export function scaffoldFiles(name: string): Record<string, string> {
  const pkg = packageName(name);
  return {
    'package.json': JSON.stringify({
      name: pkg,
      private: true,
      version: '0.0.0',
      type: 'module',
      description: 'Saturn engineering project',
      saturn: { title: name },
    }, null, 2) + '\n',
    'src/plant.ts': `import { project, simulation, system } from '@saturn/core';

export const process = system('process', 'Process');

export const source = simulation('SOURCE-1', 'supply', {
  system: process.id,
  at: { x: 120, y: 160 },
});

export default project('${pkg}', {
  title: '${name.replaceAll("'", "\\'")}',
  description: 'Saturn engineering project',
  systems: [process],
  simulations: [source],
  signals: [],
  alarms: [],
  reports: [],
});
`,
    '.gitignore': '.saturn/\nnode_modules/\n',
    'README.md': `# ${name}

This directory is the Saturn project. TypeScript is the authored source of truth.

- \`src/plant.ts\` — canonical entrypoint
- \`package.json\` — project identity and dependencies
- \`.saturn/\` — disposable derived state

\`\`\`sh
saturn check .
saturn open .
\`\`\`
`,
  };
}

export async function createSaturnProject(directory: string): Promise<string> {
  const target = resolve(directory);
  await mkdir(target, { recursive: true });
  if ((await readdir(target)).length) throw new Error(`Target directory is not empty: ${target}`);
  const fs = new NodeProjectFs(target);
  const files = scaffoldFiles(basename(target));
  for (const [path, source] of Object.entries(files)) await writeText(fs, path, source);
  return target;
}
