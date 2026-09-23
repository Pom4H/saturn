import { EditorView, ViewPlugin, hoverTooltip, tooltips } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { DslLibrary, SaturnLanguageService, HoverDocumentation } from './language-service';
import { localeFromLanguage } from '../plant/i18n';
import type { SaturnLocale } from '../plant/diagnostics';

export interface DslHoverOptions {
  files: () => Record<string, string>;
  path: () => string;
  locale?: () => SaturnLocale;
  libraryUrl?: () => URL;
}
const libraries = new Map<string, Promise<DslLibrary>>();
function library(url: URL): Promise<DslLibrary> {
  let pending = libraries.get(url.href);
  if (!pending) {
    pending = fetch(url).then(async response => {
      if (!response.ok) throw new Error(`Saturn DSL library: HTTP ${response.status}`);
      return await response.json() as DslLibrary;
    }).catch(error => { libraries.delete(url.href); throw error; });
    libraries.set(url.href, pending);
  }
  return pending;
}
function render(info: HoverDocumentation): HTMLElement {
  const dom = document.createElement('section'); dom.className = 'saturn-jsdoc';
  const signature = document.createElement('pre'); signature.className = 'saturn-jsdoc-signature';
  signature.textContent = info.signature; dom.append(signature);
  if (info.documentation) { const summary = document.createElement('p'); summary.textContent = info.documentation; dom.append(summary); }
  for (const tag of info.tags) {
    const title = document.createElement('strong'); title.textContent = '@' + tag.name; dom.append(title);
    const text = document.createElement(tag.name === 'example' ? 'pre' : 'p'); text.textContent = tag.text; dom.append(text);
  }
  return dom;
}
/** Shared by the landing, full IDE and workbench. Safe text rendering, lazy SDK, no network authority in project code. */
export function dslHover(options: DslHoverOptions): Extension {
  const plugin = ViewPlugin.fromClass(class {
    service?: SaturnLanguageService; pending?: Promise<SaturnLanguageService>; disposed = false;
    async get(): Promise<SaturnLanguageService | null> {
      if (this.disposed) return null;
      this.pending ??= Promise.all([import('./language-service'), library(options.libraryUrl?.() ?? new URL('./site/assets/dsl-library.json', document.baseURI))])
        .then(([module, sdk]) => {
          const service = new module.SaturnLanguageService(sdk);
          if (this.disposed) service.dispose(); else this.service = service;
          return service;
        }).catch(error => { this.pending = undefined; throw error; });
      const service = await this.pending;
      return this.disposed ? null : service;
    }
    destroy(): void { this.disposed = true; this.service?.dispose(); }
  });
  return [plugin, tooltips({ parent: document.body }), hoverTooltip(async (view, position, side) => {
    if (!/\.tsx?$/.test(options.path())) return null;
    const documentAtRequest = view.state.doc, path = options.path();
    try {
      const service = await view.plugin(plugin)?.get();
      if (!service || view.state.doc !== documentAtRequest || options.path() !== path) return null;
      service.update({ ...options.files(), [path]: documentAtRequest.toString() });
      const info = service.hover(path, position, options.locale?.() ?? localeFromLanguage(document.documentElement.lang || navigator.language));
      if (!info || position === info.from && side < 0 || position === info.to && side > 0) return null;
      return { pos: info.from, end: info.to, above: true, create: () => ({ dom: render(info) }) };
    } catch (error) { console.warn('Saturn hover documentation unavailable', error); return null; }
  }, { hoverTime: 250 }), EditorView.baseTheme({
    '.cm-tooltip.cm-tooltip-hover:has(.saturn-jsdoc)': { border: '1px solid var(--line, #a8bec8)', background: 'var(--panel, var(--bg, #fafafa))', color: 'var(--text, #202b32)', borderRadius: '6px', boxShadow: '0 8px 24px #0002' },
    '.saturn-jsdoc': { padding: '14px 16px', width: 'max-content', maxWidth: 'min(520px, calc(100vw - 36px))', maxHeight: 'min(420px, 65vh)', overflow: 'auto', boxSizing: 'border-box', fontSize: '13px', lineHeight: '1.55' },
    '.saturn-jsdoc pre': { fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: '12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '8px 0' },
    '.saturn-jsdoc p': { whiteSpace: 'pre-wrap', margin: '8px 0' },
    '.saturn-jsdoc-signature': { color: 'var(--code-function, #2256a8)', maxHeight: '90px', overflow: 'auto' },
    '.saturn-jsdoc strong': { color: 'var(--muted, #637784)', fontSize: '11px' },
  })];
}
