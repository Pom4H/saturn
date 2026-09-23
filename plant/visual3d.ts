import { terminals, footprint, type Side, type Terminal } from './ports';
import { drawHmiCanvas, getDisplay } from './hmi-view';
import { renderSaturnPlcSvg } from './saturn-view';
import type * as THREE from 'three';
import type { EquipmentModel3D, Renderer3DContext } from '../src/view';
import { materialPresets, type MaterialPreset } from '../src/elements/materials';

/** Schematic Z-up equipment, using the host's metal/teal/dark palette.
 * No plant coordinates, real reactor geometry or behavior lives in the renderer. */
export function createPlantModel(c: Renderer3DContext, visual: string, readout: string): EquipmentModel3D {
    const T = c.THREE, root = new T.Group(), { steel, dark, teal, fluid } = c.materials;
    root.userData.visual = visual;
    const geometries = new Set<THREE.BufferGeometry>();
    const owned: THREE.Material[] = [];
    const instances: THREE.InstancedMesh[] = [];
    const update: ((dt: number) => void)[] = [];
    const material = (preset: MaterialPreset) => {
        const m = new T.MeshStandardMaterial({ color:preset.color, roughness:preset.roughness, metalness:preset.metalness, transparent:(preset.opacity??1)<1, opacity:preset.opacity??1 });
        owned.push(m); return m;
    };
    const copper = material(materialPresets.copper), red = material(materialPresets.danger);
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = root) => {
        geometries.add(g); const n = new T.Mesh(g, m); n.position.set(x, y, z); n.castShadow = true; n.receiveShadow = true; parent.add(n); return n;
    };
    const box = (w: number, d: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, parent = root) => mesh(new T.BoxGeometry(w, d, h), m, x, y, z, parent);
    const cylinder = (radius: number, length: number, m: THREE.Material, x = 0, y = 0, z = 0, axis: 'x' | 'y' | 'z' = 'z', parent: THREE.Object3D = root) => {
        const n = mesh(new T.CylinderGeometry(radius, radius, length, 20), m, x, y, z, parent);
        if (axis === 'z') n.rotation.x = Math.PI / 2; else if (axis === 'x') n.rotation.z = Math.PI / 2;
        return n;
    };
    const ring = (radius: number, tube: number, m: THREE.Material, x: number, y: number, z: number, axis: 'y' | 'z' = 'y') => {
        const n = mesh(new T.TorusGeometry(radius, tube, 6, 24), m, x, y, z); if (axis === 'y') n.rotation.x = Math.PI / 2; return n;
    };
    const base = (width = 1.15) => { box(width, .75, .09, dark, 0, 0, .05); for (const x of [-width * .35, width * .35]) box(.1, .6, .15, steel, x, 0, .15); };
    const ports = new Map<string, THREE.Vector3>(), portNormals=new Map<string,THREE.Vector3>();
    const textureDisposers:(()=>void)[]=[];
    const flanges = (z = .65) => { for (const x of [-.63, .63]) { cylinder(.12, .28, steel, x, 0, z, 'x'); cylinder(.17, .05, dark, x * 1.1, 0, z, 'x'); } };
    const rotating = (key: string, z: number, radius = .25) => {
        const rotor = new T.Group(); rotor.position.set(0, -.26, z); rotor.userData.part = 'rotor'; root.add(rotor);
        const geometry = new T.BoxGeometry(radius, .025, .07); geometries.add(geometry);
        const blades = new T.InstancedMesh(geometry, teal, 6), o = new T.Object3D();
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; o.position.set(Math.cos(a) * radius / 2, 0, Math.sin(a) * radius / 2); o.rotation.y = -a; o.updateMatrix(); blades.setMatrixAt(i, o.matrix); }
        instances.push(blades); rotor.add(blades); cylinder(.06, .09, copper, 0, 0, 0, 'y', rotor);
        update.push(dt => { const rpm = c.number(key, dt); if (rpm !== null) rotor.rotation.y = -2 * Math.PI * c.phase('rotor', rpm / 60 * .04, dt); });
        return rotor;
    };
    let top = 1.4;
    switch (visual) {
        case 'pump':
            base(); flanges(); cylinder(.35, .28, steel, 0, -.06, .65, 'y'); ring(.28, .035, dark, 0, -.23, .65);
            cylinder(.21, .45, dark, 0, .28, .65, 'y'); rotating('rpm', .65); break;
        case 'turbine':
            base(); flanges(); cylinder(.35, .65, steel, 0, .04, .66, 'y');
            for (const y of [-.3, 0, .35]) ring(.35, .025, dark, 0, y, .66);
            rotating('rpm', .66); break;
        case 'reactor': {
            base(); cylinder(.48, .95, steel, 0, .13, .65); cylinder(.51, .1, dark, 0, .13, 1.14);
            box(.67, .05, .65, dark, 0, -.35, .65);
            const geo = new T.CylinderGeometry(.022, .022, .72, 8); geometries.add(geo);
            const rods = new T.InstancedMesh(geo, copper, 7), o = new T.Object3D();
            for (let i = 0; i < 7; i++) { o.position.set((i - 3) * .085, -.4, .65); o.rotation.x = Math.PI / 2; o.updateMatrix(); rods.setMatrixAt(i, o.matrix); } instances.push(rods); root.add(rods);
            ring(.48, .035, steel, 0, .13, 1.16, 'z'); top = 1.7; break;
        }
        case 'channel': {
            base(1.25); cylinder(.19, 1.12, steel, 0, 0, .45, 'x');
            for (const x of [-.56, .56]) cylinder(.23, .08, dark, x, 0, .45, 'x');
            for (const z of [.38, .46, .54]) cylinder(.023, .82, copper, 0, -.19, z, 'x');
            const damage = box(.08, .43, .42, red, 0, 0, .45); damage.userData.part = 'damage';
            update.push(() => { const value = c.signal('damage'); damage.visible = value?.quality === 'good' && (value.value as number) > .05; }); break;
        }
        case 'separator':
            base(1.4); cylinder(.32, 1.15, steel, 0, 0, .68, 'x'); for (const x of [-.59, .59]) cylinder(.34, .07, dark, x, 0, .68, 'x');
            box(.95, .05, .17, fluid, 0, -.31, .59); cylinder(.09, .25, steel, 0, 0, 1.06); break;
        case 'exchanger': {
            base(); box(.95, .55, .7, dark, 0, 0, .65);
            const geo = new T.BoxGeometry(.04, .64, .73); geometries.add(geo);
            const plates = new T.InstancedMesh(geo, steel, 12), o = new T.Object3D();
            for (let i = 0; i < 12; i++) { o.position.set((i - 5.5) * .075, 0, .65); o.updateMatrix(); plates.setMatrixAt(i, o.matrix); } instances.push(plates); root.add(plates); flanges(); break;
        }
        case 'generator':
            base(); cylinder(.3, .7, steel, 0, .02, .65, 'y'); ring(.24, .05, copper, 0, -.35, .65); cylinder(.08, .15, dark, 0, -.36, .65, 'y'); box(.35, .25, .16, teal, 0, .05, 1); break;
        case 'control':
        case 'switchgear': {
            base(.95); box(.8, .44, .98, steel, 0, 0, .64); box(.7, .02, .78, dark, 0, -.24, .67);
            for (let i = 0; i < 3; i++) box(.15, .02, .15, teal, (i - 1) * .22, -.26, .87);
            const lamp = cylinder(.07, .025, teal, 0, -.27, .52, 'y'); lamp.userData.part = 'status';
            update.push(() => { const trip = c.number('trip'); lamp.material = trip === null ? dark : trip > .5 ? red : teal; }); top = 1.65; break;
        }
        case 'flowmeter': {
            base(); flanges(.58); cylinder(.24, .42, steel, 0, 0, .58, 'x');
            cylinder(.035, .42, steel, 0, 0, .91); cylinder(.25, .12, steel, 0, 0, 1.16, 'y');
            cylinder(.21, .025, dark, 0, -.07, 1.16, 'y');
            const needle = new T.Group(); needle.position.set(0, -.09, 1.16); root.add(needle); needle.userData.part = 'needle';
            box(.016, .025, .17, copper, 0, 0, .06, needle);
            update.push(dt => { const value = c.number('flow', dt); needle.visible = value !== null; needle.rotation.y = -(Math.max(-110, Math.min(110, (value ?? 0) * 55 - 55))) * Math.PI / 180; });
            top = 1.65; break;
        }
        case 'sensor': {
            base(.6); cylinder(.035, .5, steel, 0, 0, .4); cylinder(.27, .13, steel, 0, 0, .9, 'y');
            cylinder(.23, .025, dark, 0, -.075, .9, 'y');
            const needle = new T.Group(); needle.position.set(0, -.1, .9); root.add(needle); needle.userData.part = 'needle';
            box(.018, .025, .19, copper, 0, 0, .07, needle);
            update.push(dt => { const value = c.number('value', dt); needle.visible = value !== null; needle.rotation.y = -(Math.max(-100, Math.min(100, (value ?? 0) * 50 - 60))) * Math.PI / 180; }); top = 1.6; break;
        }
        case 'structure':
            base(1.35); for (const x of [-.52, -.17, .17, .52]) box(.075, .65, .8, steel, x, 0, .55);
            box(1.3, .78, .12, steel, 0, 0, 1.01); box(1.1, .04, .62, dark, 0, .3, .55); break;
        case 'reservoir': {
            base(); cylinder(.4, .85, steel, 0, .1, .65); cylinder(.42, .08, dark, 0, .1, 1.12);
            box(.42, .035, .66, dark, 0, -.31, .67);
            const liquid = box(.38, .045, 1, fluid, 0, -.34, .67); liquid.userData.part = 'level';
            update.push(dt => { const level = c.number('level', dt); liquid.visible = level !== null; const h = Math.max(.001, Math.min(1, (level ?? 0) / 100)) * .62; liquid.scale.z = h; liquid.position.z = .36 + h / 2; }); top = 1.65; break;
        }
        case 'valve': {
            base(); flanges(.47); mesh(new T.SphereGeometry(.22, 16, 12), steel, 0, 0, .47);
            cylinder(.045, .45, steel, 0, 0, .85); box(.5, .35, .22, dark, 0, 0, 1.09);
            const indicator = box(.38, .035, .03, teal, 0, 0, 1.22); indicator.userData.part = 'opening';
            update.push(dt => { const v = c.number('opening', dt); indicator.visible = v !== null; indicator.rotation.z = (v ?? 0) * Math.PI / 200; }); top = 1.7; break;
        }
        case 'battery': {
            base(); box(.75, .45, .94, steel, 0, 0, .63);
            for (let i = 0; i < 3; i++) { box(.6, .025, .2, dark, 0, -.24, .4 + .25 * i); box(.07, .045, .04, copper, .2, -.25, .48 + .25 * i); }
            const charge = box(.5, .03, .035, teal, 0, -.26, 1.01); charge.userData.part = 'charge';
            update.push(dt => { const value = c.number('charge', dt); charge.visible = value !== null; charge.scale.x = Math.max(.001, (value ?? 0) / 100); }); top = 1.6; break;
        }
        case 'fan':
            base(); cylinder(.35, .33, steel, 0, 0, .7, 'y'); ring(.32, .035, dark, 0, -.23, .7); rotating('rpm', .7, .29); break;
        case 'motor':
            base(); cylinder(.27,.7,steel,0,0,.62,'x'); cylinder(.09,.32,dark,.53,0,.62,'x');
            for(const x of [-.25,-.12,0,.12,.25]) { const r = ring(.28,.02,dark,x,0,.62,'z'); r.rotation.y=Math.PI/2; }
            box(.35,.26,.2,teal,0,0,.97); rotating('rpm',.62,.2); break;
        case 'tower': {
            base(1.35); box(1.1,.82,.15,fluid,0,0,.19);
            for(const x of [-.45,.45]) box(.08,.7,.96,steel,x,0,.75);
            for(let i=0;i<7;i++) box(.87,.72,.045,steel,0,0,.36+i*.12);
            cylinder(.35,.13,dark,0,0,1.3); ring(.35,.03,teal,0,0,1.38,'z');
            const fan=new T.Group();fan.position.z=1.4;root.add(fan);fan.userData.part='rotor';
            for(let i=0;i<4;i++){const b=box(.24,.07,.025,teal,.12,0,0,fan);b.position.set(Math.cos(i*Math.PI/2)*.12,Math.sin(i*Math.PI/2)*.12,0);b.rotation.z=i*Math.PI/2;}
            update.push(dt=>{const rpm=c.number('rpm',dt);if(rpm!==null)fan.rotation.z=2*Math.PI*c.phase('rotor',rpm/60*.04,dt);});top=1.85;break;
        }
        case 'filter':
            base();flanges(.64);cylinder(.23,.74,steel,0,0,.64,'x');
            cylinder(.17,.43,dark,.12,0,.4);cylinder(.21,.07,steel,.12,0,.18);
            for(let i=0;i<4;i++) box(.04,.045,.35,copper,-.07+i*.075,-.23,.55);break;
        case 'checkvalve': {
            base();flanges(.6);cylinder(.28,.6,steel,0,0,.6,'x');ring(.28,.03,dark,0,0,.6,'z').rotation.y=Math.PI/2;
            const disc=box(.035,.32,.35,teal,0,-.1,.62);disc.userData.part='opening';
            update.push(dt=>{const v=c.number('opening',dt);disc.visible=v!==null;disc.rotation.y=(v??0)*Math.PI/300;});break;
        }
        case 'accumulator': {
            base();cylinder(.36,.82,steel,0,.06,.65);cylinder(.38,.07,dark,0,.06,1.1);
            box(.43,.035,.62,dark,0,-.31,.66);cylinder(.07,.23,steel,0,0,.15);
            const fill=box(.39,.04,1,fluid,0,-.34,.5);fill.userData.part='level';
            update.push(dt=>{const v=c.number('level',dt);fill.visible=v!==null;const h=Math.max(.001,(v??0)*.0058);fill.scale.z=h;fill.position.z=.35+h/2;});top=1.65;break;
        }
        case 'relief': {
            base(.85);cylinder(.13,.45,steel,0,0,.35);cylinder(.15,.5,steel,.2,0,.57,'x');
            cylinder(.22,.4,steel,0,0,.77);cylinder(.25,.055,dark,0,0,1.02);
            for(let i=0;i<5;i++) ring(.12,.02,copper,0,-.19,.68+i*.06,'z');
            const stem=cylinder(.025,.36,teal,0,-.21,.77);stem.userData.part='opening';
            update.push(dt=>{const v=c.number('opening',dt);stem.visible=v!==null;stem.position.z=.77+(v??0)*.001;});top=1.55;break;
        }
        case 'transformer':
            base(1.3);box(.83,.66,.62,steel,0,0,.6);
            for(const x of [-.55,.55]) for(let i=0;i<5;i++) box(.13,.045,.6,dark,x,(i-2)*.13,.59);
            for(const x of [-.25,0,.25]) {cylinder(.035,.3,dark,x,0,1.07);for(let i=0;i<4;i++)cylinder(.07,.025,copper,x,0,.98+i*.05);}
            top=1.7;break;
        case 'alternator':
            base();flanges(.64);cylinder(.34,.75,steel,0,0,.65,'y');ring(.29,.035,copper,0,-.39,.65);
            box(.4,.3,.18,dark,0,0,1.1);rotating('rpm',.65);break;
        case 'calorimeter': {
            base();cylinder(.4,.83,steel,0,.08,.65);cylinder(.42,.08,dark,0,.08,1.1);flanges(.5);
            box(.55,.04,.58,dark,0,-.33,.65);
            for(let i=0;i<5;i++) cylinder(.025,.5,copper,(i-2)*.09,-.37,.65);
            const meter=box(.035,.04,1,teal,.32,-.38,.65);meter.userData.part='temperature';
            update.push(dt=>{const v=c.number('temperature',dt);meter.visible=v!==null;const h=Math.min(.6,Math.max(.001,(v??0)*.18));meter.scale.z=h;meter.position.z=.34+h/2;});top=1.65;break;
        }
        case 'dcSupply':
            base();box(1,.7,.8,steel,0,0,.6);for(let i=0;i<5;i++)box(.8,.02,.04,dark,0,-.36,.38+i*.1);top=1.4;break;
        case 'transmitter':
            base(.7);cylinder(.22,.25,steel,0,0,.4);cylinder(.3,.14,dark,0,-.13,.78,'y');cylinder(.22,.15,teal,0,-.2,.78,'y');break;
        case 'contactor': {
            base();box(.95,.6,.6,steel,0,0,.5);box(.4,.64,.5,dark,-.2,0,.55);const blade=box(.04,.3,.06,copper,.24,0,.87);update.push(()=>{blade.rotation.z=(c.number('closed')??0)>.8?0:.8;});break;
        }
        case 'indicator': {base(.8);cylinder(.27,.2,dark,0,0,.5);const light=cylinder(.23,.15,teal,0,0,.67);update.push(()=>{light.scale.setScalar(.7+.3*(c.number('brightness')??0));});break;}
        case 'ioModule':
            base();box(1.1,.65,.8,steel,0,0,.55);box(.7,.04,.4,dark,0,-.35,.68);for(let i=0;i<4;i++)cylinder(.04,.03,teal,(i-1.5)*.16,-.38,.6,'y');break;
        case 'junction': base();cylinder(.12,1.5,steel,0,.11,.65,'x');cylinder(.12,.4,steel,0,-.1,.65,'y');break;
        case 'saturn': {
            box(3,1,.65,dark,0,.1,.5);box(3,.96,.08,steel,0,.1,.88);
            if(typeof document!=='undefined') {
                const canvas=document.createElement('canvas');canvas.width=1240;canvas.height=680;
                const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
                const faceMaterial=new T.MeshBasicMaterial({map:texture,transparent:true,side:T.DoubleSide});owned.push(faceMaterial);
                mesh(new T.PlaneGeometry(3.1,1.7),faceMaterial,0,.1,.995);
                const img=new Image();img.onload=()=>{canvas.getContext('2d')?.drawImage(img,0,0,1240,680);texture.needsUpdate=true;c.invalidate?.();};
                img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(renderSaturnPlcSvg({defsPrefix:'face-'+c.equipment.id}));
                const hmi=document.createElement('canvas');hmi.width=320;hmi.height=240;
                const screen=new T.CanvasTexture(hmi);screen.colorSpace=T.SRGBColorSpace;
                const screenMaterial=new T.MeshBasicMaterial({map:screen,side:T.DoubleSide});owned.push(screenMaterial);
                mesh(new T.PlaneGeometry(1.11,.79),screenMaterial,0,.1,1.02);
                let key='';update.push(()=>{const next=JSON.stringify(getDisplay(c.equipment.id));if(next!==key){key=next;drawHmiCanvas(hmi,c.equipment.id,()=>{screen.needsUpdate=true;c.invalidate?.();});}});
                // Textures are separate GPU resources, retained until the device is disposed.
                textureDisposers.push(()=>{img.onload=null;texture.dispose();screen.dispose();});
            }
            top=1.65;break;
        }
        default: throw new Error(`No installed 3D anatomy for ${visual}`);
    }
    const size=footprint(visual);
    const directions:Record<Side,THREE.Vector3>={left:new T.Vector3(-1,0,0),right:new T.Vector3(1,0,0),up:new T.Vector3(0,1,0),down:new T.Vector3(0,-1,0)};
    for(const [name,p] of Object.entries(terminals(visual)) as [string,Terminal][]){
        const point=new T.Vector3((p.x-size.width/2)/100,-(p.y-size.height/2)/100,p.z);
        const normal=directions[p.side];
        ports.set(name,point);portNormals.set(name,normal);
        const socket=mesh(new T.SphereGeometry(visual==='saturn'?.027:.047,8,6),p.medium==='pipe'?steel:p.medium==='power'?copper:teal,point.x,point.y,point.z);
        socket.userData.terminal=name;socket.userData.endpoint=point.toArray();
        if(visual!=='saturn') {
            const length=p.medium==='pipe'?.48:.18, start=point.clone().addScaledVector(normal,-length),middle=start.clone().add(point).multiplyScalar(.5);
            const nozzle=mesh(new T.CylinderGeometry(p.medium==='pipe'?.085:.028,p.medium==='pipe'?.085:.028,length,10),p.medium==='pipe'?steel:dark,middle.x,middle.y,middle.z);
            nozzle.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),normal);
            if(p.medium==='pipe'){const flange=mesh(new T.TorusGeometry(.11,.024,5,12),dark,point.x,point.y,point.z);flange.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),normal);}
        }

    }
    let disposed = false;
    return { root, ports, portNormals, readout, labelAnchor: new T.Vector3(0, 0, top),
        update: dt => { for (const fn of update) fn(dt); },
        metrics: () => ({ value: c.number(readout) }),
        dispose() { if (disposed) return; disposed = true; for(const dispose of textureDisposers)dispose(); for (const instance of instances) instance.dispose(); for (const g of geometries) g.dispose(); for (const m of owned) m.dispose(); },
    };
}
