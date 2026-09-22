import { failCode } from './diagnostics';
import { validatePresentation, type Presentation, type ViewNode } from './presentation';
import type { Expr } from './types';

export const SATURN_C23_HMI_ABI = 'saturn.c23.satgui@1' as const;

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
    files: { 'hmi.c': string };
}

const cString=(value:string):string=>JSON.stringify(value);\nconst symbol=(value:string):string=>value.replace(/[^A-Za-z0-9_]/g,'_').replace(/^[0-9]/,'_$&');

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
        return `saturn_program_signal(${slot})`;
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
            `static double bind_${symbol(name)}(void){ return ${expression(expr,slots)}; }`,
            `static uint8_t bind_${symbol(name)}_good(void){ return ${ids.length?ids.map(slot=>`saturn_program_signal_good(${slot})`).join(' && '):'1'}; }`,
        );
    }

    const init:string[]=[];
    const update:string[]=[];
    const declarations:string[]=[];
    let serial=0;
    const addStatic=(value:string,x:number,y:number,width:number):void=>{
        if(value.length>Math.floor(width/7)||y+20>240)failCode('SATURN_LIMIT',{resource:'plc.display',reason:'tooLarge'},{width,height:y+20});
        init.push(`    gui_screen_add(saturn_main_screen,gui_text_create(${x},${y},${Math.min(319,x+width)},${Math.min(239,y+18)},-1,0,0,RGB(239,252,255),_FONT12x16,0,${cString(value)}));`);
    };
    const layout=(node:ViewNode,x:number,y:number,width:number):number=>{
        switch(node.kind){
            case 'group':{
                const top=node.title?22:0;
                if(node.title)addStatic(node.title,x,y,width);
                if(node.direction==='row'){
                    const w=Math.floor(width/Math.max(1,node.children.length));
                    return top+Math.max(0,...node.children.map((child,index)=>layout(child,x+index*w,y+top,w-4)));
                }
                let height=top;for(const child of node.children)height+=layout(child,x,y+height,width);return height;
            }
            case 'text':addStatic(node.text,x,y,width);return 22;
            case 'value':{
                const fn=symbol(node.binding);
                if(!bindingRefs.has(node.binding))failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{field:'value.binding',binding:node.binding});
                if(y+40>240)failCode('SATURN_LIMIT',{resource:'plc.display',reason:'tooLarge'},{height:y+40});
                const id='hmi_value_'+serial++;
                declarations.push(`static gui_element_t *${id};`);
                init.push(`    ${id}=gui_text_create(${x},${y},${Math.min(319,x+width)},${Math.min(239,y+34)},-1,0,0,RGB(239,252,255),_FONT12x16,0,${cString(node.label)});\\n    gui_screen_add(saturn_main_screen,${id});`);
                const format=cString(`%s%.${node.digits}f%s`);
                update.push(`    if(bind_${fn}_good()) gui_text_set(${id},${format},${cString(node.label)},bind_${fn}(),${cString(node.unit)}); else gui_text_set(${id},"%s -- %s",${cString(node.label)},${cString(node.unit)});`);
                return 40;
            }
            default:
                failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{target:'plc-c23',nodeKind:node.kind});
        }
    };
    layout(view.body,8,8,304);

    const source=`/* Generated by Saturn from canonical Presentation IR.
 * Uses the real Saturn C23 SDK API (<satgui.h>), not FBD screen records.
 */
#include <stdint.h>
#include <satgui.h>
#include <satscr.h>
#include "saturn_program.h"

static gui_screen_t *saturn_main_screen;
${declarations.join('\\n')}

static inline double saturn_hmi_min(double a,double b){ return a < b ? a : b; }
static inline double saturn_hmi_max(double a,double b){ return a > b ? a : b; }
static inline double saturn_hmi_safe_div(double a,double b){ return b == 0.0 ? 0.0 : a / b; }

${bindingFunctions.join('\\n')}

void saturn_hmi_init(void) {
    saturn_main_screen=gui_screen_create(RGB(5,18,25),0);
${init.join('\\n')}
}

void saturn_hmi_update(void) {
${update.join('\\n')}
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
        files:{'hmi.c':source},
    };
}
