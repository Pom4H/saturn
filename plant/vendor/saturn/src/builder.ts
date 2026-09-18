// Binary compilation is owned by Firmverse. HMI screen encoding remains target-specific.
import {compileControlIR, type ElementSpec} from '../../firmverse/index';
export type {ElementSpec} from '../../firmverse/index';
export function buildSchema(elements:readonly ElementSpec[],meta:{projectName:string;projectVersion:string;buildTime:string;screens?:readonly Uint8Array[]}) {
 return compileControlIR({schema:'firmverse/saturn-control-ir@1',project:{name:meta.projectName,version:meta.projectVersion,buildTime:meta.buildTime},elements,screens:meta.screens?.map(s=>Array.from(s))});
}
