export {runPlcTrace} from './plc-trace';
import { compileProject } from '../compiler';
import { demoFiles } from '../demo/files';
import { Kernel } from '../kernel';
export function runCounterfactuals() {
    const project = compileProject(demoFiles);
    const results: Record<string, {
        peak: number;
        damage: number;
        structure: number;
        residual: number;
    }> = {};
    for (const variant of ['baseline', 'cooling-loss', 'feedback-removed', 'fast-protection']) {
        const kernel = new Kernel(project, 'comparison', 'comparison', 0);
        if (variant !== 'baseline')
            kernel.setParameter('GRID', 'voltage', .4);
        if (variant === 'feedback-removed')
            kernel.setParameter('CORE', 'feedback', 0);
        if (variant === 'fast-protection')
            kernel.setParameter('PROTECT', 'actuation', .1);
        let peak = 0, residual = 0;
        for (let i = 0; i < 3000; i++) {
            const f = kernel.step();
            peak = Math.max(peak, f.samples['core.temperature'].value!);
            residual = Math.max(residual, Math.abs(f.samples['core.balance'].value!));
        }
        const f = kernel.frame();
        results[variant] = { peak, damage: f.samples['core.damage'].value!, structure: f.samples['BUILDING.damage'].value!, residual };
    }
    return results;
}

export { runControlTrace } from './control-trace';

export {runTrainingSuite} from './stability-trace';
export {compileController,plcFixture} from './plc-trace';
