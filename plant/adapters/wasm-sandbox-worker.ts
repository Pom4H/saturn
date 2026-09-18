type SandboxRequest={module:string;export:string;args:number[]};
process.once('message',async(input:SandboxRequest)=>{
  try{
    if(!input||typeof input.module!=='string'||typeof input.export!=='string'||!Array.isArray(input.args))throw new Error('Invalid sandbox request');
    const bytes=Buffer.from(input.module,'base64');
    if(bytes.length>1_500_000)throw new Error('WASM module exceeds budget');
    const module=await WebAssembly.compile(bytes);
    if(WebAssembly.Module.imports(module).length)throw new Error('Sandbox WASM imports are forbidden');
    const instance=await WebAssembly.instantiate(module,{});
    const fn=instance.exports[input.export];
    if(typeof fn!=='function')throw new Error('WASM export is not a function');
    const value=(fn as (...args:number[])=>unknown)(...input.args);
    if(typeof value!=='number'&&typeof value!=='bigint')throw new Error('WASM result must be numeric');
    process.send?.({result:typeof value==='bigint'?value.toString():value});
  }catch(error){process.send?.({error:error instanceof Error?error.message:String(error)});}
  finally{process.disconnect?.();}
});
