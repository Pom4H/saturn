import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import ts from '@typescript/typescript6';

const root = process.cwd();
const excluded = new Set(['node_modules','.git','dist','.plant','.authoring','playwright-report','test-results','runtime-test-results','vscode-video']);
const allowedDiagnosticFiles = new Set(['plant/diagnostics.ts']);
const forbiddenParallelHmiTypes = new Set(['HmiApplication','HmiScreen','HmiDialog','HmiNode','HmiAction']);
const violations = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name)) await inspect(path);
  }
}

function lineOf(source, node) {
  const p = source.getLineAndCharacterOfPosition(node.getStart(source));
  return p.line + 1;
}

function report(source, file, node, rule, message) {
  violations.push(`${relative(root,file)}:${lineOf(source,node)} [${rule}] ${message}`);
}

async function inspect(file) {
  const text = await readFile(file,'utf8');
  const source = ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = relative(root,file).replaceAll('\\','/');

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (rel.startsWith('src/') && specifier.includes('examples/elements-lab/'))
        report(source,file,node,'production-elements-own-geometry','Production source must import canonical element geometry from src/elements, never from the visual lab.');
      if (rel === 'packages/core/index.ts' && specifier.includes('elements'))
        report(source,file,node,'trusted-element-api-subpath','Trusted element/device-pack APIs belong to @saturn/core/elements, not the declarative project DSL root.');
    }

    if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
      && node.name && forbiddenParallelHmiTypes.has(node.name.text)
      && !rel.startsWith('plant/vendor/')) {
      report(source,file,node,'single-presentation-ir',
        `${node.name.text} would create a parallel HMI authoring model. Extend canonical Presentation IR and add a target projection instead.`);
    }

    if (node.kind === ts.SyntaxKind.AnyKeyword)
      report(source,file,node,'no-explicit-any','Use unknown plus narrowing or a concrete domain type.');

    if (!allowedDiagnosticFiles.has(rel) && ts.isNewExpression(node)
      && ts.isIdentifier(node.expression) && node.expression.text === 'AppError'
      && node.arguments?.length && (ts.isStringLiteralLike(node.arguments[0]) || ts.isTemplateExpression(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) {
      report(source,file,node,'structured-diagnostics','Use failCode()/SaturnDiagnosticError with stable code and data.');
    }

    if (rel !== 'plant/i18n.ts' && ts.isPropertyAssignment(node)
      && ts.isIdentifier(node.name) && (node.name.text === 'en' || node.name.text === 'ru')) {
      report(source,file,node,'single-i18n-source','Human translations belong only in plant/i18n.ts; reference a typed TextKey elsewhere.');
    }

    ts.forEachChild(node,visit);
  }
  visit(source);
}

async function assertText(path, { required = [], forbidden = [] }) {
  const text = await readFile(join(root, path), 'utf8');
  for (const value of required)
    if (!text.includes(value)) violations.push(`${path} [canonical-doc] missing required contract: ${value}`);
  for (const value of forbidden)
    if (text.includes(value)) violations.push(`${path} [canonical-doc] contains superseded contract: ${value}`);
}

await walk(root);

await assertText('docs/git-projects.md', {
  required: ['There is no `scada.project.json`', 'runtime itself does not poll/fetch Git branches'],
});
await assertText('docs/standalone.md', {
  required: ['package.json', 'src/plant.ts', 'immutable BuildArtifact', 'saturn add pump'],
  forbidden: ['scada.project.json', 'SCADA_PROJECT_REPO', 'saturn extension add'],
});
await assertText('docs/developer/element-packs.md', {
  required: ['project-owned', 'saturn add pump', '@saturn/core'],
  forbidden: ['extension manifest', 'installed application code'],
});
await assertText('scripts/saturn.mjs', {
  required: ["'new'", "'check'", "'registry'", "'add'"],
  forbidden: ['saturn extension', "'extension'", "'extensions'"],
});

await assertText('plant/presentation-target.ts', {
  required: ['compileSaturnC23Presentation', 'c23: SaturnC23PresentationSource'],
  forbidden: ['HmiScreenModel', 'compileSaturnPlcPresentation'],
});
await assertText('plant/controller.ts', {
  required: ['Rich physical HMI', 'C23/satgui'],
  forbidden: ['compileHmiScreens', 'projectPresentation(c.hmi.view'],
});
await assertText('plant/presentation-c23.ts', {
  required: ['#include <satgui.h>', 'gui_screen_create', 'gui_text_create', 'gui_text_set'],
  forbidden: ['saturn_satgui_begin', 'saturn_satgui_text', 'HmiScreenModel'],
});
await assertText('plant/targets/saturn-plc-c23.ts', {
  required: ['compileSaturnC23Controller', "schema:'saturn.c23.project@1'"],
});

await assertText('site/index.html', {
  // Keep the semantic promise in the actual Russian UI, not its old English label.
  required: ['data-surface="scene"', 'Source, build, published и applied', 'saturn add pump', 'project-owned source', 'Запуск собранного проекта'],
  forbidden: ['data-view="scene"', 'saturn extension add', 'self-contained npm package', 'Git-managed'],
});

await assertText('scripts/site-server-check.mjs', {
  required: ['/plant/api/workspace', '/plant/api/artifact', 'immutable BuildArtifact', 'Saving workspace does not publish it'],
  forbidden: ['/plant/api/project', 'project.git', 'new Git revision', 'real Node/Git installation'],
});

if (violations.length) {
  console.error('Saturn architecture invariants failed:\n' + violations.join('\n'));
  process.exit(1);
}
console.log('Saturn architecture invariants passed');
