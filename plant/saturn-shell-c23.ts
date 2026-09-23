import type { Controller } from './controller';
import type { Expr, Project } from './types';

export interface SaturnC23ShellSource { schema:'saturn.c23.shell@1'; pages:string[]; files:{'shell.c':string} }
const cString=(value:string)=>JSON.stringify(value);
const cId=(value:string)=>value.replace(/[^A-Za-z0-9_]/g,'_').replace(/^[0-9]/,'_$&');
const ai=/^AI([12])$/,di=/^DI([1-9]|10)$/,ao=/^AO([12])$/,doPin=/^DO([1-9]|10|11)$/;
function readPin(pin:string):{code:string;format:string}|null{let m=ai.exec(pin);if(m)return{code:`GetAI(${Number(m[1])-1})`,format:'%.2f'};m=di.exec(pin);if(m)return{code:`GetDI(${Number(m[1])-1})`,format:'%d'};m=ao.exec(pin);if(m)return{code:`GetAO(${Number(m[1])-1})`,format:'%.2f'};m=doPin.exec(pin);if(m)return{code:`GetDO(${Number(m[1])-1})`,format:'%d'};return null;}
function refs(expr:Expr|undefined,c:Controller,result:Set<string>,seen=new Set<string>()):void{if(expr===undefined||typeof expr==='number'||typeof expr==='boolean')return;if('ref'in expr){if(Object.hasOwn(c.setpoints??{},expr.ref)){result.add(expr.ref);return;}const b=c.blocks?.[expr.ref];if(b&&!seen.has(expr.ref)){seen.add(expr.ref);for(const input of b.inputs)refs(input,c,result,seen);}return;}for(const arg of expr.args)refs(arg,c,result,seen);}
function inputs(expr:Expr|undefined,c:Controller,result:Set<string>,seen=new Set<string>()):void{if(expr===undefined||typeof expr==='number'||typeof expr==='boolean')return;if('ref'in expr){if(ai.test(expr.ref)||di.test(expr.ref))result.add(expr.ref);const b=c.blocks?.[expr.ref];if(b&&!seen.has(expr.ref)){seen.add(expr.ref);for(const input of b.inputs)inputs(input,c,result,seen);}return;}for(const arg of expr.args)inputs(arg,c,result,seen);}
export function compileSaturnC23Shell(project:Project,controllerId:string):SaturnC23ShellSource{
 const c=project.controllers?.find(item=>item.id===controllerId);if(!c)throw new Error('Unknown controller '+controllerId);
 const inputPins=new Set<string>();for(const expr of Object.values(c.outputs))inputs(expr,c,inputPins);
 const outputs=Object.keys(c.outputs).sort();const io=[...inputPins].sort().concat(outputs).slice(0,7);
 const peers=[...new Set((project.connections??[]).flatMap(w=>w.from.device===controllerId?[w.to.device]:w.to.device===controllerId?[w.from.device]:[]))];
 const devices=peers.map(id=>project.devices.find(d=>d.id===id)).filter((d):d is NonNullable<typeof d>=>!!d).slice(0,8);
 const expansions=(project.attachments??[]).filter(a=>a.controller===controllerId);
 const declarations:string[]=['static gui_screen_t *shell_io;','static gui_screen_t *shell_network;'];
 const init:string[]=[];const update:string[]=[];const pageNames=['overview','io','network'];
 const addText=(screen:string,x:number,y:number,text:string)=>init.push(`    gui_screen_add(${screen},gui_text_create(${x},${y},310,${Math.min(235,y+18)},-1,0,0,RGB(239,252,255),_FONT12x16,0,${cString(text)}));`);
 init.push('    shell_io=gui_screen_create(RGB(5,18,25),0);');addText('shell_io',8,8,'I/O diagnostics');
 io.forEach((pin,index)=>{const reader=readPin(pin);if(!reader)return;const id='shell_io_'+index;declarations.push(`static gui_element_t *${id};`);init.push(`    ${id}=gui_screen_add(shell_io,gui_text_create(8,${34+index*26},310,${52+index*26},-1,0,0,RGB(239,252,255),_FONT12x16,0,${cString(pin)}));`);update.push(`    gui_text_set(${id},${cString(pin+' '+reader.format)},${reader.code});`);});
 init.push('    shell_network=gui_screen_create(RGB(5,18,25),0);');addText('shell_network',8,8,'Network');
 if(expansions.length)expansions.slice(0,6).forEach((a,i)=>addText('shell_network',8,36+i*26,`slot ${a.slot}: ${a.device} / ${a.profile}`));else addText('shell_network',8,40,'No expansion modules');
 const deviceScreens:string[]=[];
 devices.forEach((device,index)=>{const s='shell_device_'+index;pageNames.push('device.'+device.id);deviceScreens.push(s);declarations.push(`static gui_screen_t *${s};`);init.push(`    ${s}=gui_screen_create(RGB(5,18,25),0);`);addText(s,8,8,device.id);addText(s,8,32,device.type);
   const wires=(project.connections??[]).filter(w=>w.from.device===controllerId&&w.to.device===device.id||w.to.device===controllerId&&w.from.device===device.id).slice(0,4);
   let y=60;for(const w of wires){const pin=w.from.device===controllerId?w.from.port:w.to.port;addText(s,8,y,`PLC ${pin} / ${w.medium}`);const reader=readPin(pin);if(reader){const id='shell_dev_'+index+'_'+cId(pin);declarations.push(`static gui_element_t *${id};`);init.push(`    ${id}=gui_screen_add(${s},gui_text_create(150,${y},310,${y+18},-1,0,0,RGB(54,216,231),_FONT12x16,0,""));`);update.push(`    gui_text_set(${id},${cString(reader.format)},${reader.code});`);}y+=28;}
   const controlPin=wires.map(w=>w.from.device===controllerId?w.from.port:w.to.port).find(pin=>doPin.test(pin)||ao.test(pin));const setRefs=new Set<string>();if(controlPin)refs(c.outputs[controlPin],c,setRefs);const sp=[...setRefs][0];if(sp){const order=Object.keys(c.setpoints??{}).sort();const spIndex=order.indexOf(sp);declarations.push(`static int shell_key_${index}(gui_screen_t *screen,int key){(void)screen;if(key==KEY_UP){saturn_program_setpoint_adjust(${spIndex},1);return 0;}if(key==KEY_DOWN){saturn_program_setpoint_adjust(${spIndex},-1);return 0;}return 0;}`);init.push(`    ${s}->onkeypress=shell_key_${index};`);addText(s,8,206,'UP/DOWN setpoint');}
 });
 init.push('    main_screen->linkdown=shell_io;','    main_screen->linkup=shell_network;');
 if(deviceScreens.length)init.push(`    main_screen->linkright=${deviceScreens[0]};`);else init.push('    main_screen->linkright=shell_io;');
 init.push('    shell_io->linkleft=main_screen;','    shell_io->linkup=main_screen;','    shell_io->linkright=shell_network;','    shell_network->linkleft=main_screen;','    shell_network->linkdown=shell_io;');
 deviceScreens.forEach((s,i)=>{init.push(`    ${s}->linkleft=${i===0?'main_screen':deviceScreens[i-1]};`,`    ${s}->linkright=${i===deviceScreens.length-1?'shell_io':deviceScreens[i+1]};`,`    ${s}->linkdown=shell_io;`);});
 const source=`/* Generated target-only topology shell. Authored UI remains Presentation. */
#include <satgui.h>
#include <satkbd.h>
#include <satmio.h>
#include "saturn_program.h"
${declarations.join('\n')}
void saturn_shell_init(gui_screen_t *main_screen){
${init.join('\n')}
}
void saturn_shell_update(void){
${update.join('\n')}
}
`;
 return{schema:'saturn.c23.shell@1',pages:pageNames,files:{'shell.c':source}};
}
