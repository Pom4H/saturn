import ts from '@typescript/typescript6';
import { compileProject } from './compiler';
import { AppError } from './types';
import type { Connection } from './ports';
/** Source-preserving append: only the explicit userWires array is patched. No source regeneration. */
export function appendConnection(files:Record<string,string>,wire:Connection):Record<string,string>{
 const source=files['wiring.ts'];if(source===undefined)throw new AppError('Add a wiring.ts module exporting userWires and include it in project.connections first');
 const file=ts.createSourceFile('wiring.ts',source,ts.ScriptTarget.Latest,true);let array:ts.ArrayLiteralExpression|undefined;
 for(const stmt of file.statements)if(ts.isVariableStatement(stmt))for(const d of stmt.declarationList.declarations)if(ts.isIdentifier(d.name)&&d.name.text==='userWires'&&d.initializer&&ts.isArrayLiteralExpression(d.initializer))array=d.initializer;
 if(!array)throw new AppError('userWires must be an explicit array; computed source is not overwritten');
 const q=(s:string)=>JSON.stringify(s),options={...(wire.medium!=='pipe'?{medium:wire.medium}:{}),...(wire.via?{via:wire.via}:{}),...(wire.scale!==undefined?{scale:wire.scale}:{}),...(wire.signal!==undefined?{signal:wire.signal}:{})};
 const call=`${wire.medium==='pipe'?'pipe':'cable'}(${q(wire.id)}, port(${q(wire.from.device)}, ${q(wire.from.port)}), port(${q(wire.to.device)}, ${q(wire.to.port)}), ${JSON.stringify(options)})`;
 const at=array.getEnd()-1,prefix=array.elements.length&&!array.elements.hasTrailingComma?',':'';
 const result={...files,'wiring.ts':source.slice(0,at)+prefix+'\n    '+call+',\n'+source.slice(at)};
 const project=compileProject(result);if(!project.connections?.some(c=>c.id===wire.id))throw new AppError('userWires is not included in project.connections');return result;
}
/** Patch project() property arrays, retaining all unrelated source and comments. */
export function addExpansionSource(files:Record<string,string>,controller:string,moduleId:string,path:string,moduleSource:string,slot:number):Record<string,string>{
 if(path in files)throw new AppError('Expansion file already exists');
 const alias='__io_'+controller.replace(/[^a-zA-Z0-9_]/g,'_')+'_'+slot;
 const source=files['plant.ts'],ast=ts.createSourceFile('plant.ts',source,ts.ScriptTarget.Latest,true);let object:ts.ObjectLiteralExpression|undefined;
 for(const statement of ast.statements)if(ts.isExportAssignment(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='project'&&ts.isObjectLiteralExpression(statement.expression.arguments[1]))object=statement.expression.arguments[1];
 if(!object)throw new AppError('Visual module addition needs an explicit export default project()');
 const expressions:Record<string,string>={simulations:alias,attachments:`{device:${JSON.stringify(moduleId)},controller:${JSON.stringify(controller)},slot:${slot},profile:'virtual-io4'}`};
 const changes:{from:number;to:number;text:string}[]=[];
 for(const [key,expression] of Object.entries(expressions)){
  const property=object.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(ast)===key) as ts.PropertyAssignment|undefined;
  if(!property)changes.push({from:object.end-1,to:object.end-1,text:`,${key}:[${expression}]`});
  else {const init=property.initializer,old=init.getText(ast);changes.push({from:init.getStart(ast),to:init.end,text:`[...${old}, ${expression}]`});}
 }
 let next=source;for(const change of changes.sort((a,b)=>b.from-a.from))next=next.slice(0,change.from)+change.text+next.slice(change.to);
 next=`import { module as ${alias} } from './${path.replace(/\.ts$/,'')}';\n`+next;
 const result={...files,[path]:moduleSource,'plant.ts':next};compileProject(result);return result;
}
export function removeConnection(files:Record<string,string>,connectionId:string):Record<string,string>{
 let changed=false;const result={...files};
 for(const [path,source] of Object.entries(files)){if(!path.endsWith('.ts'))continue;const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);let call:ts.CallExpression|undefined;
  const visit=(n:ts.Node)=>{if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&['cable','pipe'].includes(n.expression.text)&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text===connectionId&&ts.isArrayLiteralExpression(n.parent))call=n;ts.forEachChild(n,visit);};visit(ast);if(!call)continue;
  if(changed)throw new AppError('Ambiguous connection source');const c=call as ts.CallExpression,from=c.getStart(ast),end=c.end;
  const after=source.slice(end).match(/^\s*,/);let next:string;
  if(after)next=source.slice(0,from)+source.slice(end+after[0].length);
  else{const array=c.parent as ts.ArrayLiteralExpression,index=array.elements.indexOf(c);if(index>0){const prevEnd=array.elements[index-1].end,comma=source.indexOf(',',prevEnd);next=source.slice(0,comma)+source.slice(comma+1,from)+source.slice(end);}else next=source.slice(0,from)+source.slice(end);}
  result[path]=next;changed=true;
 }
 if(!changed)throw new AppError('Connection has no editable literal declaration');
 if(compileProject(result).connections?.some(w=>w.id===connectionId))throw new AppError('Connection still used by the project');return result;
}
