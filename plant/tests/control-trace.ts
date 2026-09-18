import { compileProject } from '../compiler';
import { demoFiles } from '../demo/files';
import { Kernel } from '../kernel';
/** Portable operator trace on the fictional water/ventilation loop only. */
export function runControlTrace() {
    const k = new Kernel(compileProject(demoFiles), 'control-parity', 'control-parity', 0);
    const keys = ['MAKEUP.value', 'MAKEUP.requested', 'DRAW.value', 'DRAW.blocked', 'AUX-TANK.level', 'AUX-TANK.balance', 'AUX-VALVE.opening', 'AUX-FAN.rpm'];
    const trace: { seq: number; values: (number | null)[] }[] = [];
    let blocked = false;
    for (let step = 0; step < 1600; step++) {
        if (step === 0) { k.operate('MAKEUP', 0); k.operate('DRAW', 1); }
        if (step === 700) k.operate('MAKEUP', .2);
        if (step === 1100) k.operate('AIR', .9);
        const frame = k.step();
        blocked ||= frame.samples['DRAW.blocked'].value === 1;
        if (step % 100 === 0 || step === 1599) trace.push({ seq: frame.seq, values: keys.map(key => frame.samples[key].value) });
    }
    return { trace, blocked, clearedDemand: k.samples()['DRAW.requested'].value };
}
