import { validatePresentation, presentationActions } from './presentation';
import { compileController, inputPins } from './controller';
import { validateConnections, terminals, connectionExpression } from './ports';
import ts from '@typescript/typescript6';
import * as dsl from './dsl';
import { model, models } from './models';
import { finite, id, type Project, type Expr } from './types';
import { validateCron } from './workflows';
import { failCode, SaturnDiagnosticError } from './diagnostics';
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
        const candidates = /\.(?:ts|tsx)$/.test(base)
            ? [base]
            : [base + '.ts', base + '.tsx', base + '/index.ts', base + '/index.tsx'];
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
        if (typeof source !== 'string' || !/\.(?:ts|tsx)$/.test(path))
            failCode('SATURN_NOT_FOUND',{resource:'module',id:path},{path});

        const transpiled = ts.transpileModule(source, {
            fileName: path,
            reportDiagnostics: true,
            compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.CommonJS,
                moduleResolution: ts.ModuleResolutionKind.Bundler,
                jsx: ts.JsxEmit.ReactJSX,
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
export function refs(expr: Expr): string[] { if (typeof expr === 'number' || typeof expr === 'boolean')
    return []; if ('ref' in expr)
    return [expr.ref]; return expr.args.flatMap(refs); }
export function validateProject(value: unknown): asserts value is Project {
    if (!value || typeof value !== 'object')
        failCode('SATURN_PROJECT_INVALID',{reason:'defaultProject'});
    const p = value as Project;
    id(p.id);
    if (p.version !== 1 || typeof p.title !== 'string' || p.title.length > 150)
        failCode('SATURN_PROJECT_INVALID',{reason:'malformed'});
    finite(p.stepMs, 'stepMs', 20, 1000);
    for (const k of ['systems', 'simulations', 'signals', 'devices', 'alarms', 'reports'] as const)
        if (!Array.isArray(p[k]) || p[k].length > 512)
            failCode('SATURN_PROJECT_INVALID',{reason:'invalid'},{field:k});
    if (!p.systems.length || !p.simulations.length || typeof p.description !== 'string' || p.description.length > 2000)
        failCode('SATURN_PROJECT_INVALID',{reason:'malformed'},{field:'description'});
    if (p.simulations.length > 256 || p.reports.length > 32)
        failCode('SATURN_LIMIT',{resource:'project',reason:'tooMany'});
    const unique = (values: string[]) => { const s = new Set<string>(); for (const v of values) {
        id(v);
        if (s.has(v))
            failCode('SATURN_PROJECT_INVALID',{reason:'duplicate'},{id:v});
        s.add(v);
    } return s; };
    const groups = unique(p.systems.map(s => s.id));
    for (const s of p.systems) {
        if (typeof s.title !== 'string' || s.title.length > 150)
            failCode('SATURN_PROJECT_INVALID',{reason:'invalid'},{field:'system.title'});
        let parent = s.parent;
        const visited = new Set([s.id]);
        while (parent) {
            if (!groups.has(parent) || visited.has(parent))
                failCode('SATURN_PROJECT_INVALID',{reason:'cycle'},{system:s.id});
            visited.add(parent);
            parent = p.systems.find(g => g.id === parent)?.parent;
        }
    }
    if(!Array.isArray(p.controllers??[])||(p.controllers?.length??0)>4) failCode('SATURN_LIMIT',{resource:'plc',reason:'tooMany'},{max:4});
    unique([...(p.controllers??[]).map(c=>c.id), ...p.simulations.map(n => n.id)]);
    for(const c of p.controllers??[]) { if(!groups.has(c.system))failCode('SATURN_PROJECT_INVALID',{reason:'missing'},{field:'plc.system'});compileController(c); }
    unique(p.simulations.map(n => n.id));
    unique(p.devices.map(n => n.id));
    unique(p.alarms.map(a => a.id));
    unique(p.reports.map(r => r.id));
    if (p.controls !== undefined && (!Array.isArray(p.controls) || p.controls.length > 128))
        failCode('SATURN_LIMIT',{resource:'controls',reason:'tooMany'},{max:128});
    unique([...(p.controls ?? []).map(c => c.id), ...(p.controllers??[]).map(c=>c.id), ...p.simulations.map(n => n.id)]);
    const signals = unique([...(p.controls ?? []).flatMap(c => ['value', 'requested', 'blocked'].map(k => `${c.id}.${k}`)), ...p.simulations.flatMap(n => Object.keys(model(n.model).outputs).map(k => `${n.id}.${k}`)), ...(p.controllers??[]).flatMap(c=>[...Object.keys(c.outputs),...Object.keys(inputPins),'healthy','powered'].map(k=>`${c.id}.${k}`)), ...p.signals.map(s => s.id)]);
    let expressions = 0;
    const checkExpr = (e: Expr, depth = 0): void => { if (++expressions > 20000)
        failCode('SATURN_LIMIT',{resource:'expression',reason:'tooMany'}); if (depth > 32)
        failCode('SATURN_LIMIT',{resource:'expression',reason:'nestingLimit'}); if (typeof e === 'number') {
        finite(e, 'Expression');
        return;
    } if (typeof e === 'boolean')
        return; if (!e || typeof e !== 'object')
        failCode('SATURN_DSL_INVALID',{reason:'malformed'},{kind:'expression'}); if ('ref' in e) {
        if (!signals.has(e.ref))
            failCode('SATURN_DSL_UNKNOWN',{kind:'signal',name:e.ref},{signal:e.ref});
        return;
    } if (!['add', 'mul', 'sub', 'div', 'min', 'max', 'gt', 'lt', 'not', 'and'].includes(e.op) || !Array.isArray(e.args) || e.args.length < 1 || e.args.length > 256)
        failCode('SATURN_DSL_INVALID',{reason:'unsupportedOperator'}); if (e.op === 'not' && e.args.length !== 1)
        failCode('SATURN_DSL_INVALID',{reason:'malformed'},{operator:'not',arity:1}); if (['sub', 'div', 'gt', 'lt'].includes(e.op) && e.args.length !== 2)
        failCode('SATURN_DSL_INVALID',{reason:'malformed'},{arity:2}); for (const v of e.args)
        checkExpr(v, depth + 1); };
    for (const c of p.controls ?? []) {
        if (!groups.has(c.system) || typeof c.title !== 'string' || !c.title.trim() || c.title.length > 150 || typeof c.unit !== 'string' || c.unit.length > 32)
            failCode('SATURN_PROJECT_INVALID',{reason:'malformed'},{field:'control'});
        finite(c.min, 'control min'); finite(c.max, 'control max', c.min); finite(c.initial, 'control initial', c.min, c.max);
        finite(c.rate, 'control rate', .000001, 1e6); finite(c.step, 'control step', .000001, 1e6);
        if (c.enableWhen !== undefined) {
            checkExpr(c.enableWhen);
            finite(c.safeValue, 'interlocked control safeValue', c.min, c.max);
            if (typeof c.blockedReason !== 'string' || !c.blockedReason.trim() || c.blockedReason.length > 200)
                failCode('SATURN_PROJECT_INVALID',{reason:'missing'},{field:'control.blockedReason'});
        }
    }
    for (const n of p.simulations) {
        const m = model(n.model);
        if (!groups.has(n.system))
            failCode('SATURN_DSL_UNKNOWN',{kind:'system',name:n.system},{system:n.system});
        for (const [k, v] of Object.entries(n.parameters)) {
            const d = m.parameters[k];
            if (!d)
                failCode('SATURN_DSL_UNKNOWN',{kind:'parameter',name:`${n.id}.${k}`},{device:n.id,parameter:k});
            finite(v, `${n.id}.${k}`, d.min, d.max);
        }
        for (const k of Object.keys(m.parameters))
            if (!(k in n.parameters))
                failCode('SATURN_PROJECT_INVALID',{reason:'missing'},{field:'parameter',name:k});
        for (const k of Object.keys(m.inputs))
            if (!(k in n.inputs))
                failCode('SATURN_PROJECT_INVALID',{reason:'missing'},{field:'input',name:k});
        for (const [k, v] of Object.entries(n.inputs)) {
            if (!(k in m.inputs))
                failCode('SATURN_DSL_UNKNOWN',{kind:'input',name:`${n.id}.${k}`},{device:n.id,input:k});
            checkExpr(v);
        }
        finite(n.layout.x, 'x', -5000, 10000);
        finite(n.layout.y, 'y', -5000, 10000);
    }
    validateConnections(p);
    for(const w of p.connections??[]) {
        const expression=connectionExpression(p,w);if(expression!==undefined)checkExpr(expression);
        const dst=p.devices.find(d=>d.id===w.to.device)!;const terminal=terminals(dst.type)[w.to.port];
        if(terminal.input) { const sim=p.simulations.find(n=>n.id===dst.id);if(!sim||!(terminal.input in model(sim.model).inputs))failCode('SATURN_PROJECT_INVALID',{reason:'missing'},{field:'port.input',connection:w.id}); }
    }
    const visited = new Set<string>(), active = new Set<string>(), derived = new Map(p.signals.map(s => [s.id, s]));
    function visit(name: string) { if (visited.has(name))
        return; if (active.has(name))
        failCode('SATURN_PROJECT_INVALID',{reason:'cycle'},{signal:name}); active.add(name); const s = derived.get(name); if (s) {
        checkExpr(s.expression);
        for (const r of refs(s.expression))
            visit(r);
    } active.delete(name); visited.add(name); }
    p.signals.forEach(s => visit(s.id));
    for (const d of p.devices) {
        if (!groups.has(d.system))
            failCode('SATURN_PROJECT_INVALID',{reason:'unknown'},{field:'device.system'});
        if (typeof d.type !== 'string' || !(d.type==='saturn'||models().some(m => m.visual === d.type)))
            failCode('SATURN_PROJECT_INVALID',{reason:'invalid'},{field:'device.type'});
        finite(d.layout.x, 'device x', -5000, 10000);
        finite(d.layout.y, 'device y', -5000, 10000);
        Object.values(d.signals).forEach(e => checkExpr(e));
    }
    for (const a of p.alarms) {
        checkExpr(a.signal);
        finite(a.above, a.id);
        finite(a.clearBelow, a.id);
        finite(a.delay, 'alarm delay', 0, 3600000);
        if (a.clearBelow > a.above || !['warning', 'critical'].includes(a.priority))
            failCode('SATURN_PROJECT_INVALID',{reason:'invalid'},{field:'alarm.hysteresis'});
    }
    const history = (h: Project['history']) => { finite(h.deadband, 'deadband', 0, 1e6); finite(h.maxInterval, 'maxInterval', p.stepMs, 86400000); finite(h.retention, 'retention', 60000, 10 * 365 * 86400000); };
    history(p.history);
    for (const s of p.signals)
        if (s.history)
            history(s.history);
    for (const n of p.simulations)
        for (const [key, value] of Object.entries(n.history ?? {})) {
            if (!(key in model(n.model).outputs))
                failCode('SATURN_DSL_UNKNOWN',{kind:'archivedSignal',name:key},{signal:key});
            history(value);
        }
    if (p.overview && (!Array.isArray(p.overview) || p.overview.length > 12))
        failCode('SATURN_LIMIT',{resource:'overview',reason:'tooMany'},{max:12});
    for (const m of p.overview ?? []) {
        if (!signals.has(m.signal) || typeof m.label !== 'string' || typeof m.unit !== 'string')
            failCode('SATURN_PROJECT_INVALID',{reason:'invalid'},{field:'overview'});
        if (m.alarmAbove !== undefined)
            finite(m.alarmAbove, 'metric threshold');
    }
    if(p.views&&(!Array.isArray(p.views)||p.views.length>32))failCode('SATURN_LIMIT',{resource:'presentations',reason:'tooMany'},{max:32});
    const viewIds=new Set<string>();
    for(const view of p.views??[]){
        validatePresentation(view);if(viewIds.has(view.id))failCode('SATURN_PROJECT_INVALID',{reason:'duplicate'},{field:'presentation'});viewIds.add(view.id);
        for(const expr of Object.values(view.bindings))checkExpr(expr);
        for(const action of presentationActions(view.body)){
            const control=p.controls?.find(c=>c.id===action.target);
            if(!control||action.value<control.min||action.value>control.max)failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{field:'action.target'});
        }
    }
    for (const r of p.reports) {
        if(r.view){validatePresentation(r.view,'report');for(const expr of Object.values(r.view.bindings)){checkExpr(expr);for(const ref of refs(expr))if(!r.signals.includes(ref))failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'unknown'},{signal:ref});}}

        if (!r.on || !Array.isArray(r.signals) || !r.signals.length || r.signals.some(s => !signals.has(s)))
            failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'invalid'},{field:'signals'});
        if (typeof r.sql !== 'string' || r.sql.length > 20000 || !r.columns?.length)
            failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'malformed'},{field:'sql/columns'});
        if (typeof r.title !== 'string' || r.title.length > 150 || r.columns.length > 32 || (r.on.schedule?.length ?? 0) > 8 || Object.keys(r.on.workflow_dispatch?.inputs ?? {}).length > 16)
            failCode('SATURN_LIMIT',{resource:'report',reason:'tooMany'},{report:r.id});
        if (r.description !== undefined && (typeof r.description !== 'string' || r.description.length > 500))
            failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'invalid'},{field:'description'});
        for (const column of r.columns) {
            id(column.key);
            if (typeof column.title !== 'string' || column.title.length > 150 || (column.unit !== undefined && (typeof column.unit !== 'string' || column.unit.length > 30)))
                failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'invalid'},{field:'column'});
        }
        if (r.summary !== undefined) {
            if (!Array.isArray(r.summary) || r.summary.length > 8)
                failCode('SATURN_LIMIT',{resource:'report.summary',reason:'tooMany'},{report:r.id,max:8});
            for (const metric of r.summary) {
                id(metric.key);
                if (typeof metric.label !== 'string' || !metric.label.trim() || metric.label.length > 100 || !['sum','avg','min','max','last'].includes(metric.aggregate))
                    failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'invalid'},{field:'summary'});
                if (metric.unit !== undefined && (typeof metric.unit !== 'string' || metric.unit.length > 30))
                    failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'invalid'},{field:'summary.unit'});
                if (metric.digits !== undefined && (!Number.isInteger(metric.digits) || metric.digits < 0 || metric.digits > 6))
                    failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'range'},{field:'summary.digits'});
                if (metric.emphasis !== undefined && !['primary','secondary'].includes(metric.emphasis))
                    failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'invalid'},{field:'summary.emphasis'});
            }
        }
        if (r.chart) {
            id(r.chart.x); id(r.chart.y);
            if (typeof r.chart.title !== 'string' || !r.chart.title.trim() || r.chart.title.length > 150 || (r.chart.type !== undefined && !['line','bar'].includes(r.chart.type)) || (r.chart.unit !== undefined && (typeof r.chart.unit !== 'string' || r.chart.unit.length > 30)))
                failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'invalid'},{field:'chart'});
        }
        if (r.schema) {
            if (!Array.isArray(r.schema) || !r.schema.length || r.schema.length > 64)
                failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'schema'},{field:'schema'});
            const schemaKeys = unique(r.schema.map(field => field.key));
            for (const field of r.schema) {
                if (!['number', 'boolean', 'string', 'datetime'].includes(field.type) || (field.unit !== undefined && (typeof field.unit !== 'string' || field.unit.length > 32)))
                    failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'schema'},{field:'schema.field'});
            }
            if (r.columns.some(column => !schemaKeys.has(column.key)))
                failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'schema'},{field:'columns'});
            for (const sheet of r.excel?.sheets ?? []) {
                if (typeof sheet.name !== 'string' || !sheet.name || sheet.name.length > 31 || !Array.isArray(sheet.columns) || !sheet.columns.length || sheet.columns.length > 64)
                    failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'invalid'},{field:'excel.sheet'});
                for (const column of sheet.columns)
                    if (!schemaKeys.has(column.key) || typeof column.title !== 'string' || (column.width !== undefined && (!Number.isFinite(column.width) || column.width <= 0 || column.width > 200)))
                        failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'invalid'},{field:'excel.column'});
                for (const sort of sheet.sort ?? [])
                    if (!schemaKeys.has(sort.key) || !['asc', 'desc'].includes(sort.direction))
                        failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'invalid'},{field:'excel.sort'});
                if (sheet.freezeRows !== undefined && (!Number.isInteger(sheet.freezeRows) || sheet.freezeRows < 0 || sheet.freezeRows > 100))
                    failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'range'},{field:'excel.freezeRows'});
            }
        } else if (r.excel) {
            failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'missing'},{field:'schema'});
        }
        for (const s of r.on.schedule ?? [])
            validateCron(s.cron);
        finite(r.window, 'report window', 1000, 7 * 86400000);
        for (const [k, d] of Object.entries(r.on.workflow_dispatch?.inputs ?? {})) {
            id(k);
            if (['from', 'to'].includes(k) || d.type !== 'number')
                failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'invalid'},{field:'workflow_dispatch.input'});
            finite(d.min, k);
            finite(d.max, k, d.min);
            finite(d.default, k, d.min, d.max);
        }
    }
}
