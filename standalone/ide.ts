import { models } from '../plant/models';
import { ExtensionManager } from './extensions';

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

export async function ideCatalog(appData: string): Promise<IdeCatalogDocument> {
    const core: IdeCatalogGroup = {
        id: 'core',
        title: 'Saturn Core',
        source: '@saturn/core',
        items: models()
            .map(item => ({ type: item.kind, title: item.title, source: '@saturn/core' }))
            .sort((a, b) => a.title.localeCompare(b.title)),
    };

    const extensions = await new ExtensionManager(resolveExtensions(appData)).list();
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

function resolveExtensions(appData: string): string {
    return new URL('./extensions/', new URL('file://' + appData.replaceAll('\\', '/') + '/')).pathname;
}

export async function runIdeCommand(args: string[], appData: string): Promise<void> {
    const [action = 'catalog'] = args.filter(arg => arg !== '--json');
    if (action !== 'catalog')
        throw new Error('Usage: saturn ide catalog --json');
    console.log(JSON.stringify(await ideCatalog(appData)));
}
