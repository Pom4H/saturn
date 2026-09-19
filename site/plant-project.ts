import ts from '@typescript/typescript6';
import { compileProject, validateFiles } from '../plant/compiler';
import { installEquipment, sceneFor, visualFrame } from '../plant/equipment';
import type { Frame, Project } from '../plant/types';
import { starter } from './starter';
export interface SourceField { key: string; label: string; value: number; from: number; to: number; }
export interface SourceObject { path: string; from: number; to: number; fields: SourceField[]; }
export function sourceObjects(files: Record<string, string>) {
  const result = new Map<string, SourceObject>();
  const addFields = (object: ts.ObjectLiteralExpression, source: ts.SourceFile, keys: string[], prefix = ''): SourceField[] => object.properties.flatMap(p => {
    if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) || !keys.includes(p.name.text)) return [];
    const value = p.initializer;
    const text = value.getText(source);
    if (!/^-?\d+(\.\d+)?$/.test(text)) return [];
    return [{ key: prefix + p.name.text, label: p.name.text, value: Number(text), from: value.getStart(source), to: value.end }];
  });
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith('.ts')) continue;
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ['simulation', 'equipment', 'plc'].includes(n.expression.text) && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
        const options = n.arguments[n.expression.text === 'plc' ? 1 : 2];
        if (options && ts.isObjectLiteralExpression(options)) {
          const fields = options.properties.flatMap(p => {
            if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name) || !ts.isObjectLiteralExpression(p.initializer)) return [];
            if (p.name.text === 'at') return addFields(p.initializer, source, ['x', 'y']);
            if (p.name.text === 'parameters') return addFields(p.initializer, source, p.initializer.properties.filter(ts.isPropertyAssignment).map(x => x.name.getText(source)), 'parameters.');
            return [];
          });
          result.set(n.arguments[0].text, { path, from: n.getStart(source), to: n.end, fields });
        }
      }
      ts.forEachChild(n, visit);
    }; visit(source);
  }
  return result;
}
export function unavailableRuntime(project: Project, mode: 'draft' | 'offline' = 'draft') {
  const frame: Frame = { runId: mode, revision: '', seq: 0, time: 0, paused: true, synthetic: true, samples: {}, alarms: [], displays: {} };
  const runtime = visualFrame(project, frame);
  for (const equipment of Object.values(runtime.equipment)) { equipment.facts.mode = mode; for (const signal of Object.values(equipment.signals)) { signal.quality = 'offline'; signal.value = null; } }
  return runtime;
}
export function plantProjection(files: Record<string, string>) {
  const project = compileProject(files); installEquipment();
  return { project, scene: sceneFor(project), runtime: unavailableRuntime(project), objects: sourceObjects(files) };
}
export function nestedStarter() {
  const files = { ...starter };
  files['systems/pumping.ts'] = files['equipment.ts']; delete files['equipment.ts'];
  files['plant.ts'] = files['plant.ts'].replace("'./equipment'", "'./systems/pumping'");
  files['views.ts'] = files['views.ts'].replace("'./equipment'", "'./systems/pumping'");
  files['README.md'] = '# Насосная установка\n\nplant.ts — состав проекта.\nsystems/pumping.ts — насос и команда.\nviews.ts — операторский экран.\n\nИзменения здесь остаются черновиком до публикации на сервере.\n';
  return files;
}
export { validateFiles, visualFrame };
