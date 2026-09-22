import type { Controller, PlcBlock } from './controller';
import { failCode } from './diagnostics';
import type { Expr } from './types';
import type { SaturnC23SignalSlot } from './presentation-c23';

export interface SaturnC23ControllerSource {
    schema: 'saturn.c23.controller@1';
    controllerId: string;
    files: {
        'controller.c': string;
        'saturn_program.h': string;
        'main.c': string;
    };
}

const cId=(value:string):string=>value.replace(/[^A-Za-z0-9_]/g,'_').replace(/^[0-9]/,'_$&');
const analogInput=/^AI([12])$/;
const digitalInput=/^DI([1-9]|10)$/;
const analogOutput=/^AO([12])$/;
const digitalOutput=/^DO([1-9]|10|11)$/;

function inputRead(ref:string):string {
    const ai=analogInput.exec(ref);
    if(ai)return `(GetAI(${Number(ai[1])-1}) * 100.0)`;
    const di=digitalInput.exec(ref);
    if(di)return `(GetDI(${Number(di[1])-1}) ? 1.0 : 0.0)`;
    failCode('SATURN_DSL_UNKNOWN',{kind:'plcInput',name:ref},{input:ref,target:'saturn-c23'});
}

function outputRead(ref:string):string {
    const ao=analogOutput.exec(ref);
    if(ao)return `saturn_output_AO${ao[1]}`;
    const d=digitalOutput.exec(ref);
    if(d)return `saturn_output_DO${d[1]}`;
    failCode('SATURN_DSL_UNKNOWN',{kind:'plcOutput',name:ref},{output:ref,target:'saturn-c23'});
}

function expression(expr:Expr,controller:Controller,stack:Set<string>=new Set()):string {
    if(typeof expr==='number')return Number.isInteger(expr)?String(expr):Number(expr).toPrecision(17);
    if(typeof expr==='boolean')return expr?'1.0':'0.0';
    if('ref' in expr){
        if(analogInput.test(expr.ref)||digitalInput.test(expr.ref))return inputRead(expr.ref);
        if(analogOutput.test(expr.ref)||digitalOutput.test(expr.ref))return outputRead(expr.ref);
        const block=controller.blocks?.[expr.ref];
        if(block){
            if(stack.has(expr.ref))failCode('SATURN_PLC_INVALID',{reason:'cycle'},{block:expr.ref,target:'saturn-c23'});
            stack.add(expr.ref);
            const value=blockExpression(expr.ref,block,controller,stack);
            stack.delete(expr.ref);
            return value;
        }
        failCode('SATURN_DSL_UNKNOWN',{kind:'plcReference',name:expr.ref},{ref:expr.ref,target:'saturn-c23'});
    }
    const args=expr.args.map(arg=>expression(arg,controller,new Set(stack)));
    switch(expr.op){
        case 'add':return '('+args.join(' + ')+')';
        case 'mul':return '('+args.join(' * ')+')';
        case 'sub':return '('+args[0]+' - '+args[1]+')';
        case 'div':return `saturn_safe_div(${args[0]},${args[1]})`;
        case 'min':return args.reduce((a,b)=>`saturn_min(${a},${b})`);
        case 'max':return args.reduce((a,b)=>`saturn_max(${a},${b})`);
        case 'gt':return '('+args[0]+' > '+args[1]+' ? 1.0 : 0.0)';
        case 'lt':return '('+args[0]+' < '+args[1]+' ? 1.0 : 0.0)';
        case 'not':return '('+args[0]+' == 0.0 ? 1.0 : 0.0)';
        case 'and':return '('+args.map(arg=>`(${arg} != 0.0)`).join(' && ')+' ? 1.0 : 0.0)';
    }
}

function blockExpression(name:string,block:PlcBlock,controller:Controller,stack:Set<string>):string {
    const args=block.inputs.map(arg=>expression(arg,controller,new Set(stack)));
    switch(block.type){
        case 'OR':return '('+args.map(arg=>`(${arg} != 0.0)`).join(' || ')+' ? 1.0 : 0.0)';
        case 'XOR':return '((' + args.map(arg=>`(${arg} != 0.0)`).join(' != ') + ') ? 1.0 : 0.0)';
        case 'EQ':return '('+args[0]+' == '+args[1]+' ? 1.0 : 0.0)';
        case 'LIM':return `saturn_min(saturn_max(${args[0]},${args[1]}),${args[2]})`;
        case 'SUM':
        case 'SUMM':return '('+args.join(' + ')+')';
        default:
            failCode('SATURN_PLC_INVALID',{reason:'unsupportedOperator'},{target:'saturn-c23',block:name,blockType:block.type});
    }
}

function outputWrite(pin:string,value:string):string {
    const ao=analogOutput.exec(pin);
    if(ao)return `    saturn_output_AO${ao[1]} = ${value};\\n    SetAO(${Number(ao[1])-1},(float)saturn_output_AO${ao[1]});`;
    const d=digitalOutput.exec(pin);
    if(d)return `    saturn_output_DO${d[1]} = (${value}) != 0.0 ? 1.0 : 0.0;\\n    SetDO(${Number(d[1])-1},saturn_output_DO${d[1]} != 0.0);`;
    failCode('SATURN_DSL_UNKNOWN',{kind:'plcOutput',name:pin},{output:pin,target:'saturn-c23'});
}

function signalExpression(signal:string,controller:Controller):string {
    const local=signal.startsWith(controller.id+'.')?signal.slice(controller.id.length+1):signal;
    if(analogInput.test(local)||digitalInput.test(local))return inputRead(local);
    if(analogOutput.test(local)||digitalOutput.test(local))return outputRead(local);
    failCode('SATURN_DSL_UNKNOWN',{kind:'targetSignal',name:signal},{signal,target:'saturn-c23',controllerId:controller.id});
}

export function compileSaturnC23Controller(controller:Controller,signals:readonly SaturnC23SignalSlot[]):SaturnC23ControllerSource {
    const outputs=Object.entries(controller.outputs).sort(([a],[b])=>a.localeCompare(b));
    const declarations=outputs.map(([pin])=>`static double saturn_output_${cId(pin)} = 0.0;`);
    const writes=outputs.map(([pin,expr])=>outputWrite(pin,expression(expr,controller)));
    const slotCases=signals.map(({slot,signal})=>`        case ${slot}: return ${signalExpression(signal,controller)};`);

    const header=`#ifndef SATURN_PROGRAM_H
#define SATURN_PROGRAM_H

#include <stdint.h>

void saturn_program_init(void);
void saturn_program_step(void);
double saturn_program_signal(uint16_t slot);
uint8_t saturn_program_signal_good(uint16_t slot);
void saturn_hmi_init(void);
void saturn_hmi_update(void);

#endif
`;

    const source=`/* Generated by Saturn from the canonical Controller model. */
#include <satmio.h>
#include "saturn_program.h"

static inline double saturn_min(double a,double b){ return a < b ? a : b; }
static inline double saturn_max(double a,double b){ return a > b ? a : b; }
static inline double saturn_safe_div(double a,double b){ return b == 0.0 ? 0.0 : a / b; }

${declarations.join('\\n')}

void saturn_program_init(void) {
${outputs.map(([pin])=>outputWrite(pin,'0.0')).join('\\n')}
}

void saturn_program_step(void) {
${writes.join('\\n')}
}

double saturn_program_signal(uint16_t slot) {
    switch(slot) {
${slotCases.join('\\n')}
        default: return 0.0;
    }
}

uint8_t saturn_program_signal_good(uint16_t slot) {
    return slot < ${signals.length} ? 1 : 0;
}
`;

    const main=`/* Saturn PLC C23 application: control + HMI share one executable target. */
#include <satkbd.h>
#include <satgui.h>
#include "saturn_program.h"

void main(void) {
    SetEnableKeyboard(1);
    saturn_program_init();
    saturn_hmi_init();
    for (;;) {
        saturn_program_step();
        saturn_hmi_update();
        gui_process(50);
    }
    return 0;
}
`;

    return {
        schema:'saturn.c23.controller@1',
        controllerId:controller.id,
        files:{'controller.c':source,'saturn_program.h':header,'main.c':main},
    };
}
