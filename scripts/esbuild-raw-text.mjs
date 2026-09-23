import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** One esbuild convention for source-controlled text resources such as SQL migrations. */
export const rawText = {
  name: 'saturn-raw-text',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({
      path: resolve(args.resolveDir, args.path.slice(0, -4)),
      namespace: 'saturn-raw-text',
    }));
    build.onLoad({ filter: /.*/, namespace: 'saturn-raw-text' }, async args => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text',
    }));
  },
};
