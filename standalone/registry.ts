import { readText, writeText } from '../src/project/fs';
import { readProjectDescriptor } from '../src/project/project';
import { registryItem, registryItems, type RegistryItem } from '../registry/builtin';
import { NodeProjectFs } from './node-project-fs';

export interface AddResult {
  item: string;
  files: string[];
  dependencies: string[];
}

export function listRegistry(): readonly RegistryItem[] { return registryItems; }

function packageObject(source: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid package.json');
  return value as Record<string, unknown>;
}

export async function addRegistryItem(projectDirectory: string, name: string): Promise<AddResult> {
  const fs = new NodeProjectFs(projectDirectory);
  await readProjectDescriptor(fs);
  const item = registryItem(name);

  for (const path of Object.keys(item.files)) {
    if (await fs.stat(path)) throw new Error(`Refusing to overwrite project file: ${path}`);
  }

  for (const [path, source] of Object.entries(item.files)) await writeText(fs, path, source);

  const dependencies = Object.entries(item.dependencies ?? {});
  if (dependencies.length) {
    const pkg = packageObject(await readText(fs, 'package.json'));
    const current = pkg.dependencies && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)
      ? pkg.dependencies as Record<string, unknown> : {};
    pkg.dependencies = { ...current, ...Object.fromEntries(dependencies) };
    await writeText(fs, 'package.json', JSON.stringify(pkg, null, 2) + '\n');
  }

  return { item: item.name, files: Object.keys(item.files), dependencies: dependencies.map(([name]) => name) };
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runRegistryCommand(args: string[]): Promise<void> {
  const [action = 'list', name] = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--project');
  if (action === 'list') {
    console.log(JSON.stringify(registryItems.map(({ files, ...item }) => ({ ...item, files: Object.keys(files) })), null, 2));
    return;
  }
  if (action === 'add' && name) {
    const project = option(args, '--project') ?? process.cwd();
    console.log(JSON.stringify(await addRegistryItem(project, name), null, 2));
    return;
  }
  throw new Error('Usage: saturn registry list | saturn registry add <item> [--project PATH]');
}
