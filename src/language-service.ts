import ts from '@typescript/typescript6';
import { localizedDslEntity } from '../plant/dsl-i18n';
import type { SaturnLocale } from '../plant/diagnostics';

export interface DslLibrary { root: string; defaultLib: string; files: Record<string, string> }
export interface HoverDocumentation {
  from: number; to: number; signature: string; documentation: string;
  tags: { name: string; text: string }[];
}
const projectPath = (path: string) => '/project/' + path.replaceAll('\\', '/').replace(/^\/+/, '');

/** One TS language service over the real SDK and current project files. No project code executes. */
export class SaturnLanguageService {
  private files = new Map<string, { text: string; version: number }>();
  private version = 0;
  private service: ts.LanguageService;
  constructor(library: DslLibrary) {
    for (const [name, text] of Object.entries(library.files)) this.files.set(name, { text, version: 0 });
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, types: [] };
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => options,
      getScriptFileNames: () => [...this.files.keys()].filter(path => path.startsWith('/project/')),
      getScriptVersion: path => String(this.files.get(path)?.version ?? 0),
      getProjectVersion: () => String(this.version),
      getScriptSnapshot: path => { const file = this.files.get(path); return file ? ts.ScriptSnapshot.fromString(file.text) : undefined; },
      getCurrentDirectory: () => '/project', getDefaultLibFileName: () => library.defaultLib,
      fileExists: path => this.files.has(path), readFile: path => this.files.get(path)?.text,
      directoryExists: path => [...this.files.keys()].some(name => name.startsWith(path.replace(/\/$/, '') + '/')),
      readDirectory: () => [], useCaseSensitiveFileNames: () => true,
      resolveModuleNames: (names, containing) => names.map(name => name === '@saturn/core'
        ? { resolvedFileName: library.root, extension: ts.Extension.Dts, isExternalLibraryImport: true }
        : ts.resolveModuleName(name, containing, options, host).resolvedModule),
    };
    this.service = ts.createLanguageService(host);
  }
  update(files: Record<string, string>): void {
    const names = new Set(Object.keys(files).map(projectPath));
    let changed = false;
    for (const path of this.files.keys()) if (path.startsWith('/project/') && !names.has(path)) { this.files.delete(path); changed = true; }
    for (const [path, text] of Object.entries(files)) {
      const name = projectPath(path), previous = this.files.get(name);
      if (previous?.text === text) continue;
      this.files.set(name, { text, version: (previous?.version ?? 0) + 1 }); changed = true;
    }
    if (changed) this.version++;
  }
  hover(path: string, position: number, locale: SaturnLocale = 'ru'): HoverDocumentation | null {
    const file = projectPath(path), info = this.service.getQuickInfoAtPosition(file, position);
    if (!info) return null;
    const plain = (parts?: ts.SymbolDisplayPart[]) => ts.displayPartsToString(parts);
    const tags = (info.tags ?? []).map(tag => ({ name: tag.name, text: plain(tag.text) }));
    let documentation = plain(info.documentation);
    // Localized canonical docs are shared with the DSL guide. Resolve the symbol first:
    // aliases work, while comments, unrelated strings and shadowing cannot borrow DSL docs.
    const definition = this.service.getDefinitionAtPosition(file, position)?.find(item =>
      /^\/sdk\/plant\/(dsl|reporting)\.d\.ts$/.test(item.fileName));
    const entity = definition && localizedDslEntity(definition.name, locale);
    if (entity) {
      documentation = [entity.summary, entity.note].filter(Boolean).join('\n\n');
      if (!tags.some(tag => tag.name === 'example')) tags.push({ name: 'example', text: entity.example });
    }
    return { from: info.textSpan.start, to: info.textSpan.start + info.textSpan.length,
      signature: plain(info.displayParts), documentation, tags };
  }
  dispose(): void { this.service.dispose(); }
}
