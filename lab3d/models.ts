import * as THREE from 'three';
import { advancePhase, readSignal, rotate, type Asset, type Signals } from '../src/elements/model';
import { registry } from '../src/elements/core-elements';
import { materialPresets, type MaterialPresetId } from '../src/elements/materials';

function presetMaterial(id: MaterialPresetId): THREE.Material {
  const p=materialPresets[id], transparent=(p.opacity??1)<1 || (p.transmission??0)>0;
  if ((p.transmission??0)>0 || (p.clearcoat??0)>0) return new THREE.MeshPhysicalMaterial({
    color:p.color,metalness:p.metalness,roughness:p.roughness,transparent,opacity:p.opacity??1,
    transmission:p.transmission??0,thickness:p.thickness??0,ior:p.ior??1.5,
    clearcoat:p.clearcoat??0,clearcoatRoughness:p.clearcoatRoughness??0,
    depthWrite:p.depthWrite??true,side:transparent?THREE.DoubleSide:THREE.FrontSide,
  });
  return new THREE.MeshStandardMaterial({color:p.color,metalness:p.metalness,roughness:p.roughness,transparent,opacity:p.opacity??1,depthWrite:p.depthWrite??true});
}
const steel=presetMaterial('steel'), lightSteel=presetMaterial('lightSteel'), dark=presetMaterial('darkMetal');
const teal=presetMaterial('paintedIndustrial'), amber=presetMaterial('warning');
const fluid=presetMaterial('water'), fluidSurface=presetMaterial('waterSurface'), fluidHighlight=presetMaterial('waterHighlight');
const greyFluid=presetMaterial('staleFluid'), pipeShell=presetMaterial('pipeShell');
const sharedMaterials = new Set<THREE.Material>([steel, lightSteel, dark, teal, amber, fluid, fluidSurface, fluidHighlight, greyFluid, pipeShell]);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position = v(0, 0, 0)) {
  const object = new THREE.Mesh(geometry, material); object.position.copy(position);
  object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
}
function box(parent: THREE.Object3D, size: number[], position: number[], material = dark) {
  return mesh(parent, new THREE.BoxGeometry(...size as [number, number, number]), material, v(...position as [number, number, number]));
}
function cylinder(parent: THREE.Object3D, radius: number, height: number, position: THREE.Vector3, material = steel) {
  const object = mesh(parent, new THREE.CylinderGeometry(radius, radius, height, 48), material, position);
  object.rotation.x = Math.PI / 2; return object;
}
export function tubeBetween(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, radius = .11, material: THREE.Material = steel) {
  const direction = to.clone().sub(from);
  const object = mesh(parent, new THREE.CylinderGeometry(radius, radius, direction.length(), 24), material, from.clone().add(to).multiplyScalar(.5));
  object.quaternion.setFromUnitVectors(v(0, 1, 0), direction.normalize()); return object;
}
function flange(parent: THREE.Object3D, point: THREE.Vector3, normal: THREE.Vector3) {
  tubeBetween(parent, point.clone().addScaledVector(normal, -.08), point, .205, lightSteel);
  const x = v(0, 1, 0).cross(normal).normalize(); if (x.length() < .1) x.set(1, 0, 0);
  const y = normal.clone().cross(x).normalize();
  for (let i = 0; i < 8; i++) {
    const p = point.clone().addScaledVector(x, .158 * Math.cos(i * Math.PI / 4)).addScaledVector(y, .158 * Math.sin(i * Math.PI / 4));
    tubeBetween(parent, p.clone().addScaledVector(normal, -.025), p.clone().addScaledVector(normal, .015), .019, dark);
  }
}
export interface Model {
  root: THREE.Group;
  anchors: Map<string, THREE.Object3D>;
  update: (signals: Signals, dt: number) => void;
  reset: () => void;
  metrics: () => Record<string, number | null>;
  dispose: () => void;
}
type Builder = (asset: Asset) => Model;
const builders = new Map<string, Builder>();
export function registerModel(type: string, builder: Builder) {
  if (builders.has(type)) throw new Error(`Duplicate 3D renderer: ${type}`);
  builders.set(type, builder);
}
function finish(asset: Asset, root: THREE.Group, update: Model['update'], reset: Model['reset'], metrics: Model['metrics']): Model {
  root.position.fromArray(asset.pose3D.position); root.quaternion.fromArray(asset.pose3D.rotation);
  const anchors = new Map<string, THREE.Object3D>();
  for (const port of registry.get(asset.type).ports(asset.parameters)) {
    const anchor = new THREE.Object3D(); anchor.position.fromArray(port.position);
    anchor.quaternion.setFromUnitVectors(v(0, 0, 1), new THREE.Vector3().fromArray(port.normal));
    root.add(anchor); anchors.set(port.id, anchor);
  }
  const dispose = () => {
    const ownedMaterials = new Set<THREE.Material>();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (!sharedMaterials.has(material)) ownedMaterials.add(material);
    });
    for (const material of ownedMaterials) material.dispose();
  };
  return { root, anchors, update, reset, metrics, dispose };
}
registerModel('process.tank.vertical', asset => {
  if (rotate([0, 0, 1], asset.pose3D.rotation)[2] < .999999) throw new Error('Vertical tank renderer supports yaw only; tilted liquid needs world-plane clipping');
  const root = new THREE.Group(), r = asset.parameters.radius, h = asset.parameters.height;
  cylinder(root, r + .08, .15, v(0, 0, .13), dark);
  cylinder(root, r, .08, v(0, 0, .24));
  const shellMat = steel.clone(); shellMat.side = THREE.DoubleSide;
  const shell = mesh(root, new THREE.CylinderGeometry(r, r, h, 64, 1, true, .7, Math.PI * 2 - 1.4), shellMat, v(0, 0, .28 + h / 2));
  shell.rotation.x = Math.PI / 2;
  for (const z of [.28, .28 + h]) {
    mesh(root, new THREE.TorusGeometry(r, .035, 10, 64), lightSteel, v(0, 0, z));
  }
  for (const a of [-.7, .7]) tubeBetween(root, v(Math.sin(a) * r, -Math.cos(a) * r, .28), v(Math.sin(a) * r, -Math.cos(a) * r, .28 + h), .022, lightSteel);
  const liquid = cylinder(root, r - .035, 1, v(0, 0, .28), fluid); liquid.renderOrder=2;
  const surface = mesh(root, new THREE.CircleGeometry(r - .045, 64), fluidSurface, v(0, 0, .28)); surface.renderOrder=3;
  tubeBetween(root, v(r - .12, 0, .48), v(r + .28, 0, .48)); flange(root, v(r + .28, 0, .48), v(1, 0, 0));
  // A physical level scale along the open cutaway, independent of screen labels.
  for (let i = 0; i <= 10; i++) box(root, [.1 + (i % 5 === 0 ? .08 : 0), .025, .018], [-.45, -r * .9, .28 + h * i / 10], dark);
  let level: number | null = null;
  return finish(asset, root, signals => {
    level = readSignal(signals, 'level', '%');
    const valid = level !== null && level >= 0 && level <= 100;
    liquid.visible = surface.visible = valid && level! > 0;
    if (valid) {
      const top=.28+h*level!/100; liquid.scale.y=h*level!/100; liquid.position.z=.28+h*level!/200;
      surface.position.z=top+.004;
    }
  }, () => { level = null; liquid.visible = surface.visible = false; }, () => ({ level, liquidTop: liquid.visible ? .28 + h * level! / 100 : null }));
});
registerModel('process.pump.centrifugal', asset => {
  const root = new THREE.Group(), machine = new THREE.Group(); root.add(machine); machine.scale.setScalar(asset.parameters.scale);
  box(machine, [1.8, .85, .12], [.1, 0, .10]);
  box(machine, [.85, .55, .16], [.48, 0, .24], steel);
  const motor = cylinder(machine, .32, .8, v(.45, 0, .65), teal); motor.rotation.z = Math.PI / 2;
  for (let i = 0; i < 9; i++) { const fin = cylinder(machine, .35, .024, v(.12 + i * .08, 0, .65), teal); fin.rotation.z = Math.PI / 2; }
  box(machine, [.26, .32, .18], [.55, 0, 1.02], dark);
  // Axial cutaway: the back plate, open shell and bright rim expose the rotor inside.
  const back = cylinder(machine, .47, .045, v(-.14, 0, .65), teal); back.rotation.z = Math.PI / 2;
  const cutMaterial = teal.clone(); cutMaterial.side = THREE.DoubleSide;
  const casing = mesh(machine, new THREE.CylinderGeometry(.47, .47, .32, 48, 1, true), cutMaterial, v(-.32, 0, .65));
  casing.rotation.z = Math.PI / 2;
  const rim = mesh(machine, new THREE.TorusGeometry(.47, .025, 10, 48), lightSteel, v(-.49, 0, .65)); rim.rotation.y = Math.PI / 2;
  const rotor = new THREE.Group(); rotor.position.set(-.40, 0, .65); machine.add(rotor);
  for (let i = 0; i < 7; i++) {
    const blade = box(rotor, [.04, .31, .075], [0, .18 * Math.cos(i * Math.PI * 2 / 7), .18 * Math.sin(i * Math.PI * 2 / 7)], amber);
    blade.rotation.x = i * Math.PI * 2 / 7 + .5;
  }
  // A single dark index distinguishes direction across short capture intervals.
  box(rotor, [.05, .07, .07], [0, .31, 0], dark);
  tubeBetween(machine, v(-.95, 0, .65), v(-.45, 0, .65), .13); flange(machine, v(-.95, 0, .65), v(-1, 0, 0));
  tubeBetween(machine, v(-.25, 0, .93), v(-.25, 0, 1.35), .13); flange(machine, v(-.25, 0, 1.35), v(0, 0, 1));
  let phase = 0, rpm: number | null = null, flow: number | null = null;
  return finish(asset, root, (signals, dt) => {
    rpm = readSignal(signals, 'rpm', 'rpm'); flow = readSignal(signals, 'flow', 'm3/h');
    phase = advancePhase(phase, rpm === null ? 0 : rpm / 1450 * .35, dt);
    rotor.rotation.x = phase * Math.PI * 2;
    rotor.visible = rpm !== null; // Unknown drive state must not look like a confirmed stop.
  }, () => { phase = 0; rotor.rotation.x = 0; }, () => ({ phase, rpm, flow }));
});
registerModel('process.valve.control', asset => {
  const root=new THREE.Group(), machine=new THREE.Group();root.add(machine);machine.scale.setScalar(asset.parameters.scale);
  box(machine,[1.45,.72,.10],[0,0,.10],dark);
  tubeBetween(machine,v(-.72,0,.62),v(.72,0,.62),.16,steel);
  flange(machine,v(-.72,0,.62),v(-1,0,0));flange(machine,v(.72,0,.62),v(1,0,0));
  const body=mesh(machine,new THREE.SphereGeometry(.31,40,24),teal,v(0,0,.62));body.scale.x=1.18;
  tubeBetween(machine,v(0,0,.80),v(0,0,1.12),.065,steel);
  box(machine,[.52,.40,.24],[0,0,1.22],dark);
  const indicator=new THREE.Group();indicator.position.z=1.39;machine.add(indicator);
  box(indicator,[.38,.045,.035],[.02,0,0],amber);
  let opening:number|null=null;
  return finish(asset,root,signals=>{opening=readSignal(signals,'opening','%');indicator.visible=opening!==null;indicator.rotation.z=(opening??0)*Math.PI/200;},()=>{},()=>({opening}));
});
registerModel('instrumentation.flowmeter.inline', asset => {
  const root=new THREE.Group(), machine=new THREE.Group();root.add(machine);machine.scale.setScalar(asset.parameters.scale);
  tubeBetween(machine,v(-.58,0,.62),v(.58,0,.62),.13,steel);flange(machine,v(-.58,0,.62),v(-1,0,0));flange(machine,v(.58,0,.62),v(1,0,0));
  const housing=mesh(machine,new THREE.CylinderGeometry(.32,.32,.22,40),dark,v(0,0,1.02));housing.rotation.x=Math.PI/2;
  const face=mesh(machine,new THREE.CircleGeometry(.27,40),presetMaterial('glass'),v(0,-.12,1.02));face.rotation.x=Math.PI/2;
  tubeBetween(machine,v(0,0,.66),v(0,0,.88),.055,steel);
  let flow:number|null=null;return finish(asset,root,signals=>{flow=readSignal(signals,'flow','m3/h');},()=>{},()=>({flow}));
});
registerModel('process.heat-exchanger.plate', asset => {
  const root=new THREE.Group(), machine=new THREE.Group();root.add(machine);machine.scale.setScalar(asset.parameters.scale);
  box(machine,[1.25,.78,.10],[0,0,.08],dark);box(machine,[1.08,.56,.96],[0,0,.68],dark);
  for(let i=0;i<13;i++) box(machine,[.035,.64,.92],[(i-6)*.075,0,.68],i%2?steel:lightSteel);
  for(const x of [-.70,.70]){tubeBetween(machine,v(x>0?.45:-.45,0,.62),v(x,0,.62),.13,steel);flange(machine,v(x,0,.62),v(Math.sign(x),0,0));}
  let flow:number|null=null,temperature:number|null=null;
  return finish(asset,root,signals=>{flow=readSignal(signals,'flow','m3/h');temperature=readSignal(signals,'temperature','°C');},()=>{},()=>({flow,temperature}));
});
registerModel('process.valve.three-way.diverting', asset => {
  const root = new THREE.Group(), machine = new THREE.Group(); root.add(machine); machine.scale.setScalar(asset.parameters.scale);
  box(machine, [.7, .65, .1], [0, 0, .1]);
  tubeBetween(machine, v(0, 0, .15), v(0, 0, .65), .12, dark);
  for (const end of [v(-.75, 0, .65), v(.75, 0, .65), v(0, -.75, .65)]) {
    tubeBetween(machine, v(0, 0, .65), end, .18, teal); flange(machine, end, end.clone().sub(v(0, 0, .65)).normalize());
  }
  mesh(machine, new THREE.SphereGeometry(.28, 32, 20), teal, v(0, 0, .65));
  tubeBetween(machine, v(0, 0, .8), v(0, 0, 1.18), .075);
  box(machine, [.58, .4, .28], [0, 0, 1.26], dark);
  const indicator = new THREE.Group(); indicator.position.z = 1.44; machine.add(indicator);
  box(indicator, [.24, .045, .03], [.1, 0, 0], amber);
  const pointer = mesh(indicator, new THREE.ConeGeometry(.06, .13, 3), amber, v(.27, 0, 0)); pointer.rotation.z = -Math.PI / 2;
  let position: number | null = null;
  return finish(asset, root, signals => {
    position = readSignal(signals, 'position', '%');
    indicator.visible = position !== null && position >= 0 && position <= 100;
    indicator.rotation.z = -(position ?? 0) / 100 * Math.PI / 2;
  }, () => {}, () => ({ position }));
});
export function createModel(asset: Asset): Model {
  const builder = builders.get(asset.type);
  if (!builder) throw new Error(`No 3D renderer for ${asset.type}`);
  return builder(asset);
}
export const materials = { steel, dark, teal, fluid, greyFluid, pipeShell, fluidSurface, fluidHighlight };
