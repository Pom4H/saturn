import {compileProject} from '../compiler';
import {demoFiles} from '../demo/files';
import {Kernel} from '../kernel';
const project=()=>compileProject(demoFiles);
export function runPlcTrace(){
 const p=project(),k=new Kernel(p,'test','test',0);const trace:unknown[]=[];
 for(let i=0;i<100;i++){if(i===15)k.operate('BENCH-LEVEL',8);if(i===70)k.operate('BENCH-LEVEL',2);const f=k.step();if(i%5===0)trace.push({seq:f.seq,plc:k.state.plc,sensor:f.samples['LEVEL-TX.value'],lamp:f.samples['LAMP-1.brightness'],hmi:f.displays});}
 return trace;
}
export {compileController} from '../controller';
export const plcFixture=()=>project().controllers![0];
