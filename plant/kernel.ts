import { ControllerVM, inputPins, CONTROLLER_ABI } from './controller';
import { connectionExpression, terminals, busConnected } from './ports';
import { model } from './models';
import { AppError, clone, finite, type Checkpoint, type Expr, type Frame, type Project, type Sample } from './types';
export { evaluate } from './expressions';
import { evaluate } from './expressions';
/** Ordered fixed-step, double-buffered state: equipment order cannot change a result. */
export class Kernel {
    state: Checkpoint;
    private bad = new Set<string>();
    private controllers = new Map<string,ControllerVM>();
    constructor(readonly project: Project, revision: string, runId: string, epoch: number, checkpoint?: Checkpoint) {
        this.state = checkpoint ? clone(checkpoint) : { runId, revision, epoch, time: epoch, seq: 0, paused: false, overrides: {}, modelVersions: Object.fromEntries(project.simulations.map(n => [n.model, model(n.model).version])), controls: Object.fromEntries((project.controls ?? []).map(c => [c.id, { requested: c.initial, value: c.initial, blocked: false }])), states: Object.fromEntries(project.simulations.map(n => [n.id, model(n.model).initialize(n.parameters)])) };
        if(checkpoint&&(project.controllers?.length??0)>0&&checkpoint.controllerAbi!==CONTROLLER_ABI)throw new AppError('Controller checkpoint ABI mismatch');
        this.state.controllerAbi=CONTROLLER_ABI;
        this.state.plc ??= {};
        for(const c of project.controllers??[]) {
            const vm=new ControllerVM(c); this.controllers.set(c.id,vm);
            const saved=this.state.plc[c.id];if(saved?.snapshot)vm.restore(saved.snapshot);else if(checkpoint)throw new AppError('Missing controller runtime snapshot');
            this.state.plc[c.id] ??= {inputs:{},outputs:Object.fromEntries(Object.keys(c.outputs).map(k=>[k,0])),healthy:false,powered:false,screen:initialControllerScreen(c),snapshot:vm.snapshot()};
            if(!Number.isInteger(this.state.plc[c.id].screen)) this.state.plc[c.id].screen=initialControllerScreen(c);
        }
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
        this.bad=new Set(this.state.invalidModels??[]);
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
                const unwired = n.model==='io-module'&&!this.project.connections?.some(w=>w.to.device===n.id&&terminals('ioModule')[w.to.port]?.input===k);
                output[`${n.id}.${k}`] = { value: !unwired && !this.bad.has(n.id) && Number.isFinite(v) ? v : null, quality: unwired || this.bad.has(n.id) || !Number.isFinite(v) ? 'bad' : 'good', time: this.state.time };
            }
        }
        for(const c of this.project.controllers??[]) {
            const saved=this.state.plc![c.id];
            for(const key of Object.keys(inputPins)) output[`${c.id}.${key}`]={value:saved.healthy&&saved.inputs[key]!==undefined?saved.inputs[key]:null,quality:saved.healthy&&saved.inputs[key]!==undefined?'good':'bad',time:this.state.time};
            for(const [key,value] of Object.entries(saved.outputs)) output[`${c.id}.${key}`]={value:saved.healthy?value:null,quality:saved.healthy?'good':'bad',time:this.state.time};
            for(const key of ['healthy','powered'] as const) output[`${c.id}.${key}`]={value:Number(saved[key]),quality:'good',time:this.state.time};
        }
        const derived = new Map(this.project.signals.map(s => [s.id, s]));
        const read = (id: string): Sample => { if (output[id])
            return output[id]; const d = derived.get(id); if (!d)
            return { value: null, quality: 'bad', time: this.state.time }; return output[id] = evaluate(d.expression, read, this.state.time); };
        for (const s of this.project.signals)
            read(s.id);
        return output;
    }
    private referenceValue(id:string,port:string,samples:Record<string,Sample>):number|null {
        const wire=this.project.connections?.find(w=>w.to.device===id&&w.to.port===port);
        const expr=wire&&connectionExpression(this.project,wire);if(!wire||expr===undefined)return null;
        const v=evaluate(expr,key=>samples[key]??{value:null,quality:'bad',time:this.state.time},this.state.time);
        return v.quality==='good'&&v.value!==null?v.value*(wire.scale??1):null;
    }
    private referenceHealthy(id:string,type:string,samples:Record<string,Sample>):boolean {
        if(['transmitter','contactor','indicator'].includes(type)) {
            const common=this.referenceValue(id,'common',samples);return common!==null&&Math.abs(common)<.001;
        }
        if(type!=='ioModule')return true;
        const a=this.project.attachments?.find(a=>a.device===id);if(!a)return false;
        const plus=this.referenceValue(id,'plus',samples),minus=this.referenceValue(id,'minus',samples);
        if(plus===null||minus===null||plus-minus<12||plus-minus>24)return false;
        const bus=(module:string,plc:string)=>busConnected(this.project,{device:id,port:module},{device:a.controller,port:plc});
        return !!bus('busA','RS-A')&&!!bus('busB','RS-B')&&samples[a.controller+'.powered']?.value===1;
    }
    step(): Frame {
        if (!this.state.paused) {
            const samples = this.samples(), next: Checkpoint['states'] = {}, bad = new Set<string>();
            for (const n of this.project.simulations) {
                const inputs: Record<string, number> = {};
                const type=this.project.devices.find(d=>d.id===n.id)!.type;
                let valid = this.referenceHealthy(n.id,type,samples);
                const bindings={...n.inputs};
                for(const w of this.project.connections??[]) if(w.to.device===n.id){
                    const device=this.project.devices.find(d=>d.id===n.id)!;const target=terminals(device.type)[w.to.port];
                    const expression=connectionExpression(this.project,w);if(target.input&&expression!==undefined)bindings[target.input]={op:'mul',args:[expression,w.scale??1]};
                }
                for (const [key, expr] of Object.entries(bindings)) {
                    let s = evaluate(expr, id => samples[id] ?? { value: null, quality: 'bad', time: this.state.time }, this.state.time);
                    if((s.quality!=='good'||s.value===null)){const device=this.project.devices.find(d=>d.id===n.id);const port=device&&Object.values(terminals(device.type)).find(t=>t.input===key&&t.failValue!==undefined);if(port)s={value:port.failValue!,quality:'good',time:this.state.time};}
                    if (s.quality !== 'good' || s.value === null) {
                        valid = false;
                        break;
                    }
                    inputs[key] = s.value;
                }
                if (!valid) {
                    next[n.id] = n.model==='contactor'?model(n.model).advance(this.state.states[n.id],{coil:0,supply:0},this.parameters(n),this.project.stepMs/1000):this.state.states[n.id];
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
            for(const c of this.project.controllers??[]) {
                const vm=this.controllers.get(c.id)!,inputs:Record<string,number>={};
                const read=(port:string)=>{
                    const wire=this.project.connections?.find(w=>w.to.device===c.id&&w.to.port===port);
                    const expression=wire&&connectionExpression(this.project,wire);
                    if(!wire||expression===undefined)return null;
                    const v=evaluate(expression,id=>samples[id]??{value:null,quality:'bad',time:this.state.time},this.state.time);
                    return v.quality==='good'&&v.value!==null?v.value*(wire.scale??1):null;
                };
                const plus=read('DC+'),minus=read('DC-'),common=read('COM1');
                const powered=plus!==null&&minus!==null&&plus-minus>=12&&plus-minus<=24;
                let healthy=powered&&common!==null&&minus!==null&&Math.abs(common-minus)<.001;
                for(const name of vm.artifact.inputs){const v=read(name);if(v===null||!Number.isFinite(v)||v< -2147483648||v>2147483647)healthy=false;else inputs[name]=Math.round(v);}
                if(!powered&&this.state.plc![c.id].powered)vm.reset();
                const screen=this.state.plc![c.id].screen;
                const scan=healthy?vm.scan(inputs,this.project.stepMs,screen):{outputs:Object.fromEntries(Object.keys(c.outputs).map(k=>[k,0])),hmi:[]};
                this.state.plc![c.id]={inputs,outputs:scan.outputs,display:scan.hmi,healthy,powered,screen,snapshot:vm.snapshot()};
            }
            this.bad = bad;
            this.state.invalidModels = [...bad];
            this.state.states = next;
            this.state.seq++;
            this.state.time = this.state.epoch + this.state.seq * this.project.stepMs;
        }
        return this.frame();
    }
    frame(): Frame { const displays:NonNullable<Frame['displays']>={};
        // Observation must never advance the PLC. Every consumer sees the image
        // produced by the last scan, including while paused or after restoration.
        for(const id of this.controllers.keys()){const saved=this.state.plc![id];displays[id]=saved.healthy?clone(saved.display??[]):[];}
        return { displays, runId: this.state.runId, revision: this.state.revision, seq: this.state.seq, time: this.state.time, paused: this.state.paused, synthetic: true, samples: this.samples(), alarms: [] }; }
    controllerKey(target:string,key:ControllerKey):void {
        const controller=this.project.controllers?.find(c=>c.id===target),state=this.state.plc?.[target];
        if(!controller||!state)throw new AppError('Unknown controller');
        state.screen=controllerScreenAfterKey(controller,state.screen,key);
    }
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
