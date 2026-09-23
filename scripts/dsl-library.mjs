import ts from '@typescript/typescript6';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';

// Emit the actual public SDK, not a hand-maintained second set of DSL signatures.
let library;
export function dslLibrary() {
  if (library) return library;
  const cwd = resolve('.'), root = resolve('packages/core/index.ts'), outDir = resolve('.authoring/sdk-emission');
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, declaration: true,
    emitDeclarationOnly: true, skipLibCheck: true, types: [], outDir, rootDir: cwd };
  const program = ts.createProgram([root], options);
  const files = {};
  const result = program.emit(undefined, (path, content) => { files['/sdk/' + relative(outDir, path).replaceAll('\\', '/')] = content; });
  if (result.emitSkipped || !files['/sdk/packages/core/index.d.ts']) throw new Error('Cannot emit the canonical Saturn authoring SDK');
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile) files['/sdk/' + relative(cwd, source.fileName).replaceAll('\\', '/')] = source.text;
  }
  const defaultLib = '/sdk/' + relative(cwd, ts.getDefaultLibFilePath(options)).replaceAll('\\', '/');
  if (!files[defaultLib]) throw new Error('TypeScript default library is missing');
  library = { root: '/sdk/packages/core/index.d.ts', defaultLib, files };
  return library;
}
export async function writeDslLibrary(path) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(dslLibrary()));
}
