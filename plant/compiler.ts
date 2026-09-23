import ts from '@typescript/typescript6';
import * as dsl from './dsl';
import type { Project } from './types';
import { failCode, SaturnDiagnosticError } from './diagnostics';
import { validateProject } from './project-validation';
export { validateProject, refs } from './project-validation';
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
export function projectPath(path: string): boolean { return /^[A-Za-z0-9_/-]+\.(ts|sql|html|md|json|css)$/.test(path) && !path.startsWith('/') && !path.split('/').some(p => p === '..' || p === '.' || !p); }
export function validateFiles(files: Record<string, string>): void {
    if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length > 128)
        failCode('SATURN_PROJECT_INVALID',{reason:'malformed'},{field:'files'});
    let total = 0;
    for (const [path, content] of Object.entries(files)) {
        if (!projectPath(path) || typeof content !== 'string' || content.includes('\0') || content.length > 200000)
            failCode('SATURN_PROJECT_INVALID',{reason:'malformed'},{field:'file',path});
        total += new TextEncoder().encode(content).length;
    }
    if (total > 2000000)
        failCode('SATURN_LIMIT',{resource:'project',reason:'tooLarge'},{limitBytes:2000000});
}
/** Build trusted authored TypeScript into the canonical Saturn IR.
 *
 * TypeScript is the language. Saturn no longer interprets a TypeScript-shaped subset.
 * The browser/offline builder deliberately resolves only local modules + @saturn/core;
 * native hosts may provide package resolution before this boundary.
 */
export function compileProject(files: Record<string, string>, entry = files['src/plant.ts'] !== undefined ? 'src/plant.ts' : 'plant.ts'): Project {
    validateFiles(files);
    const cache = new Map<string, Record<string, unknown>>();
    const loading = new Set<string>();

    const normalize = (path: string): string => {
        const parts: string[] = [];
        for (const part of path.replaceAll('\\\\','/').split('/')) {
            if (!part || part === '.') continue;
            if (part === '..') {
                if (!parts.length) failCode('SATURN_DSL_INVALID',{reason:'importEscape'},{path});
                parts.pop();
            } else parts.push(part);
        }
        return parts.join('/');
    };

    const dirname = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const resolveLocal = (from: string, specifier: string): string => {
        const base = normalize([dirname(from), specifier].filter(Boolean).join('/'));
        const candidates = /\.ts$/.test(base)
            ? [base]
            : [base + '.ts', base + '/index.ts'];
        const found = candidates.find(path => Object.prototype.hasOwnProperty.call(files, path));
        if (!found) failCode('SATURN_NOT_FOUND',{resource:'module',id:specifier},{from,specifier,candidates});
        return found;
    };

    const diagnostic = (path: string, d: ts.Diagnostic): never => {
        const start = d.start ?? 0;
        const source = d.file;
        const point = source ? source.getLineAndCharacterOfPosition(start) : { line: 0, character: 0 };
        failCode('SATURN_DSL_INVALID',{reason:'typescript'},{
            path,
            typescript: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
            source: { path, from:start, to:start+(d.length ?? 1), line:point.line, character:point.character },
        });
    };

    const load = (path: string): Record<string, unknown> => {
        path = normalize(path);
        const existing = cache.get(path);
        if (existing) return existing;
        if (loading.has(path)) failCode('SATURN_DSL_INVALID',{reason:'cycle'},{path});
        const source = files[path];
        if (typeof source !== 'string' || !/\.ts$/.test(path))
            failCode('SATURN_NOT_FOUND',{resource:'module',id:path},{path});

        const transpiled = ts.transpileModule(source, {
            fileName: path,
            reportDiagnostics: true,
            compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.CommonJS,
                esModuleInterop: true,
                isolatedModules: true,
                sourceMap: false,
            },
        });
        const error = transpiled.diagnostics?.find(item => item.category === ts.DiagnosticCategory.Error);
        if (error) diagnostic(path, error);

        loading.add(path);
        const module = { exports: Object.create(null) as Record<string, unknown> };
        cache.set(path, module.exports);

        const require = (specifier: string): Record<string, unknown> => {
            if (specifier === '@saturn/core') return dsl as unknown as Record<string, unknown>;
            if (specifier.startsWith('./') || specifier.startsWith('../')) return load(resolveLocal(path, specifier));
            failCode('SATURN_DSL_INVALID',{reason:'externalPackageRequiresHost'},{path,specifier});
        };

        try {
            const execute = new Function(
                'exports','module','require','__filename','__dirname',
                'globalThis','self','window','process','Bun','Deno','fetch','WebSocket','Worker','XMLHttpRequest',
                `"use strict";\n${transpiled.outputText}\n//# sourceURL=saturn-project://${path}`,
            ) as (...args: unknown[]) => void;
            execute(
                module.exports, module, require, path, dirname(path),
                undefined, undefined, undefined, undefined, undefined, undefined,
                undefined, undefined, undefined, undefined,
            );
            cache.set(path, module.exports);
            return module.exports;
        } catch (error) {
            cache.delete(path);
            if (error instanceof SaturnDiagnosticError) {
                error.diagnostic.data = { path, ...(error.diagnostic.data ?? {}) };
            }
            throw error;
        } finally {
            loading.delete(path);
        }
    };

    const output = load(entry);
    const result = output.default ?? output.plant;
    validateProject(result);
    return result as Project;
}
