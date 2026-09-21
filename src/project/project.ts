import { exists, readText, walkProject, type ProjectFs } from './fs';

export const SATURN_ENTRY = 'src/plant.ts';

export interface ProjectDescriptor {
  name: string;
  title: string;
  description: string;
  entry: typeof SATURN_ENTRY;
}

export interface OpenProject {
  fs: ProjectFs;
  descriptor: ProjectDescriptor;
  sources: Record<string, string>;
  assets: string[];
}

type PackageJson = {
  name?: unknown;
  description?: unknown;
  saturn?: { title?: unknown };
};

function projectName(value: unknown): string {
  if (typeof value !== 'string' || !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(value)) {
    throw new Error('package.json must declare a valid project name');
  }
  return value;
}

export async function readProjectDescriptor(fs: ProjectFs): Promise<ProjectDescriptor> {
  if (!await exists(fs, 'package.json')) throw new Error('Saturn project needs package.json');
  if (!await exists(fs, SATURN_ENTRY)) throw new Error(`Saturn project entry is ${SATURN_ENTRY}`);
  const pkg = JSON.parse(await readText(fs, 'package.json')) as PackageJson;
  const name = projectName(pkg.name);
  const title = typeof pkg.saturn?.title === 'string' && pkg.saturn.title.trim()
    ? pkg.saturn.title.trim()
    : name.replace(/^@[^/]+\//, '');
  const description = typeof pkg.description === 'string' ? pkg.description : '';
  return { name, title, description, entry: SATURN_ENTRY };
}

const textSource = /\.(?:ts|tsx|sql|json|md|css|svg)$/i;

export async function openProject(fs: ProjectFs): Promise<OpenProject> {
  const descriptor = await readProjectDescriptor(fs);
  const assets = await walkProject(fs);
  const sources: Record<string, string> = {};
  for (const path of assets) {
    if (!textSource.test(path)) continue;
    try { sources[path] = await readText(fs, path); }
    catch (error) {
      if (/\.(?:ts|tsx)$/i.test(path)) throw error;
    }
  }
  return { fs, descriptor, sources, assets };
}
