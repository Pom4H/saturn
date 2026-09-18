import { createServer } from 'node:net';
import { writeFile } from 'node:fs/promises';

const port=Number(process.env.MODBUS_PORT??15020);
let value=400,reads=0;
const server=createServer(socket=>{
  let buffer=Buffer.alloc(0);
  socket.on('data',chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    for(;;){
      if(buffer.length<7)return;
      const length=buffer.readUInt16BE(4),total=6+length;if(buffer.length<total)return;
      const frame=buffer.subarray(0,total);buffer=buffer.subarray(total);
      const tx=frame.readUInt16BE(0),unit=frame[6],fn=frame[7];
      let pdu;
      if(fn===3||fn===4){
        reads++;value=(value+7)%1000;
        pdu=Buffer.from([fn,2,(value>>8)&255,value&255]);
      }else if(fn===1||fn===2)pdu=Buffer.from([fn,1,value&1]);
      else if(fn===5||fn===6)pdu=Buffer.from(frame.subarray(7,12));
      else pdu=Buffer.from([fn|0x80,1]);
      const response=Buffer.alloc(7+pdu.length);
      response.writeUInt16BE(tx,0);response.writeUInt16BE(0,2);response.writeUInt16BE(pdu.length+1,4);response[6]=unit;pdu.copy(response,7);
      socket.write(response);
    }
  });
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
console.log(`Modbus smoke server listening on ${port}`);
const shutdown=async()=>{if(process.env.MODBUS_STATS)await writeFile(process.env.MODBUS_STATS,JSON.stringify({reads,value},null,2));server.close(()=>process.exit(0));};
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
