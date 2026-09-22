import { failCode } from './diagnostics';
import { validatePresentation, type Presentation, type ViewNode } from './presentation';
import type { Expr } from './types';

export const SATURN_C23_HMI_ABI = 'saturn.hmi.port@1' as const;

export interface SaturnC23SignalSlot {
    slot: number;
    signal: string;
}

export interface SaturnC23PresentationSource {
    schema: 'saturn.c23.presentation@1';
    target: 'saturn-plc-320';
    abi: typeof SATURN_C23_HMI_ABI;
    viewId: string;
    width: 320;
    height: 240;
    signals: SaturnC23SignalSlot[];
    files: {
        'hmi.c': string;
        'saturn_hmi_port.h': string;
    };
}

const cString = (value:string):string => JSON.stringify(value)
    .replaceAll('\\u2028','\\\\u2028')
    .replaceAll('\\u2029','\\\\u2029');

const symbol = (value:string):string => value.replace(/[^A-Za-z0-9_]/g,'_').replace(/^[0-9]/,'_$&');

function refs(expr:Expr,result:Set<string>):void {
    if(typeof expr==='number'||typeof expr==='boolean')return;
    if('ref' in expr){result.add(expr.ref);return;}
    for(const arg of expr.args)refs(arg,result);
}

function expression(expr:Expr,slots:ReadonlyMap<string,number>):string {
    if(typeof expr==='number')return Number.isInteger(expr)?String(expr):Number(expr).toPrecision(17);
    if(typeof expr==='boolean')return expr?'1.0':'0.0';
    if('ref' in expr){
        const slot=slots.get(expr.ref);
        if(slot===undefined)failCode('SATURN_DSL_UNKNOWN',{kind:'signal',name:expr.ref},{signal:expr.ref,target:'saturn-plc-320'});
        return `saturn_hmi_signal(frame,${slot})`;
    }
    const args=expr.args.map(arg=>expression(arg,slots));
    switch(expr.op){
        case 'add':return '('+args.join(' + ')+')';
        case 'mul':return '('+args.join(' * ')+')';
        case 'sub':return '('+args[0]+' - '+args[1]+')';
        case 'div':return `saturn_hmi_safe_div(${args[0]},${args[1]})`;
        case 'min':return args.reduce((a,b)=>`saturn_hmi_min(${a},${b})`);
        case 'max':return args.reduce((a,b)=>`saturn_hmi_max(${a},${b})`);
        case 'gt':return '('+args[0]+' > '+args[1]+' ? 1.0 : 0.0)';
        case 'lt':return '('+args[0]+' < '+args[1]+' ? 1.0 : 0.0)';
        case 'not':return '('+args[0]+' == 0.0 ? 1.0 : 0.0)';
        case 'and':return '('+args.map(arg=>`(${arg} != 0.0)`).join(' && ')+' ? 1.0 : 0.0)';
    }
}

function portHeader(signalCount:number):string {
    return `#ifndef SATURN_HMI_PORT_H
#define SATURN_HMI_PORT_H

#include <stdint.h>
#include <stddef.h>

#define SATURN_HMI_PORT_ABI 1
#define SATURN_HMI_SIGNAL_COUNT ${signalCount}

typedef struct SaturnHmiFrame {
    uint64_t model_time_ms;
    const double *values;
    const uint8_t *quality;
    size_t count;
} SaturnHmiFrame;

/*
 * This is Saturn's stable generated-code ABI.
 * The physical target adapter implements these calls with libsatstd/satgui.
 * Firmverse implements the same ABI for the emulator. Generated project code
 * never depends on browser/React state or on legacy FBD screen records.
 */
void saturn_satgui_begin(uint16_t background_rgb565);
void saturn_satgui_text(int16_t x, int16_t y, const char *text, uint16_t color_rgb565, uint8_t font);
void saturn_satgui_value(int16_t x, int16_t y, const char *label, double value, uint8_t good, const char *unit, uint8_t digits, uint16_t color_rgb565);
void saturn_satgui_end(void);

static inline double saturn_hmi_signal(const SaturnHmiFrame *frame, size_t slot) {
    return frame && frame->values && slot < frame->count ? frame->values[slot] : 0.0;
}
static inline uint8_t saturn_hmi_good(const SaturnHmiFrame *frame, size_t slot) {
    return frame && frame->quality && slot < frame->count ? (uint8_t)(frame->quality[slot] != 0) : 0;
}
static inline double saturn_hmi_min(double a,double b){ return a < b ? a : b; }
static inline double saturn_hmi_max(double a,double b){ return a > b ? a : b; }
static inline double saturn_hmi_safe_div(double a,double b){ return b == 0.0 ? 0.0 : a / b; }

void saturn_hmi_render(const SaturnHmiFrame *frame);

#endif
`;
}

export function compileSaturnC23Presentation(view:Presentation):SaturnC23PresentationSource {
    validatePresentation(view,'saturn-plc-320');

    const referenced=new Set<string>();
    for(const expr of Object.values(view.bindings))refs(expr,referenced);
    const signals=[...referenced].sort().map((signal,slot)=>({slot,signal}));
    const slots=new Map(signals.map(item=>[item.signal,item.slot] as const));
    const bindingRefs=new Map<string,number[]>();
    const bindingFunctions:string[]=[];

    for(const [name,expr] of Object.entries(view.bindings).sort(([a],[b])=>a.localeCompare(b))){
        const used=new Set<string>();refs(expr,used);
        const ids=[...used].sort().map(id=>slots.get(id)!);
        bindingRefs.set(name,ids);
        bindingFunctions.push(
            `static double bind_${symbol(name)}(const SaturnHmiFrame *frame){ return ${expression(expr,slots)}; }`,
            `static uint8_t bind_${symbol(name)}_good(const SaturnHmiFrame *frame){ return ${ids.length?ids.map(slot=>`saturn_hmi_good(frame,${slot})`).join(' && '):'1'}; }`,
        );
    }

    const draw:string[]=[];
    let serial=0;
    const addText=(value:string,x:number,y:number,width:number):void=>{
        if(value.length>Math.floor(width/8)||y+22>240)failCode('SATURN_LIMIT',{resource:'plc.display',reason:'tooLarge'},{width,height:y+22});
        draw.push(`    saturn_satgui_text(${x},${y},${cString(value)},0xffff,0);`);
    };
    const layout=(node:ViewNode,x:number,y:number,width:number):number=>{
        serial++;
        switch(node.kind){
            case 'group':{
                const top=node.title?24:0;
                if(node.title)addText(node.title,x,y,width);
                if(node.direction==='row'){
                    const w=Math.floor(width/Math.max(1,node.children.length));
                    return top+Math.max(0,...node.children.map((child,index)=>layout(child,x+index*w,y+top,w-4)));
                }
                let height=top;for(const child of node.children)height+=layout(child,x,y+height,width);return height;
            }
            case 'text':addText(node.text,x,y,width);return 24;
            case 'value':{
                const fn=symbol(node.binding);
                const used=bindingRefs.get(node.binding);
                if(!used)failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{field:'value.binding',binding:node.binding});
                if(y+44>240)failCode('SATURN_LIMIT',{resource:'plc.display',reason:'tooLarge'},{height:y+44});
                draw.push(`    saturn_satgui_value(${x},${y},${cString(node.label)},bind_${fn}(frame),bind_${fn}_good(frame),${cString(node.unit)},${node.digits},0xffff);`);
                return 44;
            }
            default:
                failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{target:'plc-c23',nodeKind:node.kind});
        }
    };
    layout(view.body,8,8,304);

    const source=`/* Generated by Saturn. Canonical authored source is Presentation IR. */
#include "saturn_hmi_port.h"

#define SATURN_HMI_WIDTH 320
#define SATURN_HMI_HEIGHT 240

${bindingFunctions.join('\n')}

void saturn_hmi_render(const SaturnHmiFrame *frame) {
    saturn_satgui_begin(0x0841);
${draw.join('\n')}
    saturn_satgui_end();
}
`;

    return {
        schema:'saturn.c23.presentation@1',
        target:'saturn-plc-320',
        abi:SATURN_C23_HMI_ABI,
        viewId:view.id,
        width:320,
        height:240,
        signals,
        files:{'hmi.c':source,'saturn_hmi_port.h':portHeader(signals.length)},
    };
}
