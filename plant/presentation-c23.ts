import { failCode } from './diagnostics';
import { validatePresentation, type Presentation, type ViewNode } from './presentation';
import type { Expr } from './types';
import type { HmiBinding, HmiNode, SaturnHmiScene } from './hmi-frame';

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

const cString=(value:string):string=>JSON.stringify(value);
const symbol=(value:string):string=>value.replace(/[^A-Za-z0-9_]/g,'_').replace(/^[0-9]/,'_$&');

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

export function compileSaturnC23Presentation(view:Presentation,scene?:SaturnHmiScene):SaturnC23PresentationSource {
    validatePresentation(view,'saturn-plc-320');
    const referenced=new Set<string>();
    for(const expr of Object.values(view.bindings))refs(expr,referenced);
    const sceneBindings:HmiBinding[]=[];
    const collectBinding=(binding:HmiBinding|undefined)=>{if(binding){sceneBindings.push(binding);referenced.add(binding.signal);}};
    for(const node of scene?.nodes??[]){collectBinding(node.visible);if(node.kind==='text'&&typeof node.text!=='string')collectBinding(node.text.value);if(node.kind==='tank')collectBinding(node.level);if(node.kind==='pump')collectBinding(node.rpm);if(node.kind==='flow')collectBinding(node.value);if(node.kind==='lamp')collectBinding(node.value);}
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
                init.push(`    ${id}=gui_text_create(${x},${y},${Math.min(319,x+width)},${Math.min(239,y+34)},-1,0,0,RGB(239,252,255),_FONT12x16,0,${cString(node.label)});\n    gui_screen_add(saturn_main_screen,${id});`);
                const format=cString(`%s%.${node.digits}f%s`);
                update.push(`    if(bind_${fn}_good()) gui_text_set(${id},${format},${cString(node.label)},bind_${fn}(),${cString(node.unit)}); else gui_text_set(${id},"%s -- %s",${cString(node.label)},${cString(node.unit)});`);
                return 40;
            }
            default:
                failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{target:'plc-c23',nodeKind:node.kind});
        }
    };
    layout(view.body,8,8,304);

    const sceneInit:string[]=[];
    const sceneUpdate:string[]=[];
    const bindingValue=(binding:HmiBinding):string=>{
        const slot=slots.get(binding.signal);
        if(slot===undefined)failCode('SATURN_DSL_UNKNOWN',{kind:'signal',name:binding.signal},{signal:binding.signal,target:'saturn-plc-320'});
        let value=`saturn_program_signal(${slot})`;
        if(binding.scale!==undefined)value=`(${value} * ${binding.scale})`;
        if(binding.offset!==undefined)value=`(${value} + ${binding.offset})`;
        if(binding.min!==undefined)value=`saturn_hmi_max(${binding.min},${value})`;
        if(binding.max!==undefined)value=`saturn_hmi_min(${binding.max},${value})`;
        return value;
    };
    const color=(value:number)=>value;
    const addSceneNode=(node:HmiNode,index:number):void=>{
        const id=`hmi_scene_${index}`;
        if(node.kind==='rect'){
            declarations.push(`static gui_element_t *${id};`);
            sceneInit.push(`    ${id}=gui_rect_create(${Math.round(node.x)},${Math.round(node.y)},${Math.round(node.x+node.width)},${Math.round(node.y+node.height)},${color(node.fill)},${Math.round(node.strokeWidth??0)},${color(node.stroke??node.fill)}); gui_screen_add(saturn_main_screen,${id});`);
        } else if(node.kind==='circle'){
            declarations.push(`static gui_element_t *${id};`);
            sceneInit.push(`    ${id}=gui_circle_create(${Math.round(node.cx-node.r)},${Math.round(node.cy-node.r)},${Math.round(node.cx+node.r)},${Math.round(node.cy+node.r)},${color(node.fill)},${Math.round(node.strokeWidth??0)},${color(node.stroke??node.fill)}); gui_screen_add(saturn_main_screen,${id});`);
        } else if(node.kind==='line'){
            declarations.push(`static gui_element_t *${id};`);
            sceneInit.push(`    ${id}=gui_line_create(${Math.round(node.x1)},${Math.round(node.y1)},${Math.round(node.x2)},${Math.round(node.y2)},${Math.max(1,Math.round(node.width??1))},${color(node.color)}); gui_screen_add(saturn_main_screen,${id});`);
        } else if(node.kind==='text'){
            declarations.push(`static gui_element_t *${id};`);
            const text=typeof node.text==='string'?node.text:'';
            sceneInit.push(`    ${id}=gui_text_create(${Math.round(node.x)},${Math.round(node.y)},319,${Math.min(239,Math.round(node.y+20))},-1,0,0,${color(node.color)},_FONT12x16,0,${cString(text)}); gui_screen_add(saturn_main_screen,${id});`);
            if(typeof node.text!=='string'){
                const value=bindingValue(node.text.value),format=cString(`${node.text.prefix??''}%.${node.text.digits??0}f${node.text.suffix??''}`);
                sceneUpdate.push(`    gui_text_set(${id},${format},${value});`);
            }
        } else if(node.kind==='tank'){
            declarations.push(`static gui_element_t *${id};`);
            sceneInit.push(`    ${id}=gui_gauge_create(${Math.round(node.x)},${Math.round(node.y)},${Math.round(node.x+node.width)},${Math.round(node.y+node.height)},${color(node.background)},${Math.max(1,Math.round(node.strokeWidth??2))},${color(node.shell)},${color(node.water)},GAUGE_VERTICAL,1.0f); gui_screen_add(saturn_main_screen,${id});`);
            sceneUpdate.push(`    gui_gauge_set(${id},(float)saturn_hmi_min(1.0,saturn_hmi_max(0.0,${bindingValue(node.level)})));`);
        } else if(node.kind==='lamp'){
            declarations.push(`static gui_element_t *${id};`);
            sceneInit.push(`    ${id}=gui_circle_create(${Math.round(node.cx-node.r)},${Math.round(node.cy-node.r)},${Math.round(node.cx+node.r)},${Math.round(node.cy+node.r)},${color(node.off)},1,${color(node.stroke??node.off)}); gui_screen_add(saturn_main_screen,${id});`);
            sceneUpdate.push(`    ${id}->color=(${bindingValue(node.value)} > 0.001)?${color(node.on)}:${color(node.off)};`);
        } else if(node.kind==='pump'){
            const count=Math.max(3,Math.min(8,Math.round(node.bladeCount??6)));
            declarations.push(...Array.from({length:count},(_,i)=>`static gui_element_t *${id}_b${i};`));
            const radius=Math.max(4,Math.round(node.r*.72));
            for(let i=0;i<count;i++)sceneInit.push(`    ${id}_b${i}=gui_line_create(${Math.round(node.cx)},${Math.round(node.cy)},${Math.round(node.cx+radius)},${Math.round(node.cy)},2,${color(i%2===0?node.bladeA:(node.bladeB??node.bladeA))}); gui_screen_add(saturn_main_screen,${id}_b${i});`);
            const rpm=bindingValue(node.rpm);
            const table=[[-1,0],[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1]];
            sceneUpdate.push(`    { int phase=((int)(saturn_hmi_time_ms * saturn_hmi_max(0.0,${rpm}) / 7500.0)) & 7; static const int8_t dx[8]={-1,-1,0,1,1,1,0,-1}; static const int8_t dy[8]={0,-1,-1,-1,0,1,1,1};`);
            for(let i=0;i<count;i++)sceneUpdate.push(`      { int p=(phase+${Math.round(i*8/count)})&7; ${id}_b${i}->x2=(uint16_t)(${Math.round(node.cx)}+dx[p]*${radius}); ${id}_b${i}->y2=(uint16_t)(${Math.round(node.cy)}+dy[p]*${radius}); }`);
            sceneUpdate.push('    }');
        } else if(node.kind==='flow'){
            const points=node.points;
            if(points.length>=2){
                const packets=Math.min(6,Math.max(1,Math.floor(points.length*1.5)));
                declarations.push(...Array.from({length:packets},(_,i)=>`static gui_element_t *${id}_p${i};`));
                for(let i=0;i<packets;i++)sceneInit.push(`    ${id}_p${i}=gui_circle_create(${Math.round(points[0]!.x-2)},${Math.round(points[0]!.y-2)},${Math.round(points[0]!.x+2)},${Math.round(points[0]!.y+2)},${color(node.color)},0,${color(node.color)}); gui_screen_add(saturn_main_screen,${id}_p${i});`);
                const flat=points.flatMap(p=>[Math.round(p.x),Math.round(p.y)]);
                sceneUpdate.push(`    { static const int16_t pts[] = {${flat.join(',')}}; const int n=${points.length}; double flow=${bindingValue(node.value)}; int step=(int)(saturn_hmi_time_ms * (flow<0?-flow:flow) / 120.0); for(int i=0;i<${packets};i++){ int p=(step+i)%n; if(flow<0)p=(n-1)-p; gui_element_t *e=${id}_p0;`);
                for(let i=1;i<packets;i++)sceneUpdate.push(`      if(i==${i})e=${id}_p${i};`);
                sceneUpdate.push('      e->x1=(uint16_t)(pts[p*2]-2); e->y1=(uint16_t)(pts[p*2+1]-2); e->x2=(uint16_t)(pts[p*2]+2); e->y2=(uint16_t)(pts[p*2+1]+2); e->visible=(flow>0.001||flow<-0.001); } }');
            }
        }
    };
    (scene?.nodes??[]).forEach(addSceneNode);

    const source=`/* Generated by Saturn from canonical Presentation IR.
 * Uses the real Saturn C23 SDK API (<satgui.h>).
 */
#include <stdint.h>
#include <satgui.h>
#include <satscr.h>
#include "saturn_program.h"

static gui_screen_t *saturn_main_screen;
static uint32_t saturn_hmi_time_ms;
${declarations.join('\n')}

static inline double saturn_hmi_min(double a,double b){ return a < b ? a : b; }
static inline double saturn_hmi_max(double a,double b){ return a > b ? a : b; }
static inline double saturn_hmi_safe_div(double a,double b){ return b == 0.0 ? 0.0 : a / b; }

${bindingFunctions.join('\n')}

void saturn_hmi_init(void) {
    saturn_main_screen=gui_screen_create(RGB(5,18,25),0);
${init.join('\n')}
${sceneInit.join('\n')}
    gui_screen_show(saturn_main_screen);
}

void saturn_hmi_update(void) {
    saturn_hmi_time_ms += 50;
${update.join('\n')}
${sceneUpdate.join('\n')}
}

gui_screen_t *saturn_hmi_screen(void) {
    return saturn_main_screen;
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
