import type { Controller, PlcBlock } from './controller';
import { failCode } from './diagnostics';
import type { Expr } from './types';
import type { SaturnC23SignalSlot } from './presentation-c23';

export interface SaturnC23ControllerSource {
    schema:'saturn.c23.controller@1';
    controllerId:string;
    setpoints:ReadonlyArray<{name:string;index:number;min:number;max:number;step:number}>;
    files:{'controller.c':string;'saturn_program.h':string;'main.c':string};
}
const cId=(value:string)=>value.replace(/[^A-Za-z0-9_]/g,'_').replace(/^[0-9]/,'_$&');
const ai=/^AI([12])$/,di=/^DI([1-9]|10)$/,ao=/^AO([12])$/,doPin=/^DO([1-9]|10|11)$/;
function inputRead(ref:string):string{const a=ai.exec(ref);if(a)return `(GetAI(${Number(a[1])-1}) * 100.0)`;const d=di.exec(ref);if(d)return `(GetDI(${Number(d[1])-1}) ? 1.0 : 0.0)`;failCode('SATURN_DSL_UNKNOWN',{kind:'plcInput',name:ref},{input:ref,target:'saturn-c23'});}
function outputRead(ref:string):string{const a=ao.exec(ref);if(a)return `GetAO(${Number(a[1])-1})`;const d=doPin.exec(ref);if(d)return `(GetDO(${Number(d[1])-1}) ? 1.0 : 0.0)`;failCode('SATURN_DSL_UNKNOWN',{kind:'plcOutput',name:ref},{output:ref,target:'saturn-c23'});}
function blockExpression(name:string,block:PlcBlock,c:Controller,stack:Set<string>):string{
 const args=block.inputs.map(arg=>expression(arg,c,new Set(stack)));
 switch(block.type){case'OR':return '('+args.map(arg=>`(${arg} != 0.0)`).join(' || ')+' ? 1.0 : 0.0)';case'XOR':return '(('+args.map(arg=>`(${arg} != 0.0)`).join(' != ')+') ? 1.0 : 0.0)';case'EQ':return '('+args[0]+' == '+args[1]+' ? 1.0 : 0.0)';case'LIM':return `saturn_min(saturn_max(${args[0]},${args[1]}),${args[2]})`;case'SUM':case'SUMM':return '('+args.join(' + ')+')';default:failCode('SATURN_PLC_INVALID',{reason:'unsupportedOperator'},{target:'saturn-c23',block:name,blockType:block.type});}
}
function expression(expr:Expr,c:Controller,stack=new Set<string>()):string{
 if(typeof expr==='number')return Number.isInteger(expr)?String(expr):Number(expr).toPrecision(17);if(typeof expr==='boolean')return expr?'1.0':'0.0';
 if('ref'in expr){if(Object.hasOwn(c.setpoints??{},expr.ref))return `saturn_sp_${cId(expr.ref)}`;if(ai.test(expr.ref)||di.test(expr.ref))return inputRead(expr.ref);if(ao.test(expr.ref)||doPin.test(expr.ref))return outputRead(expr.ref);const block=c.blocks?.[expr.ref];if(block){if(stack.has(expr.ref))failCode('SATURN_PLC_INVALID',{reason:'cycle'},{block:expr.ref,target:'saturn-c23'});stack.add(expr.ref);const value=blockExpression(expr.ref,block,c,stack);stack.delete(expr.ref);return value;}failCode('SATURN_DSL_UNKNOWN',{kind:'plcReference',name:expr.ref},{ref:expr.ref,target:'saturn-c23'});}
 const args=expr.args.map(arg=>expression(arg,c,new Set(stack)));switch(expr.op){case'add':return '('+args.join(' + ')+')';case'mul':return '('+args.join(' * ')+')';case'sub':return '('+args[0]+' - '+args[1]+')';case'div':return `saturn_safe_div(${args[0]},${args[1]})`;case'min':return args.reduce((a,b)=>`saturn_min(${a},${b})`);case'max':return args.reduce((a,b)=>`saturn_max(${a},${b})`);case'gt':return '('+args[0]+' > '+args[1]+' ? 1.0 : 0.0)';case'lt':return '('+args[0]+' < '+args[1]+' ? 1.0 : 0.0)';case'not':return '('+args[0]+' == 0.0 ? 1.0 : 0.0)';case'and':return '('+args.map(arg=>`(${arg} != 0.0)`).join(' && ')+' ? 1.0 : 0.0)';}
}
function outputWrite(pin:string,value:string):string{const a=ao.exec(pin);if(a)return `    SetAO(${Number(a[1])-1},(float)(${value}));`;const d=doPin.exec(pin);if(d)return `    SetDO(${Number(d[1])-1},(${value}) != 0.0);`;failCode('SATURN_DSL_UNKNOWN',{kind:'plcOutput',name:pin},{output:pin,target:'saturn-c23'});}
function signalExpression(signal:string,c:Controller):string{const local=signal.startsWith(c.id+'.')?signal.slice(c.id.length+1):signal;if(Object.hasOwn(c.setpoints??{},local))return `saturn_sp_${cId(local)}`;if(ai.test(local)||di.test(local))return inputRead(local);if(ao.test(local)||doPin.test(local))return outputRead(local);const block=c.blocks?.[local];if(block)return blockExpression(local,block,c,new Set([local]));failCode('SATURN_DSL_UNKNOWN',{kind:'targetSignal',name:signal},{signal,target:'saturn-c23',controllerId:c.id});}
export function compileSaturnC23Controller(c:Controller,signals:readonly SaturnC23SignalSlot[]):SaturnC23ControllerSource{
 const outputs=Object.entries(c.outputs).sort(([a],[b])=>a.localeCompare(b));
 const setpoints=Object.entries(c.setpoints??{}).sort(([a],[b])=>a.localeCompare(b)).map(([name,sp],index)=>({name,index,min:sp.min,max:sp.max,step:sp.step??1,initial:sp.initial}));
 const spDecl=setpoints.map(sp=>`static double saturn_sp_${cId(sp.name)} = ${sp.initial};`);
 const writes=outputs.map(([pin,expr])=>outputWrite(pin,expression(expr,c)));
 const slotCases=signals.map(({slot,signal})=>`        case ${slot}: return ${signalExpression(signal,c)};`);
 const spGet=setpoints.map(sp=>`        case ${sp.index}: return saturn_sp_${cId(sp.name)};`);
 const spSet=setpoints.map(sp=>`        case ${sp.index}: saturn_sp_${cId(sp.name)}=saturn_min(${sp.max},saturn_max(${sp.min},value)); return;`);
 const spAdjust=setpoints.map(sp=>`        case ${sp.index}: saturn_program_setpoint_set(${sp.index},saturn_sp_${cId(sp.name)} + steps * ${sp.step}); return;`);
 const header=`#ifndef SATURN_PROGRAM_H
#define SATURN_PROGRAM_H
#include <stdint.h>
#include <satgui.h>
void saturn_program_init(void);
void saturn_program_step(void);
double saturn_program_signal(uint16_t slot);
uint8_t saturn_program_signal_good(uint16_t slot);
double saturn_program_setpoint(uint16_t index);
void saturn_program_setpoint_set(uint16_t index,double value);
void saturn_program_setpoint_adjust(uint16_t index,int steps);
void saturn_hmi_init(void);
void saturn_hmi_update(void);
gui_screen_t *saturn_hmi_screen(void);
void saturn_shell_init(gui_screen_t *main_screen);
void saturn_shell_update(void);
#endif
`;
 const source=`/* Generated from canonical Controller model. */
#include <satmio.h>
#include "saturn_program.h"
static inline double saturn_min(double a,double b){return a<b?a:b;}
static inline double saturn_max(double a,double b){return a>b?a:b;}
static inline double saturn_safe_div(double a,double b){return b==0.0?0.0:a/b;}
${spDecl.join('\n')}
void saturn_program_init(void){${outputs.map(([pin])=>outputWrite(pin,'0.0')).join('\n')}}
void saturn_program_step(void){${writes.join('\n')}}
double saturn_program_signal(uint16_t slot){switch(slot){${slotCases.join('\n')}default:return 0.0;}}
uint8_t saturn_program_signal_good(uint16_t slot){return slot<${signals.length}?1:0;}
double saturn_program_setpoint(uint16_t index){switch(index){${spGet.join('\n')}default:return 0.0;}}
void saturn_program_setpoint_set(uint16_t index,double value){switch(index){${spSet.join('\n')}default:return;}}
void saturn_program_setpoint_adjust(uint16_t index,int steps){switch(index){${spAdjust.join('\n')}default:return;}}
`;
 const main=`#include <satplc.h>
#include <satkbd.h>
#include <satgui.h>
#include "saturn_program.h"
void main(void){
 SetEnableKeyboard(1);
 saturn_program_init();
 saturn_hmi_init();
 saturn_shell_init(saturn_hmi_screen());
 while(1){saturn_program_step();saturn_hmi_update();saturn_shell_update();gui_process(50);}
}
`;
 return{schema:'saturn.c23.controller@1',controllerId:c.id,setpoints:setpoints.map(({initial,...sp})=>sp),files:{'controller.c':source,'saturn_program.h':header,'main.c':main}};
}
