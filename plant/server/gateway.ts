import { AppError, type ExternalSource, type Sample } from '../types';
import { DriverRegistry, type ConnectionConfig, type ProtocolPoint, type ProtocolSession } from './drivers';

interface BoundConnection {
  config:ConnectionConfig;
  session:ProtocolSession;
  points:ProtocolPoint[];
  sources:ExternalSource[];
  nextAt:number;
  pollMs:number;
}
export class IndustrialGateway {
  private values:Record<string,Sample>=Object.create(null);
  private bound:BoundConnection[]=[];
  private refreshing=false;
  constructor(readonly registry:DriverRegistry,readonly connections:Map<string,ConnectionConfig>,readonly now=Date.now){}
  snapshot():Record<string,Sample>{
    const now=this.now(),out:Record<string,Sample>=Object.create(null);
    for(const group of this.bound)for(const source of group.sources){
      const sample=this.values[source.id]??{value:null,quality:'offline' as const,time:now};
      out[source.id]=sample.quality==='good'&&now-sample.time>Math.max(source.pollMs*3,5000)?{...sample,quality:'stale'}:sample;
    }
    return out;
  }
  async bind(sources:readonly ExternalSource[]):Promise<void>{
    const groups=new Map<string,ExternalSource[]>(),next:BoundConnection[]=[],values:Record<string,Sample>=Object.create(null);
    for(const source of sources){
      const list=groups.get(source.connection);if(list)list.push(source);else groups.set(source.connection,[source]);
      values[source.id]={value:null,quality:'offline',time:this.now()};
    }
    try{
      for(const [id,list] of groups){
        const config=this.connections.get(id);if(!config)throw new AppError(`Server connection not configured: ${id}`,503);
        const driver=this.registry.get(config.driver,'protocol'),session=await driver.connect(config);
        const points=list.map(source=>({id:source.id,address:source.address,writable:source.writable}));
        next.push({config,session,points,sources:list,nextAt:0,pollMs:Math.min(...list.map(s=>s.pollMs))});
      }
    }catch(error){for(const group of next)await group.session.close();throw error;}
    const previous=this.bound;this.bound=next;this.values=values;
    for(const group of previous)await group.session.close();
  }
  async refresh(now=this.now()):Promise<void>{
    if(this.refreshing)return;
    this.refreshing=true;
    try{
      for(const group of this.bound){
        if(now<group.nextAt)continue;
        group.nextAt=now+group.pollMs;
        try{
          const result=await group.session.read(group.points);
          for(const source of group.sources){
            const sample=result[source.id];
            this.values[source.id]=sample&&Number.isFinite(sample.time)&&['good','bad','stale','offline'].includes(sample.quality)
              ? {value:sample.value===null||Number.isFinite(sample.value)?sample.value:null,quality:sample.value===null&&sample.quality==='good'?'bad':sample.quality,time:sample.time}
              : {value:null,quality:'bad',time:now};
          }
        }catch{
          for(const source of group.sources)this.values[source.id]={value:null,quality:'offline',time:now};
        }
      }
    }finally{this.refreshing=false;}
  }
  async write(source:ExternalSource,value:number):Promise<void>{
    if(!source.writable)throw new AppError('External signal is read-only',403);
    const group=this.bound.find(g=>g.sources.some(s=>s.id===source.id));
    const point=group?.points.find(p=>p.id===source.id);
    if(!group||!point||!group.session.write)throw new AppError('Protocol driver does not support writes',409);
    await group.session.write(point,value);
  }
  async close():Promise<void>{
    const current=this.bound.splice(0);for(const group of current)await group.session.close();
  }
}
