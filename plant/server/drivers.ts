import { readFile } from 'node:fs/promises';
import { AppError, type Quality } from '../types';

export interface ConnectionConfig {
  id:string;
  driver:string;
  options:Record<string,unknown>;
  readOnly?:boolean;
}
export interface DriverSample { value:number|null; quality:Quality; time:number }
export interface ProtocolPoint { id:string; address:string; dataType?:string; writable?:boolean }
export interface ProtocolSession {
  read(points:readonly ProtocolPoint[]):Promise<Record<string,DriverSample>>;
  write?(point:ProtocolPoint,value:number):Promise<void>;
  close():Promise<void>|void;
}
export interface ProtocolDriver {
  kind:'protocol';
  id:string;
  schemes:readonly string[];
  connect(config:ConnectionConfig):Promise<ProtocolSession>;
}
export interface DatabaseQuery {
  sql:string;
  params?:unknown[]|Record<string,unknown>;
  maxRows:number;
  timeoutMs:number;
}
export interface DatabaseDriver {
  kind:'database';
  id:string;
  schemes:readonly string[];
  query(config:ConnectionConfig,query:DatabaseQuery):Promise<Record<string,unknown>[]>;
}
export type ServerDriver=ProtocolDriver|DatabaseDriver;
export interface SaturnDriverModule { installSaturn(registry:DriverRegistry):void|Promise<void> }

export class DriverRegistry {
  private drivers=new Map<string,ServerDriver>();
  register(driver:ServerDriver):void {
    if(!/^[a-z][a-z0-9-]{1,63}$/.test(driver.id)||this.drivers.has(driver.id))throw new AppError(`Invalid or duplicate driver: ${driver.id}`);
    this.drivers.set(driver.id,driver);
  }
  get<T extends ServerDriver['kind']>(id:string,kind:T):Extract<ServerDriver,{kind:T}> {
    const driver=this.drivers.get(id);
    if(!driver||driver.kind!==kind)throw new AppError(`Server driver not installed: ${id}`,503);
    return driver as Extract<ServerDriver,{kind:T}>;
  }
  list(){return [...this.drivers.values()].map(d=>({id:d.id,kind:d.kind,schemes:[...d.schemes]}));}
}
export async function loadDriverModules(registry:DriverRegistry,specifiers:readonly string[]):Promise<void>{
  for(const specifier of specifiers){
    if(!specifier||specifier.length>500)throw new AppError('Invalid driver module');
    const module=await import(specifier) as Partial<SaturnDriverModule>;
    if(typeof module.installSaturn!=='function')throw new AppError(`Driver module has no installSaturn(): ${specifier}`);
    await module.installSaturn(registry);
  }
}
export async function loadConnections(path?:string):Promise<Map<string,ConnectionConfig>>{
  if(!path)return new Map();
  const raw=JSON.parse(await readFile(path,'utf8')) as {connections?:ConnectionConfig[]};
  if(!Array.isArray(raw.connections)||raw.connections.length>256)throw new AppError('Invalid server connections file');
  const result=new Map<string,ConnectionConfig>();
  for(const c of raw.connections){
    if(!c||typeof c.id!=='string'||typeof c.driver!=='string'||!c.options||typeof c.options!=='object'||Array.isArray(c.options)||result.has(c.id))throw new AppError('Invalid or duplicate server connection');
    result.set(c.id,Object.freeze({...c,options:Object.freeze({...c.options})}));
  }
  return result;
}
export const driverModulesFromEnv=(value=process.env.SATURN_DRIVER_MODULES??'')=>value.split(',').map(x=>x.trim()).filter(Boolean);
