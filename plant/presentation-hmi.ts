import { failCode } from './diagnostics';
import { validatePresentation, type Presentation, type ViewNode } from './presentation';
import type { HmiScreenModel } from './vendor/saturn/src/types';
/**
 * Compile canonical Presentation IR to the bounded Saturn PLC 320x240 target schema.
 *
 * HmiScreenModel is a target artifact consumed by the Saturn/Firmverse compiler,
 * never a second authored HMI model.
 */
export function compileSaturnPlcPresentation(view:Presentation,bindings:Record<string,string>):HmiScreenModel {
    validatePresentation(view,'saturn-plc-320');
    const elements:HmiScreenModel['elements']=[];
    const addText=(text:string,x:number,y:number,width:number,id:string,binding?:string)=>{
        if(text.length>Math.floor(width/8)||y+22>240)failCode('SATURN_LIMIT',{resource:'plc.display',reason:'tooLarge'},{width,height:y+22});
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
                if(node.digits!==0)failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{target:'plc',field:'digits',digits:node.digits});
                addText(node.label+(node.unit?' ['+node.unit+']':''),x,y,width,id);
                addText('',x,y+20,width,id+'value',bindings[node.binding]);return 48;
            default:failCode('SATURN_PRESENTATION_INVALID',{reason:'invalid'},{target:'plc',nodeKind:node.kind});
        }
    };
    layout(view.body,8,8,304);
    return {id:view.id,title:view.title,screenType:'main',period:0,elements};
}

/** @deprecated Use the explicit target boundary through projectPresentation(). */
export const presentationHmi = compileSaturnPlcPresentation;
