import type { BuildArtifact } from '../artifact';
import { compileSaturnC23Presentation, SATURN_C23_HMI_ABI, type SaturnC23PresentationSource } from '../presentation-c23';
import { compileSaturnC23Controller, type SaturnC23ControllerSource } from '../controller-c23';
import { compileSaturnC23Shell, type SaturnC23ShellSource } from '../saturn-shell-c23';
import { failCode } from '../diagnostics';

export interface SaturnC23ToolchainIdentity {
    id: 'saturn-c23';
    compiler: string;
    version: string;
    satgui: string;
}
export interface SaturnC23Compiler {
    readonly identity: SaturnC23ToolchainIdentity;
    compile(files: Readonly<Record<string,string>>): Promise<Uint8Array>;
}
export interface SaturnPlcC23Source {
    schema:'saturn.c23.project@1';
    controllerId:string;
    presentation:SaturnC23PresentationSource;
    controller:SaturnC23ControllerSource;
    shell:SaturnC23ShellSource;
    files:Readonly<Record<string,string>>;
}
export interface SaturnPlcC23TargetArtifact {
    schema: 'saturn.target.saturn-plc-c23@1';
    target: 'saturn-plc-320';
    hash: string;
    parentBuildHash: string;
    sourceRevision: string | null;
    controllerId: string;
    presentationId: string;
    abi: typeof SATURN_C23_HMI_ABI;
    sourceHash: string;
    toolchain: SaturnC23ToolchainIdentity;
    files: Readonly<Record<string,string>>;
    binary: Uint8Array;
}
function canonical(value:unknown):string {
    if(value===null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    const object=value as Record<string,unknown>;
    return '{'+Object.keys(object).sort().filter(key=>object[key]!==undefined).map(key=>JSON.stringify(key)+':'+canonical(object[key])).join(',')+'}';
}
async function digest(value:string|Uint8Array):Promise<string>{
    const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
    const copy=new Uint8Array(bytes.byteLength);copy.set(bytes);
    const hash=await crypto.subtle.digest('SHA-256',copy.buffer);
    return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export function saturnPlcC23Source(parent:BuildArtifact,controllerId:string):SaturnPlcC23Source {
    const controller=parent.project.controllers?.find(item=>item.id===controllerId);
    if(!controller)failCode('SATURN_NOT_FOUND',{resource:'plc',id:controllerId},{controllerId});
    if(!controller.hmi.view)failCode('SATURN_PRESENTATION_INVALID',{reason:'missing'},{target:'saturn-plc-320',controllerId,field:'hmi.view'});
    const presentation=compileSaturnC23Presentation(controller.hmi.view);
    const control=compileSaturnC23Controller(controller,presentation.signals);
    const shell=compileSaturnC23Shell(parent.project,controllerId);
    return {schema:'saturn.c23.project@1',controllerId,presentation,controller:control,shell,files:{...control.files,...presentation.files,...shell.files}};
}
export async function compileSaturnPlcC23Target(parent:BuildArtifact,controllerId:string,compiler:SaturnC23Compiler):Promise<SaturnPlcC23TargetArtifact>{
    const source=saturnPlcC23Source(parent,controllerId);
    const files=source.files;
    const sourceHash='sha256:'+await digest(canonical(files));
    const binary=await compiler.compile(files);
    if(!(binary instanceof Uint8Array)||binary.byteLength===0)failCode('SATURN_RUNTIME_INVALID',{reason:'targetCompileFailed'},{target:'saturn-plc-320',controllerId});
    const payload={
        schema:'saturn.target.saturn-plc-c23@1' as const,target:'saturn-plc-320' as const,
        parentBuildHash:parent.hash,sourceRevision:parent.provenance.sourceRevision??null,controllerId,
        presentationId:source.presentation.viewId,abi:SATURN_C23_HMI_ABI,sourceHash,toolchain:compiler.identity,
        binaryHash:'sha256:'+await digest(binary),
    };
    const hash='sha256:'+await digest(canonical(payload));
    return {...payload,hash,files,binary};
}
