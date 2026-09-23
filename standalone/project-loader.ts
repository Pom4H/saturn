import { compileProject } from '../plant/compiler';
import { openProject } from '../src/project/project';
import { NodeProjectFs } from './node-project-fs';

export interface LoadedProject {
  directory: string;
  fs: NodeProjectFs;
  sources: Record<string, string>;
  assets: string[];
  id: string;
  title: string;
  packageName: string;
}

export async function loadProjectDirectory(directory: string): Promise<LoadedProject> {
  const fs = new NodeProjectFs(directory);
  const opened = await openProject(fs);
  const project = compileProject(opened.sources, opened.descriptor.entry);
  return {
    directory: fs.root,
    fs,
    sources: opened.sources,
    assets: opened.assets,
    id: project.id,
    title: project.title || opened.descriptor.title,
    packageName: opened.descriptor.name,
  };
}
