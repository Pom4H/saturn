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
/** Bounded AST interpreter. Local imports read a supplied immutable file map, never the filesystem. */
export function compileProject(files: Record<string, string>, entry = 'plant.ts'): Project {
    validateFiles(files);
    const cache = new Map<string, Record<string, unknown>>(), visiting = new Set<string>();
    let steps = 0;
    const builtins = Object.fromEntries(Object.entries(dsl).filter(([, v]) => typeof v === 'function'));
    function module(path: string): Record<string, unknown> {
        if (cache.has(path))
            return cache.get(path)!;
        if (visiting.has(path))
            failCode('SATURN_DSL_INVALID',{reason:'cycle'},{path});
        if (!projectPath(path) || !own(files, path) || !path.endsWith('.ts'))
            failCode('SATURN_NOT_FOUND',{resource:'module',id:path},{path});
        visiting.add(path);
        const scanner = ts.createScanner(ts.ScriptTarget.Latest, true);
        scanner.setText(files[path]);
        let nesting = 0;
        for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
            if (++steps > 60000)
                failCode('SATURN_LIMIT',{resource:'project',reason:'evaluationLimit'},{steps});
            if ([ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.OpenBracketToken, ts.SyntaxKind.OpenParenToken].includes(token))
                nesting++;
            if ([ts.SyntaxKind.CloseBraceToken, ts.SyntaxKind.CloseBracketToken, ts.SyntaxKind.CloseParenToken].includes(token))
                nesting--;
            if (nesting > 64)
                failCode('SATURN_LIMIT',{resource:'project',reason:'nestingLimit'},{nesting});
        }
        const file = ts.createSourceFile(path, files[path], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const diagnostics = (file as ts.SourceFile & {
            parseDiagnostics: readonly ts.Diagnostic[];
        }).parseDiagnostics;
        if (diagnostics.length)
            failCode('SATURN_DSL_INVALID',{reason:'malformed'},{path,typescript:ts.flattenDiagnosticMessageText(diagnostics[0].messageText,' ')});
        const scope: Record<string, unknown> = Object.create(null), exports: Record<string, unknown> = Object.create(null);
        const fail = (n: ts.Node, reason: string, data: Record<string, unknown> = {}): never => {
            const start=n.getStart(file), end=n.getEnd(), point=file.getLineAndCharacterOfPosition(start);
            failCode('SATURN_DSL_INVALID',{reason},{...data,source:{path,from:start,to:end,line:point.line,character:point.character}});
        };
        const key = (n: ts.PropertyName): string => { if (!(ts.isIdentifier(n) || ts.isStringLiteral(n)) || reserved.has(n.text))
            return fail(n,'unsafeName'); return n.text; };
        function evalNode(n: ts.Expression, depth = 0): unknown {
            if (++steps > 60000 || depth > 64)
                return fail(n,'evaluationLimit');
            const ev = (x: ts.Expression) => evalNode(x, depth + 1);
            if (ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isParenthesizedExpression(n))
                return ev(n.expression);
            if (ts.isNumericLiteral(n))
                return Number(n.text);
            if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
                return n.text;
            if (n.kind === ts.SyntaxKind.TrueKeyword)
                return true;
            if (n.kind === ts.SyntaxKind.FalseKeyword)
                return false;
            if (ts.isIdentifier(n)) {
                if (!own(scope, n.text))
                    return fail(n,'unknown',{name:n.text});
                return scope[n.text];
            }
            if (ts.isPrefixUnaryExpression(n)) {
                const v = ev(n.operand);
                if (typeof v !== 'number')
                    return fail(n,'numericRequired');
                if (n.operator === ts.SyntaxKind.MinusToken)
                    return -v;
                if (n.operator === ts.SyntaxKind.PlusToken)
                    return v;
                return fail(n,'unsupportedOperator');
            }
            if (ts.isBinaryExpression(n)) {
                const a = ev(n.left), b = ev(n.right);
                if (typeof a !== 'number' || typeof b !== 'number')
                    return fail(n,'declarativeOnly');
                switch (n.operatorToken.kind) {
                    case ts.SyntaxKind.PlusToken: return a + b;
                    case ts.SyntaxKind.MinusToken: return a - b;
                    case ts.SyntaxKind.AsteriskToken: return a * b;
                    case ts.SyntaxKind.SlashToken:
                        if (b === 0)
                            return fail(n,'divisionByZero');
                        return a / b;
                    default: return fail(n,'unsupportedOperator');
                }
            }
            if (ts.isArrayLiteralExpression(n)) {
                const result: unknown[] = [];
                for (const x of n.elements) {
                    const items = ts.isSpreadElement(x) ? ev(x.expression) : [ev(x as ts.Expression)];
                    if (!Array.isArray(items) || result.length + items.length > 2048)
                        return fail(x,'arrayLimit');
                    result.push(...items);
                }
                return result;
            }
            if (ts.isObjectLiteralExpression(n)) {
                const out = Object.create(null);
                for (const p of n.properties) {
                    if (ts.isPropertyAssignment(p)) {
                        const k = key(p.name);
                        if (own(out, k))
                            fail(p,'duplicate',{property:k});
                        out[k] = ev(p.initializer);
                    }
                    else if (ts.isShorthandPropertyAssignment(p)) {
                        const k = key(p.name);
                        out[k] = ev(p.name);
                    }
                    else if (ts.isSpreadAssignment(p)) {
                        const v = ev(p.expression);
                        if (!v || typeof v !== 'object' || Array.isArray(v))
                            return fail(p,'malformed',{field:'objectSpread'});
                        if (Object.keys(v).length + Object.keys(out).length > 1024)
                            return fail(p,'objectLimit');
                        Object.assign(out, v);
                    }
                    else
                        return fail(p,'methodsForbidden');
                }
                return out;
            }
            if (ts.isPropertyAccessExpression(n)) {
                const o = ev(n.expression), k = n.name.text;
                if (!o || typeof o !== 'object' || reserved.has(k) || !own(o, k))
                    return fail(n,'unknown',{field:k});
                return o[k];
            }
            if (ts.isElementAccessExpression(n)) {
                if (!n.argumentExpression || !ts.isStringLiteral(n.argumentExpression))
                    return fail(n,'literalKeyRequired');
                const o = ev(n.expression), k = n.argumentExpression.text;
                if (!o || typeof o !== 'object' || reserved.has(k) || !own(o, k))
                    return fail(n,'unknown',{field:k});
                return o[k];
            }
            if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
                const fn = scope[n.expression.text];
                if (typeof fn !== 'function' || !Object.values(builtins).includes(fn))
                    return fail(n,'installedDslOnly');
                try {
                    return fn(...n.arguments.map(ev));
                } catch (error) {
                    if (error instanceof SaturnDiagnosticError) {
                        const start = n.getStart(file), end = n.getEnd();
                        const point = file.getLineAndCharacterOfPosition(start);
                        error.diagnostic.data = {
                            ...(error.diagnostic.data ?? {}),
                            source: { path, from: start, to: end, line: point.line, character: point.character },
                        };
                    }
                    throw error;
                }
            }
            return fail(n,'declarativeOnly');
        }
        for (const statement of file.statements) {
            if (ts.isImportDeclaration(statement)) {
                if (!ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings))
                    fail(statement,'namedImports');
                const spec = (statement.moduleSpecifier as ts.StringLiteral).text;
                let source: Record<string, unknown>;
                if (spec === '@saturn/core')
                    source = builtins;
                else {
                    if (!spec.startsWith('./') && !spec.startsWith('../'))
                        fail(statement,'localImportsOnly');
                    const parts = path.split('/');
                    parts.pop();
                    for (const part of spec.split('/')) {
                        if (part === '.')
                            continue;
                        if (part === '..') {
                            if (!parts.length)
                                fail(statement,'importEscape');
                            parts.pop();
                        }
                        else
                            parts.push(part);
                    }
                    let target = parts.join('/');
                    if (!target.endsWith('.ts'))
                        target += '.ts';
                    source = module(target);
                }
                for (const imp of (statement.importClause!.namedBindings as ts.NamedImports).elements) {
                    const name = imp.propertyName?.text ?? imp.name.text;
                    if (!own(source, name) || reserved.has(imp.name.text) || own(scope, imp.name.text))
                        fail(imp,'unknown',{kind:'import'});
                    scope[imp.name.text] = source[name];
                }
            }
            else if (ts.isVariableStatement(statement)) {
                if (!(statement.declarationList.flags & ts.NodeFlags.Const))
                    fail(statement,'constOnly');
                for (const declaration of statement.declarationList.declarations) {
                    if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
                        fail(declaration,'initializedConst');
                    const name = (declaration.name as ts.Identifier).text;
                    if (reserved.has(name) || own(scope, name))
                        fail(declaration,'unsafeName');
                    scope[name] = evalNode(declaration.initializer!);
                    if (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
                        exports[name] = scope[name];
                }
            }
            else if (ts.isExportAssignment(statement))
                exports.default = evalNode(statement.expression);
            else if (ts.isEmptyStatement(statement))
                continue;
            else
                fail(statement,'declarativeOnly');
        }
        visiting.delete(path);
        cache.set(path, exports);
        return exports;
    }
    const output = module(entry), result = output.default ?? output.plant;
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
        for (const column of r.columns) {
            id(column.key);
            if (typeof column.title !== 'string' || column.title.length > 150)
                failCode('SATURN_REPORT_INVALID',{report:r.id,reason:'invalid'},{field:'column'});
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
