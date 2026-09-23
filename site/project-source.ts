/** Source edits for the canonical @saturn/core project. No alternate DSL evaluator. */
import ts from '@typescript/typescript6';
import type { Completion } from '@codemirror/autocomplete';
import type { Endpoint, Value } from '../src/core';
import { compileProject } from '../plant/compiler';
import { installEquipment, sceneFor, visualFrame } from '../plant/equipment';
import { Kernel } from '../plant/kernel';
import { models } from '../plant/models';
import { terminals } from '../plant/ports';
import type { Project } from '../plant/types';
import { failCode, SaturnDiagnosticError, formatDiagnostic } from '../plant/diagnostics';
import { localizedDslEntities } from '../plant/dsl-i18n';
import { sourceObjects } from './plant-project';
export function sourceDiagnostic(error: unknown, length: number) {
  const data = error instanceof SaturnDiagnosticError ? error.diagnostic.data?.source : undefined;
  const start = data && typeof data === 'object' && 'from' in data ? data.from : 0;
  const end = data && typeof data === 'object' && 'to' in data ? data.to : start;
  const from = Math.max(0, Math.min(length, typeof start === 'number' ? start : 0));
  const to = Math.max(from, Math.min(length, typeof end === 'number' ? end : from));
  const message = error instanceof SaturnDiagnosticError ? `${error.diagnostic.code}: ${formatDiagnostic(error.diagnostic, 'ru')}` : error instanceof Error ? error.message : String(error);
  return { from, to, message };
}
export const editableKinds = () => new Set(models().map(model => `plant_${model.visual}`));
export interface Change { from: number; to: number; insert: string; }
const invalid = (field: string): never => failCode('SATURN_PROJECT_INVALID', { reason: 'literalKeyRequired' }, { field });
const ast = (source: string) => ts.createSourceFile('plant.ts', source, ts.ScriptTarget.Latest, true);

export function compile(source: string) {
  const files = { 'plant.ts': source };
  const project = compileProject(files);
  installEquipment('ru');
  const file = ast(source);
  const declarations = new Map<string, { variable: string; statement: ts.VariableStatement }>();
  for (const statement of file.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (ts.isIdentifier(declaration.name) && call && ts.isCallExpression(call) && call.arguments[0] && ts.isStringLiteral(call.arguments[0]))
        declarations.set(call.arguments[0].text, { variable: declaration.name.text, statement });
    }
  }
  const objects = new Map([...sourceObjects(files)].map(([id, object]) => [id, {
    ...object, span: { from: object.from, to: object.to },
    variable: declarations.get(id)?.variable,
    statement: declarations.get(id)?.statement,
  }]));
  const kernel = new Kernel(project, 'local-preview', 'local-preview', 0);
  return { project, scene: sceneFor(project), objects, file, kernel };
}
export type Compiled = ReturnType<typeof compile>;
export const previewFrame = (compiled: Compiled, advance = false) => visualFrame(compiled.project, advance ? compiled.kernel.step() : compiled.kernel.frame());
export function previewProject(project: Project, id: string, x: number, y: number) {
  return sceneFor({ ...project, devices: project.devices.map(device => device.id === id ? { ...device, layout: { ...device.layout, x, y } } : device) });
}
export const editable = (compiled: Compiled, id: string, key: string) => Boolean(compiled.objects.get(id)?.fields.some(field => field.key === key));
export function applyChanges(source: string, changes: Change[]) {
  for (const change of [...changes].sort((a, b) => b.from - a.from)) source = source.slice(0, change.from) + change.insert + source.slice(change.to);
  return source;
}
export function patchFields(source: string, id: string, patch: Record<string, Value>): Change[] {
  const object = compile(source).objects.get(id);
  if (!object) return invalid(id);
  const changes = Object.entries(patch).map(([key, value]) => {
    const field = object.fields.find(field => field.key === key);
    if (!field || typeof value !== 'number' || !Number.isFinite(value)) return invalid(key);
    return { from: field.from, to: field.to, insert: String(value) };
  });
  compile(applyChanges(source, changes));
  return changes;
}
function projectOptions(file: ts.SourceFile) {
  const statement = file.statements.find(ts.isExportAssignment);
  const call = statement?.expression;
  if (!call || !ts.isCallExpression(call) || !call.arguments[1] || !ts.isObjectLiteralExpression(call.arguments[1])) return invalid('project');
  return { statement, options: call.arguments[1] };
}
function arrayAppend(file: ts.SourceFile, key: string, expression: string): Change {
  const { options } = projectOptions(file);
  const property = options.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(file).replace(/['"]/g, '') === key);
  if (property && ts.isPropertyAssignment(property)) {
    const value = property.initializer;
    if (ts.isArrayLiteralExpression(value)) {
      const at = value.end - 1;
      const comma = value.elements.length && !value.elements.hasTrailingComma ? ',' : '';
      return { from: at, to: at, insert: `${comma}\n    ${expression},\n  ` };
    }
    return { from: value.getStart(file), to: value.end, insert: `[...${value.getText(file)}, ${expression}]` };
  }
  const at = options.end - 1;
  return { from: at, to: at, insert: `${options.properties.length && !options.properties.hasTrailingComma ? ',' : ''}\n  ${key}: [${expression}],\n` };
}
function importFunction(source: string, name: string) {
  const file = ast(source);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== '@saturn/core') continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
      if ((binding.propertyName?.text ?? binding.name.text) === name) return { source, name: binding.name.text };
    }
  }
  let local = name, index = 1;
  while (new RegExp(`\\b${local}\\b`).test(source)) local = `${name}${index++}`;
  return { source: `import { ${name}${local === name ? '' : ` as ${local}`} } from '@saturn/core';\n${source}`, name: local };
}
export function appendEquipment(source: string, kind: string, x: number, y: number) {
  const compiled = compile(source);
  const spec = models().find(model => model.kind === kind || `plant_${model.visual}` === kind);
  if (!spec) return invalid(kind);
  const imported = importFunction(source, 'simulation');
  const file = ast(imported.source), { statement } = projectOptions(file);
  const prefix = spec.kind.toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  let index = 1;
  while (compiled.project.devices.some(device => device.id === `${prefix}-${index}`) || new RegExp(`\\bequipment${index}\\b`).test(source)) index++;
  const variable = `equipment${index}`, system = compiled.project.systems[0]?.id;
  if (!system) return invalid('systems');
  const declaration = `const ${variable} = ${imported.name}(${JSON.stringify(`${prefix}-${index}`)}, ${JSON.stringify(spec.kind)}, {\n  system: ${JSON.stringify(system)}, at: { x: ${x}, y: ${y} },\n});\n\n`;
  const next = applyChanges(imported.source, [arrayAppend(file, 'simulations', variable), { from: statement.getStart(file), to: statement.getStart(file), insert: declaration }]);
  compile(next); return next;
}
/** Canvas endpoints are projection details; authored topology is always pipe/cable with IDs. */
export function appendConnection(source: string, from: Endpoint, to: Endpoint) {
  const compiled = compile(source);
  const a = compiled.objects.get(from.node)?.variable, b = compiled.objects.get(to.node)?.variable;
  const device = compiled.project.devices.find(device => device.id === from.node);
  const terminal = device && terminals(device.type)[from.port];
  if (!a || !b || !terminal) return invalid('connection.endpoints');
  const type = terminal.medium === 'pipe' ? 'pipe' : 'cable';
  const imported = importFunction(source, type);
  let index = 1; while (compiled.project.connections?.some(wire => wire.id === `${type.toUpperCase()}-${index}`)) index++;
  const endpoint = (variable: string, name: string) => `${variable}.ports[${JSON.stringify(name)}]`;
  const call = `${imported.name}(${JSON.stringify(`${type.toUpperCase()}-${index}`)}, ${endpoint(a, from.port)}, ${endpoint(b, to.port)}${type === 'cable' ? `, { medium: ${JSON.stringify(terminal.medium)} }` : ''})`;
  const next = applyChanges(imported.source, [arrayAppend(ast(imported.source), 'connections', call)]);
  compile(next); return next;
}
export function removeObject(source: string, id: string) {
  const compiled = compile(source), { file } = compiled;
  const object = compiled.objects.get(id), wires = compiled.project.connections ?? [];
  const removedWires = new Set(wires.filter(wire => wire.id === id || wire.from.device === id || wire.to.device === id).map(wire => wire.id));
  const changes: Change[] = [];
  // Rebuild only the two membership arrays, retaining every unrelated declaration.
  const { options } = projectOptions(file);
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) continue;
    const value = property.initializer;
    const removed = value.elements.filter(item => ts.isIdentifier(item) && item.text === object?.variable || ts.isCallExpression(item) && item.arguments[0] && ts.isStringLiteral(item.arguments[0]) && removedWires.has(item.arguments[0].text));
    // Adjacent removals must not produce overlapping edits.
    const keep = value.elements.filter(item => !removed.includes(item));
    if (removed.length) changes.push({ from: value.getStart(file), to: value.end, insert: `[${keep.map(item => item.getFullText(file).trim()).join(', ')}]` });
  }
  if (object?.statement) {
    if (object.statement.declarationList.declarations.length !== 1) return invalid('declaration');
    changes.push({ from: object.statement.getStart(file), to: object.statement.end, insert: '' });
  }
  if (!changes.length) return invalid(id);
  const result = applyChanges(source, changes);
  // References in behaviors/views are never silently rewritten or deleted.
  const after = compile(result);
  if (after.project.devices.some(device => device.id === id) || after.project.connections?.some(wire => removedWires.has(wire.id))) return invalid(id);
  return result;
}
export function dslCompletions(source: string, position: number, compiled?: Compiled): Completion[] {
  const member = /([\w$]+)\.ports\.[\w$]*$/.exec(source.slice(0, position));
  if (member && compiled) {
    const entry = [...compiled.objects].find(([, object]) => object.variable === member[1]);
    const device = compiled.project.devices.find(device => device.id === entry?.[0]);
    if (device) return Object.entries(terminals(device.type)).map(([label, port]) => ({ label, type: 'property', detail: `${port.medium} / ${port.family} / ${port.role}` }));
  }
  return localizedDslEntities('ru').map(entity => ({ label: entity.name, type: 'function', detail: '@saturn/core', info: entity.summary }));
}
