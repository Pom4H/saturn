import { AppError, type Actor } from '../types';

export type Capability =
  | 'runtime.read'
  | 'runtime.pause'
  | 'history.read'
  | 'alarm.ack'
  | 'control.operate'
  | 'report.read'
  | 'report.run'
  | 'project.source.read'
  | 'project.commit'
  | 'project.publish'
  | 'simulation.modify'
  | 'firmware.build'
  | 'job.read'
  | 'job.submit'
  | 'database.query'
  | 'sandbox.run'
  | 'users.manage';

const grants: Record<Actor['role'], ReadonlySet<Capability>> = {
  viewer: new Set<Capability>(['runtime.read','history.read','report.read']),
  operator: new Set<Capability>([
    'runtime.read','history.read','report.read','runtime.pause',
    'alarm.ack','control.operate','report.run',
  ]),
  engineer: new Set<Capability>([
    'runtime.read','history.read','report.read','runtime.pause',
    'alarm.ack','control.operate','report.run',
    'project.source.read','project.commit','project.publish',
    'simulation.modify','firmware.build','job.read','job.submit',
    'database.query','sandbox.run','users.manage',
  ]),
};

export function can(actor:Actor, capability:Capability):boolean {
  return grants[actor.role]?.has(capability) ?? false;
}
export function authorize(actor:Actor, capability:Capability):void {
  if(!can(actor,capability))throw new AppError(`Insufficient permission: ${capability}`,403);
}
export function capabilities(actor:Actor):Capability[] {
  return [...(grants[actor.role]??[])];
}
