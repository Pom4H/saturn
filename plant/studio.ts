import ts from '@typescript/typescript6';
import type { ViewNode } from './presentation';

export type StudioNodeKind = ViewNode['kind'];
export interface StudioSource {
    file: string;
    kind: StudioNodeKind;
    call: string;
    index: number;
    from: number;
    to: number;
    startLine: number;
    endLine: number;
    args: { from: number; to: number }[];
}
const calls: Record<StudioNodeKind,string> = {
    group:'panel', text:'label', value:'readout', table:'dataTable', chart:'trend', action:'commandButton',
};
const sourceFile = (file:string, source:string) => ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function positions(file:string, source:string, call:string):StudioSource[] {
    const sf=sourceFile(file,source), out:StudioSource[]=[];
    const visit=(node:ts.Node)=>{
        if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text===call){
            const start=sf.getLineAndCharacterOfPosition(node.getStart(sf)), end=sf.getLineAndCharacterOfPosition(node.getEnd());
            out.push({file,kind:'text',call,index:out.length,from:node.getStart(sf),to:node.getEnd(),startLine:start.line+1,endLine:end.line+1,args:node.arguments.map(a=>({from:a.getStart(sf),to:a.getEnd()}))});
        }
        ts.forEachChild(node,visit);
    };
    visit(sf); return out;
}
export function widgetSource(files:Record<string,string>,preferredFile:string,kind:StudioNodeKind,index:number):StudioSource|null {
    const call=calls[kind], order=[preferredFile,...Object.keys(files).filter(f=>f!==preferredFile&&f.endsWith('.ts'))];
    for(const file of order){
        const source=files[file]; if(source===undefined)continue;
        const hit=positions(file,source,call)[index];
        if(hit){hit.kind=kind;return hit;}
    }
    return null;
}
const argFor=(kind:StudioNodeKind,field:string):number|null=>{
    if(kind==='text'&&field==='text')return 0;
    if(kind==='value')return field==='label'?0:field==='unit'?2:field==='digits'?3:null;
    if(kind==='chart'&&field==='title')return 0;
    if(kind==='action')return field==='label'?0:field==='value'?2:null;
    if(kind==='group'&&field==='title')return 2;
    return null;
};
export function patchWidget(files:Record<string,string>,source:StudioSource,field:string,value:string|number):Record<string,string> {
    const arg=argFor(source.kind,field); if(arg===null)throw new Error('Это свойство пока редактируется кодом');
    const range=source.args[arg]; if(!range)throw new Error('В DSL отсутствует редактируемый аргумент');
    const replacement=typeof value==='number'?String(value):JSON.stringify(value);
    return {...files,[source.file]:files[source.file].slice(0,range.from)+replacement+files[source.file].slice(range.to)};
}
export function lineLabel(source:StudioSource):string { return `${source.file}:${source.startLine}${source.endLine===source.startLine?'':`-${source.endLine}`}`; }
export function textSource(files:Record<string,string>,query:string,preferredFile=''):StudioSource|null {
    const order=[preferredFile,...Object.keys(files).filter(f=>f!==preferredFile&&f.endsWith('.ts'))].filter(Boolean);
    for(const file of order){
        const source=files[file], at=source?.indexOf(query)??-1; if(at<0)continue;
        const sf=sourceFile(file,source), start=sf.getLineAndCharacterOfPosition(at), end=sf.getLineAndCharacterOfPosition(at+query.length);
        return {file,kind:'text',call:'text',index:0,from:at,to:at+query.length,startLine:start.line+1,endLine:end.line+1,args:[]};
    }
    return null;
}
