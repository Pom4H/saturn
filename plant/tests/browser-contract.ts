import {runPlcTrace} from './plc-trace';
import { runTrainingSuite } from './stability-trace';
import { runCounterfactuals, runControlTrace } from './counterfactual';
import { openBrowserSql } from '../adapters/browser-sql';
import { compileProject } from '../compiler';
import { demoFiles } from '../demo/files';
import { executeReport } from '../workflows';
self.onmessage = async () => { try {
    const physics = runCounterfactuals(), { db } = await openBrowserSql({ memory: true });
    const report = compileProject(demoFiles).reports[0];
    const artifact = executeReport({ id: 'test', report, revision: 'comparison', runId: 'test', trigger: 'test', actor: 'test', createdAt: 0, from: 0, to: 5000, inputs: { scale: 1 }, data: { samples: [], segments: [{ signal: 'flow', start: 0, end: 1000, value: 10, quality: 'good' }, { signal: 'flow', start: 1000, end: 3000, value: 20, quality: 'good' }, { signal: 'flow', start: 3000, end: 4000, value: null, quality: 'offline' }, { signal: 'flow', start: 4000, end: 5000, value: 20, quality: 'good' }] } }, db);
    self.postMessage({ plc:runPlcTrace(),physics, training: runTrainingSuite(), controls: runControlTrace(), rows: artifact.rows });
}
catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
} };
