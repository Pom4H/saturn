import { resolve } from 'node:path';
import { models } from '../plant/models';
import { compileProject } from '../plant/compiler';
import { installEquipment, sceneFor } from '../plant/equipment';
import { catalog } from '../src/core';
import { ExtensionManager } from './extensions';
import { loadProjectDirectory } from './project-loader';

export interface IdeCatalogItem {
    type: string;
    title: string;
    source: string;
    tag?: string;
}

export interface IdeCatalogGroup {
    id: string;
    title: string;
    source: string;
    items: IdeCatalogItem[];
}

export interface IdeCatalogDocument {
    schema: 1;
    catalogs: IdeCatalogGroup[];
}

export interface IdeDiagramDocument {
    schema: 1;
    project: { id: string; title: string; directory: string };
    scene: ReturnType<typeof sceneFor>;
    definitions: Record<string, { label: string; width: number; height: number }>;
}

export async function ideCatalog(appData: string): Promise<IdeCatalogDocument> {
    const core: IdeCatalogGroup = {
        id: 'core',
        title: 'Saturn Core',
        source: '@saturn/core',
        items: models()
            .map(item => ({ type: item.kind, title: item.title, source: '@saturn/core' }))
            .sort((a, b) => a.title.localeCompare(b.title)),
    };

    const extensions = await new ExtensionManager(resolve(appData, 'extensions')).list();
    const catalogs: IdeCatalogGroup[] = [core];
    for (const extension of extensions) {
        if (!extension.elements.length)
            continue;
        catalogs.push({
            id: extension.name,
            title: extension.name,
            source: `${extension.name}@${extension.version}`,
            items: extension.elements.map(element => ({
                type: element.type,
                title: element.title,
                source: extension.name,
                ...(element.tag ? { tag: element.tag } : {}),
            })),
        });
    }
    return { schema: 1, catalogs };
}

export async function ideDiagram(projectPath: string): Promise<IdeDiagramDocument> {
    const loaded = await loadProjectDirectory(projectPath);
    const project = compileProject(loaded.files);
    installEquipment();
    const scene = sceneFor(project);
    const definitions = Object.fromEntries(
        [...new Set(scene.nodes.map(node => node.kind))]
            .map(kind => {
                const definition = catalog[kind];
                if (!definition)
                    throw new Error(`Missing visual definition for ${kind}`);
                return [kind, { label: definition.label, width: definition.width, height: definition.height }];
            }),
    );
    return {
        schema: 1,
        project: { id: loaded.id, title: loaded.title, directory: loaded.directory },
        scene,
        definitions,
    };
}

function option(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}

export async function runIdeCommand(args: string[], appData: string): Promise<void> {
    const positional = args.filter((arg, index) => arg !== '--json' && args[index - 1] !== '--project');
    const [action = 'catalog'] = positional;
    if (action === 'catalog') {
        console.log(JSON.stringify(await ideCatalog(appData)));
        return;
    }
    if (action === 'diagram') {
        const project = option(args, '--project');
        if (!project)
            throw new Error('Usage: saturn ide diagram --project PATH --json');
        console.log(JSON.stringify(await ideDiagram(project)));
        return;
    }
    throw new Error('Usage: saturn ide <catalog|diagram> [--project PATH] --json');
}
