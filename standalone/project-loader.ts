import { readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { compileProject, projectPath, validateFiles } from '../plant/compiler';

export interface LoadedProject {
    directory: string;
    files: Record<string, string>;
    id: string;
    title: string;
}

export async function loadProjectDirectory(directory: string): Promise<LoadedProject> {
    const root = resolve(directory);
    const manifest = JSON.parse(await readFile(resolve(root, 'scada.project.json'), 'utf8'));
    if (manifest.version !== 1 || manifest.entry !== 'plant.ts' || !Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > 128)
        throw new Error('scada.project.json must be version 1 with entry "plant.ts" and 1..128 files');

    const files: Record<string, string> = {};
    for (const item of manifest.files) {
        if (typeof item !== 'string' || !projectPath(item))
            throw new Error(`Invalid project path: ${String(item)}`);
        const absolute = resolve(root, item);
        const rel = relative(root, absolute);
        if (rel === '..' || rel.startsWith('..' + sep))
            throw new Error(`Project path escapes root: ${item}`);
        files[item] = await readFile(absolute, 'utf8');
    }
    validateFiles(files);
    const project = compileProject(files);
    return { directory: root, files, id: project.id, title: project.title };
}
