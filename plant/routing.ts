import { footprint, resolvePort, type Connection } from './ports';
import type { Project } from './types';
export interface RoutePoint {x:number;y:number;z:number}
export interface PhysicalRoute {id:string;medium:Connection['medium'];from:Connection['from'];to:Connection['to'];points:RoutePoint[];valid:boolean;error?:string}
const direction={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]};
/** Bounded rectilinear visibility grid. Endpoint stubs leave the exact terminal along its normal. */
export function routeConnection(p:Project,w:Connection):PhysicalRoute {
 const a=resolvePort(p,w.from),b=resolvePort(p,w.to),clearance=w.medium==='pipe'?12:7;
 const anchor=(v:typeof a):RoutePoint=>({x:v.device.layout.x+v.terminal.x,y:v.device.layout.y+v.terminal.y,z:v.terminal.z});
 const start=anchor(a),end=anchor(b);
 const boxes=p.devices.map(d=>{const f=footprint(d.type);return{x:d.layout.x-clearance,y:d.layout.y-clearance-54,right:d.layout.x+f.width+clearance,bottom:d.layout.y+f.height+clearance,id:d.id};});
 const lead=(v:typeof a,pt:RoutePoint)=>{const r=boxes.find(r=>r.id===v.device.id)!,[dx,dy]=direction[v.terminal.side];return{x:dx<0?r.x:dx>0?r.right:pt.x,y:dy<0?r.y:dy>0?r.bottom:pt.y,z:pt.z};};
 const s=lead(a,start),t=lead(b,end);
 const blocked=(a:RoutePoint,b:RoutePoint,ignore='')=>boxes.some(r=>r.id!==ignore&&(a.x===b.x ? a.x>r.x+.01&&a.x<r.right-.01&&Math.max(a.y,b.y)>r.y+.01&&Math.min(a.y,b.y)<r.bottom-.01 : a.y===b.y ? a.y>r.y+.01&&a.y<r.bottom-.01&&Math.max(a.x,b.x)>r.x+.01&&Math.min(a.x,b.x)<r.right-.01 : true));
 const empty=(v:RoutePoint)=>!boxes.some(r=>v.x>r.x+.01&&v.x<r.right-.01&&v.y>r.y+.01&&v.y<r.bottom-.01);
 const result:PhysicalRoute={id:w.id,medium:w.medium,from:w.from,to:w.to,points:[],valid:true};
 if(blocked(start,s,a.device.id)||blocked(t,end,b.device.id))return{...result,valid:false,error:'Terminal stub intersects another device',points:[start,s,t,end]};
 const via=[s,...(w.via??[]).map(v=>({...v,z:s.z})),t];let route:RoutePoint[]=[start];
 for(let k=1;k<via.length;k++){
  const from=via[k-1],to=via[k];if(!empty(from)||!empty(to)){result.valid=false;result.error='Waypoint inside equipment';break;}
  const xs=[...new Set([from.x,to.x,...boxes.flatMap(r=>[r.x,r.right])])].sort((a,b)=>a-b),ys=[...new Set([from.y,to.y,...boxes.flatMap(r=>[r.y,r.bottom])])].sort((a,b)=>a-b);
  const nx=xs.length,idx=(pt:RoutePoint)=>ys.indexOf(pt.y)*nx+xs.indexOf(pt.x),point=(i:number)=>({x:xs[i%nx],y:ys[Math.floor(i/nx)],z:from.z});
  const first=idx(from),last=idx(to),dist=new Map([[first,0]]),prev=new Map<number,number>();const heap:{i:number;f:number}[]=[];
  const push=(v:{i:number;f:number})=>{heap.push(v);let n=heap.length-1;while(n>0){const p=(n-1)>>1;if(heap[p].f<=v.f)break;heap[n]=heap[p];n=p;}heap[n]=v;};
  const pop=()=>{const first=heap[0],v=heap.pop()!;if(heap.length){let n=0;while(n*2+1<heap.length){let c=n*2+1;if(c+1<heap.length&&heap[c+1].f<heap[c].f)c++;if(heap[c].f>=v.f)break;heap[n]=heap[c];n=c;}heap[n]=v;}return first;};
  const heuristic=(v:RoutePoint)=>Math.abs(v.x-to.x)+Math.abs(v.y-to.y);push({i:first,f:heuristic(from)});const visited=new Set<number>();let count=0;
  while(heap.length&&count++<40000){const {i}=pop();if(visited.has(i))continue;visited.add(i);if(i===last)break;const pt=point(i),x=i%nx,y=Math.floor(i/nx);
   for(const next of [x>0?i-1:-1,x+1<nx?i+1:-1,y>0?i-nx:-1,y+1<ys.length?i+nx:-1]){if(next<0||visited.has(next))continue;const q=point(next);if(blocked(pt,q))continue;const d=dist.get(i)!+Math.abs(pt.x-q.x)+Math.abs(pt.y-q.y);if(d<(dist.get(next)??Infinity)){dist.set(next,d);prev.set(next,i);push({i:next,f:d+heuristic(q)});}}
  }
  if(!visited.has(last)){result.valid=false;result.error='No collision-free route within budget';break;}
  const segment:RoutePoint[]=[];let i=last;while(i!==first){segment.push(point(i));i=prev.get(i)!;}segment.push(from);route.push(...segment.reverse());
 }
 if(!result.valid)route=[start,...via];route.push(end);
 // Preserve exact endpoint height; cables rise vertically outside terminal bodies when needed.
 const high=Math.max(start.z,end.z);route=[start,s,...route.slice(1,-1).map(v=>({...v,z:high})),t,end];
 const compact:RoutePoint[]=[];for(const q of route){const a=compact.at(-1);if(a&&a.x===q.x&&a.y===q.y&&a.z===q.z)continue;const b=compact.at(-2);if(a&&b&&a.z===b.z&&q.z===a.z&&((a.x===b.x&&a.x===q.x)||(a.y===b.y&&a.y===q.y)))compact.pop();compact.push(q);}
 result.points=compact;return result;
}
export const routeConnections=(p:Project)=> (p.connections??[]).map(w=>routeConnection(p,w));
