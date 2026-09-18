import { compileProject } from '../compiler';
import { demoFiles } from '../demo/files';
import { Kernel } from '../kernel';
import { updateAlarms } from '../alarms';
import type { AlarmState } from '../types';
/** Exercise only the isolated, fictional calorimeter. Never real reactor controls. */
export function trainingProject() {
    const p = compileProject(demoFiles);
    p.id = 'thermal-lab'; p.title = 'Normalized thermal lab';
    p.simulations = p.simulations.filter(n => n.system === 'training');
    p.devices = p.devices.filter(n => n.system === 'training');
    p.controls = p.controls?.filter(c => c.system === 'training');
    p.systems = [{id:'training',title:'Thermal lab'}];
    p.controllers=[];p.connections=[];p.attachments=[];
    p.signals = []; p.reports = p.reports.filter(r => r.id === 'lab-recovery');
    p.alarms = p.alarms.filter(r => r.id.startsWith('lab-')); p.overview = [];
    return p;
}
export type Exercise = 'baseline' | 'pulse' | 'stress' | 'recover' | 'heat-only' | 'cooling-only' | 'small-error';
export function runExercise(mode: Exercise, reactionSeconds = 20, stepMs = 100, capacityFactor = 1) {
    const p = trainingProject(); p.stepMs = stepMs;
    p.simulations.find(n=>n.id==='LAB-THERMAL')!.parameters.capacity *= capacityFactor;
    const k = new Kernel(p, 'exercise', 'exercise', 0), alarms: Record<string, AlarmState> = {};
    let warningAt: number|null = null, damageAt: number|null = null, responseAt: number|null = null, recoveredAt: number|null = null;
    let peak = 0, residual = 0; let responded = false, pulsed = false;
    const trace: {time:number;temperature:number;damage:number;cooling:number}[] = [];
    if (mode !== 'baseline') {
        k.operate('LAB-HEAT', mode === 'small-error' ? .95 : 1.8);
        k.operate('LAB-COOLING', mode === 'small-error' ? .8 : .15);
    }
    for(let i=0;i<Math.ceil(480000/stepMs);i++) {
        const frame=k.step(), s=frame.samples;
        updateAlarms(p.alarms, alarms, frame);
        const temperature=s['LAB-THERMAL.temperature'].value!,damage=s['LAB-THERMAL.damage'].value!;
        peak=Math.max(peak,temperature);residual=Math.max(residual,Math.abs(s['LAB-THERMAL.balance'].value!));
        if(alarms['lab-hot']?.active && warningAt===null)warningAt=frame.time/1000;
        if(damage>.01 && damageAt===null)damageAt=frame.time/1000;
        if(mode==='pulse' && frame.time>=15000 && !pulsed) {k.operate('LAB-HEAT',.85);k.operate('LAB-COOLING',.85);pulsed=true;}
        if(['recover','heat-only','cooling-only'].includes(mode) && warningAt!==null && frame.time/1000>=warningAt+reactionSeconds && !responded) {
            if(mode!=='cooling-only')k.operate('LAB-HEAT',.25);
            if(mode!=='heat-only')k.operate('LAB-COOLING',1.2);
            responded=true;responseAt=frame.time/1000;
        }
        if(responded && temperature<1.35 && !alarms['lab-hot'].active && recoveredAt===null)recoveredAt=frame.time/1000;
        if(i%Math.round(10000/stepMs)===0)trace.push({time:frame.time,temperature,damage,cooling:s['LAB-TOWER.cooling'].value!});
    }
    const samples=k.samples();
    return {warningAt,damageAt,responseAt,recoveredAt,peak,residual,finalTemperature:samples['LAB-THERMAL.temperature'].value!,damage:samples['LAB-THERMAL.damage'].value!,trace};
}
export function runTrainingSuite() {
    return Object.fromEntries((['baseline','pulse','stress','recover','heat-only','cooling-only'] as const).map(name=>[name,runExercise(name)]));
}
