import { model } from './models';
import { AppError, clone, finite, type Checkpoint, type Expr, type Frame, type Project, type Sample } from './types';
export function evaluate(expr: Expr, read: (id: string) => Sample, time: number): Sample {
    if (typeof expr === 'number' || typeof expr === 'boolean')
        return { value: Number(expr), quality: 'good', time };
    if ('ref' in expr)
        return read(expr.ref);
    const samples = expr.args.map(a => evaluate(a, read, time));
    const bad = samples.find(s => s.quality !== 'good' || s.value === null);
    if (bad)
        return { value: null, quality: bad.quality === 'good' ? 'bad' : bad.quality, time };
    const a = samples.map(s => s.value!);
    let value: number;
    switch (expr.op) {
        case 'add':
            value = a.reduce((x, y) => x + y, 0);
            break;
        case 'mul':
            value = a.reduce((x, y) => x * y, 1);
            break;
        case 'sub':
            value = a[0] - a[1];
            break;
        case 'div':
            value = a[0] / a[1];
            break;
        case 'max':
            value = Math.max(...a);
            break;
        case 'min':
            value = Math.min(...a);
            break;
        case 'gt':
            value = Number(a[0] > a[1]);
            break;
        case 'lt':
            value = Number(a[0] < a[1]);
            break;
        case 'and':
            value = Number(a.every(Boolean));
            break;
        case 'not':
            value = Number(!a[0]);
            break;
    }
    return { value: Number.isFinite(value) ? value : null, quality: Number.isFinite(value) ? 'good' : 'bad', time };
}
/** Ordered fixed-step, double-buffered state: equipment order cannot change a result. */
export class Kernel {
    state: Checkpoint;
    private bad = new Set<string>();
    constructor(readonly project: Project, revision: string, runId: string, epoch: number, checkpoint?: Checkpoint) {
        this.state = checkpoint ? clone(checkpoint) : { runId, revision, epoch, time: epoch, seq: 0, paused: false, overrides: {}, modelVersions: Object.fromEntries(project.simulations.map(n => [n.model, model(n.model).version])), controls: Object.fromEntries((project.controls ?? []).map(c => [c.id, { requested: c.initial, value: c.initial, blocked: false }])), states: Object.fromEntries(project.simulations.map(n => [n.id, model(n.model).initialize(n.parameters)])) };
        this.state.controls ??= {};
        for (const c of project.controls ?? []) {
            const saved = this.state.controls[c.id];
            if (!saved) throw new AppError(`Missing control checkpoint: ${c.id}`);
            finite(saved.requested, c.id, c.min, c.max); finite(saved.value, c.id, c.min, c.max);
        }
        this.bad = new Set(this.state.invalidModels ?? []);
        for (const n of project.simulations)
            if (this.state.modelVersions?.[n.model] !== model(n.model).version)
                throw new AppError(`Checkpoint model version mismatch: ${n.model}`);
        if (Object.keys(this.state.states).length !== project.simulations.length)
            throw new AppError('Checkpoint topology mismatch');
    }
    private parameters(node: Project['simulations'][number]) { const p = { ...node.parameters }; for (const k of Object.keys(p)) {
        const v = this.state.overrides[`${node.id}.${k}`];
        if (v !== undefined)
            p[k] = v;
    } return p; }
    samples(): Record<string, Sample> {
        const output: Record<string, Sample> = Object.create(null);
        for (const c of this.project.controls ?? []) {
            const state = this.state.controls![c.id];
            for (const key of ['value', 'requested', 'blocked'] as const)
                output[`${c.id}.${key}`] = { value: Number(state[key]), quality: 'good', time: this.state.time };
        }
        for (const n of this.project.simulations) {
            const spec = model(n.model);
            const observed = spec.observe(this.state.states[n.id], this.parameters(n));
            for (const k of Object.keys(spec.outputs)) {
                const v = observed[k];
                output[`${n.id}.${k}`] = { value: !this.bad.has(n.id) && Number.isFinite(v) ? v : null, quality: this.bad.has(n.id) || !Number.isFinite(v) ? 'bad' : 'good', time: this.state.time };
            }
        }
        const derived = new Map(this.project.signals.map(s => [s.id, s]));
        const read = (id: string): Sample => { if (output[id])
            return output[id]; const d = derived.get(id); if (!d)
            return { value: null, quality: 'bad', time: this.state.time }; return output[id] = evaluate(d.expression, read, this.state.time); };
        for (const s of this.project.signals)
            read(s.id);
        return output;
    }
    step(): Frame {
        if (!this.state.paused) {
            const samples = this.samples(), next: Checkpoint['states'] = {}, bad = new Set<string>();
            for (const n of this.project.simulations) {
                const inputs: Record<string, number> = {};
                let valid = true;
                for (const [key, expr] of Object.entries(n.inputs)) {
                    const s = evaluate(expr, id => samples[id] ?? { value: null, quality: 'bad', time: this.state.time }, this.state.time);
                    if (s.quality !== 'good' || s.value === null) {
                        valid = false;
                        break;
                    }
                    inputs[key] = s.value;
                }
                if (!valid) {
                    next[n.id] = this.state.states[n.id];
                    bad.add(n.id);
                    continue;
                }
                const result = model(n.model).advance(this.state.states[n.id], inputs, this.parameters(n), this.project.stepMs / 1000);
                if (Object.values(result).some(v => !Number.isFinite(v) || Math.abs(v) > 1e12))
                    throw new AppError(`Model ${n.id} left its numerical domain`);
                next[n.id] = result;
            }
            // Controls use the same previous-step snapshot as equipment. Fail-closed gates are
            // evaluated every step, not just when the user clicks. Reset the demand on a trip:
            // removing the cause must not unexpectedly restore an old command.
            for (const c of this.project.controls ?? []) {
                const state = this.state.controls![c.id];
                const gate = c.enableWhen === undefined ? { value: 1, quality: 'good' } : evaluate(c.enableWhen, id => samples[id] ?? { value: null, quality: 'bad', time: this.state.time }, this.state.time);
                state.blocked = gate.quality !== 'good' || gate.value === null || !gate.value;
                if (state.blocked) { state.requested = c.safeValue!; state.value = c.safeValue!; }
                else { const delta = state.requested - state.value, limit = c.rate * this.project.stepMs / 1000;
                    state.value += Math.sign(delta) * Math.min(Math.abs(delta), limit); }
            }
            this.bad = bad;
            this.state.invalidModels = [...bad];
            this.state.states = next;
            this.state.seq++;
            this.state.time = this.state.epoch + this.state.seq * this.project.stepMs;
        }
        return this.frame();
    }
    frame(): Frame { return { runId: this.state.runId, revision: this.state.revision, seq: this.state.seq, time: this.state.time, paused: this.state.paused, synthetic: true, samples: this.samples(), alarms: [] }; }
    operate(target: string, value: number): void {
        const c = this.project.controls?.find(c => c.id === target);
        if (!c) throw new AppError('Unknown operator control');
        finite(value, c.title, c.min, c.max);
        if (c.enableWhen !== undefined) {
            const samples = this.samples(), gate = evaluate(c.enableWhen, id => samples[id] ?? { value: null, quality: 'bad', time: this.state.time }, this.state.time);
            if (gate.quality !== 'good' || !gate.value) throw new AppError(c.blockedReason!, 409);
        }
        this.state.controls![target].requested = value;
    }
    setParameter(target: string, parameter: string, value: number): void { const n = this.project.simulations.find(n => n.id === target), spec = n && model(n.model).parameters[parameter]; if (!n || !spec)
        throw new AppError('Unknown editable parameter'); finite(value, parameter, spec.min, spec.max); this.state.overrides[`${target}.${parameter}`] = value; }
}
