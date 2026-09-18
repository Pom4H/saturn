import { AppError } from './types';
import { presentationScreens, validatePresentation, type Presentation, type ViewNode } from './presentation';
import type { HmiScreenModel } from './vendor/saturn/src/types';
/** Small controller screen backend. Unsupported nodes/overflow fail, never silently disappear. */
export function presentationHmi(view:Presentation,bindings:Record<string,string>):HmiScreenModel {
    return presentationHmiScreens(view,bindings)[0];
}
export function presentationHmiScreens(view:Presentation,bindings:Record<string,string>):HmiScreenModel[] {
    validatePresentation(view,'plc');
    return presentationScreens(view).map((screen,screenIndex)=>{
    const elements:HmiScreenModel['elements']=[];
    const addText=(text:string,x:number,y:number,width:number,id:string,binding?:string)=>{
        if(text.length>Math.floor(width/8)||y+22>240)throw new AppError('Presentation exceeds the 320x240 PLC display');
        elements.push({id,primitive:binding?'value':'text',label:text,position:{x,y},font:0,...(binding?{binding:{source:'wp' as const,ref:binding,format:'int' as const}}:{})});
    };
    let serial=0;
    const layout=(node:ViewNode,x:number,y:number,width:number):number=>{
        const id='view'+serial++;
        switch(node.kind){
            case 'group':{
                const top=node.title?24:0;if(node.title)addText(node.title,x,y,width,id);
                if(node.direction==='row'){
                    const w=Math.floor(width/Math.max(1,node.children.length));
                    return top+Math.max(0,...node.children.map((c,i)=>layout(c,x+i*w,y+top,w-4)));
                }
                let h=top;for(const c of node.children)h+=layout(c,x,y+h,width);return h;
            }
            case 'text':addText(node.text,x,y,width,id);return 24;
            case 'value':
                // Raw PLC values are int32. Scale explicitly in the program, not by UI rounding.
                if(node.digits!==0)throw new AppError('PLC readouts require digits=0; scale explicitly in the PLC program');
                addText(node.label+(node.unit?' ['+node.unit+']':''),x,y,width,id);
                addText('',x,y+20,width,id+'value',bindings[node.binding]);return 48;
            default:throw new AppError('Unsupported PLC presentation node');
        }
    };
    layout(screen.body,8,8,304);
    return {id:screen.id,title:screen.title,screenType:screenIndex===0?'main':'manual',period:0,elements};
    });
}
