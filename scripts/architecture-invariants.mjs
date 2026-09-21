import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import ts from '@typescript/typescript6';

const root = process.cwd();
const excluded = new Set(['node_modules','.git','dist','.plant','.authoring','playwright-report','test-results','runtime-test-results','vscode-video']);
const allowedDiagnosticFiles = new Set(['plant/diagnostics.ts']);
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

await walk(root);
if (violations.length) {
  console.error('Saturn architecture invariants failed:\n' + violations.join('\n'));
  process.exit(1);
}
console.log('Saturn architecture invariants passed');
