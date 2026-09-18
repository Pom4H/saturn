import { connect, type Socket } from 'node:net';
import { NodeSql } from '../adapters/node-sql';
import { AppError } from '../types';
import type { ConnectionConfig, DatabaseDriver, DriverRegistry, DriverSample, ProtocolDriver, ProtocolPoint, ProtocolSession } from './drivers';

const readOnlySql=(sql:string)=>/^\s*(select|with)\b/i.test(sql)&&!sql.includes(';');
const boundedRows=(rows:Record<string,unknown>[],max:number)=>{
  if(rows.length>max)throw new AppError('Database result exceeds row budget');
  if(JSON.stringify(rows).length>2_000_000)throw new AppError('Database result exceeds byte budget');
  return rows;
};

const sqlite:DatabaseDriver={
  kind:'database',id:'sqlite',schemes:['sqlite'],
  async query(config,query){
    const path=String(config.options.path??config.options.filename??'');
    if(!path)throw new AppError('sqlite connection needs options.path');
    if(config.readOnly!==false&&!readOnlySql(query.sql))throw new AppError('Database connection is read-only');
    const db=new NodeSql(path);
    try{
      if(config.readOnly!==false)db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
      return boundedRows(db.all<Record<string,unknown>>(`SELECT * FROM (${query.sql.replace(/;\s*$/,'')}) LIMIT ${query.maxRows+1}`,query.params as any),query.maxRows);
    }finally{db.close();}
  }
};

function parseAddress(point:ProtocolPoint):{fn:number,address:number,type:'bool'|'u16'|'i16'}{
  const m=/^(holding|input|coil|discrete):(\d+)(?::(u16|i16|bool))?$/.exec(point.address);
  if(!m)throw new AppError(`Invalid Modbus address: ${point.address}`);
  const address=Number(m[2]);if(address<0||address>65535)throw new AppError('Modbus address outside 0..65535');
  const fn=m[1]==='holding'?3:m[1]==='input'?4:m[1]==='coil'?1:2;
  const type=(m[3]??(fn<=2?'bool':'u16')) as 'bool'|'u16'|'i16';
  return {fn,address,type};
}
class ModbusSession implements ProtocolSession {
  private tx=0;
  private closed=false;
  constructor(private socket:Socket,private unit:number,private timeoutMs:number){}
  private request(pdu:Buffer):Promise<Buffer>{
    if(this.closed)return Promise.reject(new AppError('Modbus session closed'));
    const tx=(++this.tx)&0xffff,frame=Buffer.allocUnsafe(7+pdu.length);
    frame.writeUInt16BE(tx,0);frame.writeUInt16BE(0,2);frame.writeUInt16BE(pdu.length+1,4);frame[6]=this.unit; pdu.copy(frame,7);
    return new Promise((resolve,reject)=>{
      let data=Buffer.alloc(0),timer:ReturnType<typeof setTimeout>;
      const cleanup=()=>{clearTimeout(timer);this.socket.off('data',onData);this.socket.off('error',onError);};
      const onError=(e:Error)=>{cleanup();reject(e);};
      const onData=(chunk:Buffer)=>{
        data=Buffer.concat([data,chunk]);
        if(data.length<7)return;
        const length=data.readUInt16BE(4),total=6+length;if(data.length<total)return;
        cleanup();
        if(data.readUInt16BE(0)!==tx)return reject(new AppError('Modbus transaction mismatch'));
        const body=data.subarray(7,total);
        if(body[0]&0x80)return reject(new AppError(`Modbus exception ${body[1]??0}`));
        resolve(body);
      };
      timer=setTimeout(()=>{cleanup();reject(new AppError('Modbus timeout',504));},this.timeoutMs);
      this.socket.on('data',onData);this.socket.once('error',onError);this.socket.write(frame);
    });
  }
  async read(points:readonly ProtocolPoint[]):Promise<Record<string,DriverSample>>{
    const out:Record<string,DriverSample>=Object.create(null);
    for(const point of points){
      const a=parseAddress(point),pdu=Buffer.allocUnsafe(5);pdu[0]=a.fn;pdu.writeUInt16BE(a.address,1);pdu.writeUInt16BE(1,3);
      try{
        const body=await this.request(pdu);let value:number;
        if(a.fn<=2)value=(body[2]&1)?1:0;
        else {const raw=body.readUInt16BE(2);value=a.type==='i16'&&raw>0x7fff?raw-0x10000:raw;}
        out[point.id]={value,quality:'good',time:Date.now()};
      }catch{out[point.id]={value:null,quality:'bad',time:Date.now()};}
    }
    return out;
  }
  async write(point:ProtocolPoint,value:number):Promise<void>{
    const a=parseAddress(point);
    if(!point.writable)throw new AppError('Modbus point is read-only',403);
    const pdu=Buffer.allocUnsafe(5);
    if(a.fn===1){pdu[0]=5;pdu.writeUInt16BE(a.address,1);pdu.writeUInt16BE(value?0xff00:0,3);}
    else if(a.fn===3){pdu[0]=6;pdu.writeUInt16BE(a.address,1);pdu.writeUInt16BE(Math.trunc(value)&0xffff,3);}
    else throw new AppError('This Modbus address is not writable');
    await this.request(pdu);
  }
  close(){this.closed=true;this.socket.destroy();}
}
const modbus:ProtocolDriver={
  kind:'protocol',id:'modbus-tcp',schemes:['modbus+tcp'],
  async connect(config:ConnectionConfig){
    const host=String(config.options.host??''),port=Number(config.options.port??502),unit=Number(config.options.unitId??1),timeoutMs=Number(config.options.timeoutMs??2000);
    if(!host||!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(unit)||unit<0||unit>255)throw new AppError('Invalid Modbus TCP connection');
    const socket=connect({host,port});
    await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);setTimeout(()=>reject(new AppError('Modbus connect timeout',504)),timeoutMs).unref?.();});
    socket.setNoDelay(true);return new ModbusSession(socket,unit,timeoutMs);
  }
};

function bunSqlDriver():DatabaseDriver|null {
  const BunRuntime=(globalThis as any).Bun;
  if(!BunRuntime?.SQL)return null;
  return {
    kind:'database',id:'bun-sql',schemes:['postgres','postgresql','mysql','mariadb','sqlite'],
    async query(config,query){
      if(config.readOnly!==false&&!readOnlySql(query.sql))throw new AppError('Database connection is read-only');
      const options={...config.options};
      const sql=new BunRuntime.SQL(options);
      const pending=sql.unsafe(query.sql,query.params??[]);
      const timer=setTimeout(()=>pending.cancel(),query.timeoutMs);
      try{return boundedRows(await pending,query.maxRows);}
      finally{clearTimeout(timer);await sql.close({timeout:1});}
    }
  };
}
export function installBuiltInServerDrivers(registry:DriverRegistry):void {
  registry.register(sqlite);registry.register(modbus);const bun=bunSqlDriver();if(bun)registry.register(bun);
}
