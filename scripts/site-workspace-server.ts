import { resolve } from 'node:path';
import { NodeSql } from '../plant/adapters/node-sql';
import { runReport } from '../plant/adapters/node-reports';
import { startPlantHttpServer } from '../plant/http-server';
import { WorkspaceHost } from '../standalone/workspace-host';

export async function startWorkspaceTestServer(options: {
  project: string;
  data: string;
  password: string;
  root?: string;
  autoTick?: boolean;
}) {
  const workspace = new WorkspaceHost(options.project);
  const seed = await workspace.build();
  const database = new NodeSql(options.data);
  return startPlantHttpServer({
    port: 0,
    host: '127.0.0.1',
    password: options.password,
    root: resolve(options.root ?? 'dist/plant'),
    autoTick: options.autoTick ?? false,
    uiMode: 'ide',
    database,
    workspace,
    reportRunner: runReport,
    seed,
  });
}
