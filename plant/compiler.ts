import ts from '@typescript/typescript6';
import * as dsl from './dsl';
import { model, models } from './models';
import { AppError, finite, id, type Project, type Expr } from './types';
import { validateCron } from './workflows';
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
export function projectPath(path: string): boolean { return /^[A-Za-z0-9_/-]+\.(ts|sql|html|md|json|css)$/.test(path) && !path.startsWith('/') && !path.split('/').some(p => p === '..' || p === '.' || !p); }
export function validateFiles(files: Record<string, string>): void {
    if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length > 128)
        throw new AppError('Invalid project files');
    let total = 0;
    for (const [path, content] of Object.entries(files)) {
        if (!projectPath(path) || typeof content !== 'string' || content.includes('\0') || content.length > 200000)
            throw new AppError(`Invalid project file: ${path}`);
        total += new TextEncoder().encode(content).length;
    }
    if (total > 2000000)
        throw new AppError('Project exceeds 2 MB');
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
            throw new AppError(`Circular module import: ${path}`);
        if (!projectPath(path) || !own(files, path) || !path.endsWith('.ts'))
            throw new AppError(`Missing TS module: ${path}`);
        visiting.add(path);
        const scanner = ts.createScanner(ts.ScriptTarget.Latest, true);
        scanner.setText(files[path]);
        let nesting = 0;
        for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
            if (++steps > 60000)
                throw new AppError('Project is too complex');
            if ([ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.OpenBracketToken, ts.SyntaxKind.OpenParenToken].includes(token))
                nesting++;
            if ([ts.SyntaxKind.CloseBraceToken, ts.SyntaxKind.CloseBracketToken, ts.SyntaxKind.CloseParenToken].includes(token))
                nesting--;
            if (nesting > 64)
                throw new AppError('Project nesting limit');
        }
        const file = ts.createSourceFile(path, files[path], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const diagnostics = (file as ts.SourceFile & {
            parseDiagnostics: readonly ts.Diagnostic[];
        }).parseDiagnostics;
        if (diagnostics.length)
            throw new AppError(`${path}: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' ')}`);
        const scope = Object.create(null), exports = Object.create(null);
        const fail = (n: ts.Node, message: string): never => { const line = file.getLineAndCharacterOfPosition(n.getStart(file)); throw new AppError(`${path}:${line.line + 1}:${line.character + 1}: ${message}`); };
        const key = (n: ts.PropertyName): string => { if (!(ts.isIdentifier(n) || ts.isStringLiteral(n)) || reserved.has(n.text))
            return fail(n, 'Unsafe property name'); return n.text; };
        function evalNode(n: ts.Expression, depth = 0): any {
            if (++steps > 60000 || depth > 64)
                return fail(n, 'Evaluation limit');
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
                    return fail(n, `Unknown name: ${n.text}`);
                return scope[n.text];
            }
            if (ts.isPrefixUnaryExpression(n)) {
                const v = ev(n.operand);
                if (typeof v !== 'number')
                    return fail(n, 'Unary operator requires a number');
                if (n.operator === ts.SyntaxKind.MinusToken)
                    return -v;
                if (n.operator === ts.SyntaxKind.PlusToken)
                    return v;
                return fail(n, 'Unsupported operator');
            }
            if (ts.isBinaryExpression(n)) {
                const a = ev(n.left), b = ev(n.right);
                if (typeof a !== 'number' || typeof b !== 'number')
                    return fail(n, 'Use add/mul/sub/div for signal expressions');
                switch (n.operatorToken.kind) {
                    case ts.SyntaxKind.PlusToken: return a + b;
                    case ts.SyntaxKind.MinusToken: return a - b;
                    case ts.SyntaxKind.AsteriskToken: return a * b;
                    case ts.SyntaxKind.SlashToken:
                        if (b === 0)
                            return fail(n, 'Division by zero');
                        return a / b;
                    default: return fail(n, 'Unsupported operator');
                }
            }
            if (ts.isArrayLiteralExpression(n)) {
                const result: unknown[] = [];
                for (const x of n.elements) {
                    const items = ts.isSpreadElement(x) ? ev(x.expression) : [ev(x as ts.Expression)];
                    if (!Array.isArray(items) || result.length + items.length > 2048)
                        return fail(x, 'Array expansion limit');
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
                            fail(p, `Duplicate property: ${k}`);
                        out[k] = ev(p.initializer);
                    }
                    else if (ts.isShorthandPropertyAssignment(p)) {
                        const k = key(p.name);
                        out[k] = ev(p.name);
                    }
                    else if (ts.isSpreadAssignment(p)) {
                        const v = ev(p.expression);
                        if (!v || typeof v !== 'object' || Array.isArray(v))
                            return fail(p, 'Object spread requires an object');
                        if (Object.keys(v).length + Object.keys(out).length > 1024)
                            return fail(p, 'Object expansion limit');
                        Object.assign(out, v);
                    }
                    else
                        return fail(p, 'Methods and accessors are not allowed');
                }
                return out;
            }
            if (ts.isPropertyAccessExpression(n)) {
                const o = ev(n.expression), k = n.name.text;
                if (!o || typeof o !== 'object' || reserved.has(k) || !own(o, k))
                    return fail(n, `Unknown field: ${k}`);
                return o[k];
            }
            if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
                const fn = scope[n.expression.text];
                if (typeof fn !== 'function' || !Object.values(builtins).includes(fn))
                    return fail(n, 'Only installed DSL functions may be called');
                return fn(...n.arguments.map(ev));
            }
            return fail(n, 'Only declarative expressions are accepted; no executable project code');
        }
        for (const statement of file.statements) {
            if (ts.isImportDeclaration(statement)) {
                if (!ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings))
                    fail(statement, 'Use named imports');
                const spec = (statement.moduleSpecifier as ts.StringLiteral).text;
                let source: Record<string, unknown>;
                if (spec === '@scada/plant')
                    source = builtins;
                else {
                    if (!spec.startsWith('./') && !spec.startsWith('../'))
                        fail(statement, 'Only local modules or @scada/plant are allowed');
                    const parts = path.split('/');
                    parts.pop();
                    for (const part of spec.split('/')) {
                        if (part === '.')
                            continue;
                        if (part === '..') {
                            if (!parts.length)
                                fail(statement, 'Import escapes project');
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
                        fail(imp, 'Unknown or duplicate import');
                    scope[imp.name.text] = source[name];
                }
            }
            else if (ts.isVariableStatement(statement)) {
                if (!(statement.declarationList.flags & ts.NodeFlags.Const))
                    fail(statement, 'Only const declarations are supported');
                for (const declaration of statement.declarationList.declarations) {
                    if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
                        fail(declaration, 'Use an initialized const identifier');
                    const name = (declaration.name as ts.Identifier).text;
                    if (reserved.has(name) || own(scope, name))
                        fail(declaration, 'Duplicate or unsafe identifier');
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
                fail(statement, 'Only imports, const declarations and exports are allowed');
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
        throw new AppError('Export a project() as default');
    const p = value as Project;
    id(p.id);
    if (p.version !== 1 || typeof p.title !== 'string' || p.title.length > 150)
        throw new AppError('Invalid project');
    finite(p.stepMs, 'stepMs', 20, 1000);
    for (const k of ['systems', 'simulations', 'signals', 'devices', 'alarms', 'reports'] as const)
        if (!Array.isArray(p[k]) || p[k].length > 512)
            throw new AppError(`Invalid ${k}`);
    if (!p.systems.length || !p.simulations.length || typeof p.description !== 'string' || p.description.length > 2000)
        throw new AppError('Empty installation or invalid description');
    if (p.simulations.length > 256 || p.reports.length > 32)
        throw new AppError('Project size limit');
    const unique = (values: string[]) => { const s = new Set<string>(); for (const v of values) {
        id(v);
        if (s.has(v))
            throw new AppError(`Duplicate ID: ${v}`);
        s.add(v);
    } return s; };
    const groups = unique(p.systems.map(s => s.id));
    for (const s of p.systems) {
        if (typeof s.title !== 'string' || s.title.length > 150)
            throw new AppError('Invalid system title');
        let parent = s.parent;
        const visited = new Set([s.id]);
        while (parent) {
            if (!groups.has(parent) || visited.has(parent))
                throw new AppError(`Invalid system tree: ${s.id}`);
            visited.add(parent);
            parent = p.systems.find(g => g.id === parent)?.parent;
        }
    }
    unique(p.simulations.map(n => n.id));
    unique(p.devices.map(n => n.id));
    unique(p.alarms.map(a => a.id));
    unique(p.reports.map(r => r.id));
    if (p.controls !== undefined && (!Array.isArray(p.controls) || p.controls.length > 128))
        throw new AppError('At most 128 controls');
    unique([...(p.controls ?? []).map(c => c.id), ...p.simulations.map(n => n.id)]);
    const signals = unique([...(p.controls ?? []).flatMap(c => ['value', 'requested', 'blocked'].map(k => `${c.id}.${k}`)), ...p.simulations.flatMap(n => Object.keys(model(n.model).outputs).map(k => `${n.id}.${k}`)), ...p.signals.map(s => s.id)]);
    let expressions = 0;
    const checkExpr = (e: Expr, depth = 0): void => { if (++expressions > 20000)
        throw new AppError('Signal expression budget'); if (depth > 32)
        throw new AppError('Signal expression nesting limit'); if (typeof e === 'number') {
        finite(e, 'Expression');
        return;
    } if (typeof e === 'boolean')
        return; if (!e || typeof e !== 'object')
        throw new AppError('Invalid expression'); if ('ref' in e) {
        if (!signals.has(e.ref))
            throw new AppError(`Unknown signal: ${e.ref}`);
        return;
    } if (!['add', 'mul', 'sub', 'div', 'min', 'max', 'gt', 'lt', 'not', 'and'].includes(e.op) || !Array.isArray(e.args) || e.args.length < 1 || e.args.length > 256)
        throw new AppError('Invalid expression operator'); if (e.op === 'not' && e.args.length !== 1)
        throw new AppError('not requires one operand'); if (['sub', 'div', 'gt', 'lt'].includes(e.op) && e.args.length !== 2)
        throw new AppError('Binary operation requires two operands'); for (const v of e.args)
        checkExpr(v, depth + 1); };
    for (const c of p.controls ?? []) {
        if (!groups.has(c.system) || typeof c.title !== 'string' || !c.title.trim() || c.title.length > 150 || typeof c.unit !== 'string' || c.unit.length > 32)
            throw new AppError('Invalid control metadata');
        finite(c.min, 'control min'); finite(c.max, 'control max', c.min); finite(c.initial, 'control initial', c.min, c.max);
        finite(c.rate, 'control rate', .000001, 1e6); finite(c.step, 'control step', .000001, 1e6);
        if (c.enableWhen !== undefined) {
            checkExpr(c.enableWhen);
            finite(c.safeValue, 'interlocked control safeValue', c.min, c.max);
            if (typeof c.blockedReason !== 'string' || !c.blockedReason.trim() || c.blockedReason.length > 200)
                throw new AppError('Interlocked control needs a blockedReason');
        }
    }
    for (const n of p.simulations) {
        const m = model(n.model);
        if (!groups.has(n.system))
            throw new AppError(`Unknown system: ${n.system}`);
        for (const [k, v] of Object.entries(n.parameters)) {
            const d = m.parameters[k];
            if (!d)
                throw new AppError(`Unknown parameter ${n.id}.${k}`);
            finite(v, `${n.id}.${k}`, d.min, d.max);
        }
        for (const k of Object.keys(m.parameters))
            if (!(k in n.parameters))
                throw new AppError(`Missing parameter ${k}`);
        for (const k of Object.keys(m.inputs))
            if (!(k in n.inputs))
                throw new AppError(`Missing input ${k}`);
        for (const [k, v] of Object.entries(n.inputs)) {
            if (!(k in m.inputs))
                throw new AppError(`Unknown input ${n.id}.${k}`);
            checkExpr(v);
        }
        finite(n.layout.x, 'x', -5000, 10000);
        finite(n.layout.y, 'y', -5000, 10000);
    }
    const visited = new Set<string>(), active = new Set<string>(), derived = new Map(p.signals.map(s => [s.id, s]));
    function visit(name: string) { if (visited.has(name))
        return; if (active.has(name))
        throw new AppError(`Algebraic signal cycle: ${name}`); active.add(name); const s = derived.get(name); if (s) {
        checkExpr(s.expression);
        for (const r of refs(s.expression))
            visit(r);
    } active.delete(name); visited.add(name); }
    p.signals.forEach(s => visit(s.id));
    for (const d of p.devices) {
        if (!groups.has(d.system))
            throw new AppError('Device has unknown system');
        if (typeof d.type !== 'string' || !models().some(m => m.visual === d.type))
            throw new AppError('Invalid device type');
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
            throw new AppError('Invalid alarm hysteresis');
    }
    const history = (h: Project['history']) => { finite(h.deadband, 'deadband', 0, 1e6); finite(h.maxInterval, 'maxInterval', p.stepMs, 86400000); finite(h.retention, 'retention', 60000, 10 * 365 * 86400000); };
    history(p.history);
    for (const s of p.signals)
        if (s.history)
            history(s.history);
    for (const n of p.simulations)
        for (const [key, value] of Object.entries(n.history ?? {})) {
            if (!(key in model(n.model).outputs))
                throw new AppError(`Unknown archived signal ${key}`);
            history(value);
        }
    if (p.overview && (!Array.isArray(p.overview) || p.overview.length > 12))
        throw new AppError('At most twelve overview metrics');
    for (const m of p.overview ?? []) {
        if (!signals.has(m.signal) || typeof m.label !== 'string' || typeof m.unit !== 'string')
            throw new AppError('Invalid overview metric');
        if (m.alarmAbove !== undefined)
            finite(m.alarmAbove, 'metric threshold');
    }
    for (const r of p.reports) {
        if (!r.on || !Array.isArray(r.signals) || !r.signals.length || r.signals.some(s => !signals.has(s)))
            throw new AppError(`Report ${r.id}: invalid signals`);
        if (typeof r.sql !== 'string' || r.sql.length > 20000 || !r.columns?.length)
            throw new AppError('Invalid report SQL/columns');
        if (typeof r.title !== 'string' || r.title.length > 150 || r.columns.length > 32 || (r.on.schedule?.length ?? 0) > 8 || Object.keys(r.on.workflow_dispatch?.inputs ?? {}).length > 16)
            throw new AppError('Report declaration exceeds limits');
        for (const column of r.columns) {
            id(column.key);
            if (typeof column.title !== 'string' || column.title.length > 150)
                throw new AppError('Invalid report column');
        }
        for (const s of r.on.schedule ?? [])
            validateCron(s.cron);
        finite(r.window, 'report window', 1000, 7 * 86400000);
        for (const [k, d] of Object.entries(r.on.workflow_dispatch?.inputs ?? {})) {
            id(k);
            if (['from', 'to'].includes(k) || d.type !== 'number')
                throw new AppError('Invalid input');
            finite(d.min, k);
            finite(d.max, k, d.min);
            finite(d.default, k, d.min, d.max);
        }
    }
}
