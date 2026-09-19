import * as T from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { HydraulicLoop } from './model';

export function createScene(host: HTMLElement, model: HydraulicLoop) {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Трёхмерная модель: два резервуара, насос и замкнутый контур труб');
  renderer.domElement.setAttribute('role', 'img');
  const scene = new T.Scene();
  const environment = new RoomEnvironment();
  const pmrem = new T.PMREMGenerator(renderer);
  const environmentMap = pmrem.fromScene(environment, .025);
  scene.environment = environmentMap.texture;
  environment.dispose(); pmrem.dispose();
  const camera = new T.PerspectiveCamera(32, 1, .1, 80);
  const target = new T.Vector3(0, 1.18, 0);
  camera.position.set(7, 5.5, 8.5); camera.lookAt(target);
  scene.add(new T.HemisphereLight(0xd9ecff, 0x102548, 1.1));
  const sun = new T.DirectionalLight(0xe8f2ff, 3);
  sun.position.set(-3, 8, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
  sun.shadow.bias = -.001; sun.shadow.normalBias = .025;
  scene.add(sun);
  const rim = new T.DirectionalLight(0x1673ff, 3.5);
  rim.position.set(4, 3, -4); scene.add(rim);
  const fill = new T.DirectionalLight(0x66dfff, 1.2);
  fill.position.set(-4, 2, 1); scene.add(fill);
  const root = new T.Group(); scene.add(root);
  const steel = new T.MeshStandardMaterial({ color: 0xc5d4e8, metalness: .82, roughness: .22 });
  const dark = new T.MeshStandardMaterial({ color: 0x15253e, metalness: .7, roughness: .32 });
  const black = new T.MeshStandardMaterial({ color: 0x080f1f, metalness: .15, roughness: .68 });
  const accent = new T.MeshStandardMaterial({ color: 0x0865ff, metalness: .3, roughness: .3 });
  const water = new T.MeshPhysicalMaterial({ color: 0x008ee5, emissive: 0x003e80, emissiveIntensity: .2, metalness: .16, roughness: .16, transparent: true, opacity: .88, clearcoat: 1 });
  const glass = new T.MeshPhysicalMaterial({ color: 0xc7e7ff, metalness: .05, roughness: .12, transparent: true, opacity: .14, side: T.DoubleSide, depthWrite: false });
  const flowMaterial = new T.MeshStandardMaterial({ color: 0x8df5ff, emissive: 0x00baff, emissiveIntensity: .6, roughness: .4 });
  const pipeMaterial = new T.MeshPhysicalMaterial({ color: 0x79b9f6, roughness: .3, metalness: .3, transparent: true, opacity: .4, depthWrite: false });
  const boltGeometry = new T.CylinderGeometry(.035, .035, .065, 6);
  function mesh(geometry: T.BufferGeometry, material: T.Material, x: number, y: number, z: number, parent: T.Object3D = root) {
    const object = new T.Mesh(geometry, material); object.position.set(x, y, z);
    object.castShadow = object.receiveShadow = true; parent.add(object); return object;
  }
  function cylinder(radius: number, height: number, material: T.Material, x: number, y: number, z: number, parent: T.Object3D = root) {
    return mesh(new T.CylinderGeometry(radius, radius, height, 48), material, x, y, z, parent);
  }
  function box(w: number, h: number, d: number, material: T.Material, x: number, y: number, z: number, parent: T.Object3D = root) {
    return mesh(new T.BoxGeometry(w, h, d), material, x, y, z, parent);
  }
  function label(text: string, x: number, y: number, z: number, w = .6, h = .2) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 80;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#dce8f8'; ctx.fillRect(0, 0, 256, 80);
    ctx.fillStyle = '#10203a'; ctx.font = '500 32px monospace'; ctx.textAlign = 'center'; ctx.fillText(text, 128, 52);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    return mesh(new T.PlaneGeometry(w, h), new T.MeshStandardMaterial({ map: texture, roughness: .7 }), x, y, z);
  }
  const plate = box(5.6, .18, 3.5, dark, 0, .12, 0);
  for (const x of [-2.35, 2.35]) for (const z of [-1.35, 1.35]) {
    cylinder(.12, .15, black, x, -.02, z);
    cylinder(.05, .025, steel, x, .225, z);
  }
  const floor = mesh(new T.PlaneGeometry(100, 100), new T.ShadowMaterial({ opacity: .16 }), 0, -.105, 0, scene);
  floor.rotation.x = -Math.PI / 2; floor.castShadow = false;
  const liquids: T.Mesh[] = [];
  for (const [index, x] of [-1.45, 1.35].entries()) {
    const z = -.4;
    cylinder(.7, .18, steel, x, .4, z);
    cylinder(.68, .07, black, x, .51, z);
    const liquid = cylinder(.57, 1, water, x, .9, z); liquids.push(liquid);
    cylinder(.63, 1.87, glass, x, 1.47, z).castShadow = false;
    cylinder(.7, .13, steel, x, 2.45, z);
    cylinder(.5, .055, dark, x, 2.53, z);
    cylinder(.10, .19, steel, x, 2.63, z);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      mesh(boltGeometry, dark, x + Math.cos(a) * .59, 2.54, z + Math.sin(a) * .59);
      if (i % 2 === 1) cylinder(.018, 1.86, steel, x + Math.cos(a) * .65, 1.47, z + Math.sin(a) * .65);
    }
    for (let i = 0; i <= 8; i++) box(i % 2 ? .055 : .095, .012, .015, steel, x + .27, .67 + i * .19, z + .58);
    label(`TK-0${index + 1}`, x, .40, z + .708);
  }
  // Motor housing and fins. Rotor angle is integrated from the simulated speed.
  box(1.45, .15, .8, black, 0, .33, 1);
  const motor = cylinder(.34, .75, accent, .08, .77, 1); motor.rotation.z = Math.PI / 2;
  for (let i = 0; i < 9; i++) { const fin = cylinder(.36, .028, dark, -.27 + i * .085, .77, 1); fin.rotation.z = Math.PI / 2; }
  const pump = cylinder(.4, .24, steel, -.5, .77, 1); pump.rotation.z = Math.PI / 2;
  box(.32, .17, .3, accent, .1, 1.16, 1);
  const rotor = new T.Group(); root.add(rotor); rotor.position.set(.5, .77, 1);
  for (let i = 0; i < 6; i++) { const blade = box(.035, .43, .07, steel, 0, 0, 0, rotor); blade.rotation.x = i * Math.PI / 3; }
  const shield = cylinder(.35, .025, glass, .53, .77, 1); shield.rotation.z = Math.PI / 2;
  label('P-01', 0, .37, 1.415, .45, .12);
  const pipes: { curve: T.CatmullRomCurve3; beads: T.Mesh[]; phase: number; kind: 'inlet' | 'outlet' }[] = [];
  function pipe(points: number[][], kind: 'inlet' | 'outlet') {
    const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p as [number, number, number])), false, 'centripetal');
    mesh(new T.TubeGeometry(curve, 96, .075, 12, false), pipeMaterial, 0, 0, 0);
    mesh(new T.TubeGeometry(curve, 96, .042, 10, false), water, 0, 0, 0);
    // Flow marks move inside the translucent line, with speed derived from its flow.
    const beads = Array.from({ length: 10 }, () => mesh(new T.SphereGeometry(.048, 10, 8), flowMaterial, 0, 0, 0));
    pipes.push({ curve, beads, phase: 0, kind });
  }
  pipe([[1.35,.60,.1],[1.35,.60,1],[.75,.63,1],[.45,.77,1]], 'inlet');
  pipe([[-.5,1,1],[-.6,1.2,1],[-1.95,1.2,1],[-2.25,1.5,.9],[-2.25,2.85,-.4],[-1.45,2.85,-.4],[-1.45,2.56,-.4]], 'inlet');
  pipe([[-1.45,.62,-.95],[-1.45,.65,-1.4],[-.3,.68,-1.45],[.4,.68,-1.45],[1.35,.68,-1.4],[1.35,.65,-.9]], 'outlet');
  const valve = new T.Group(); valve.position.set(0, 1.03, -1.45); root.add(valve);
  cylinder(.028, .42, steel, 0, -.16, 0, valve);
  const handwheel = mesh(new T.TorusGeometry(.2, .025, 8, 32), accent, 0, .06, 0, valve); handwheel.rotation.x = Math.PI / 2;
  for (let i=0;i<3;i++) { const spoke=box(.4,.018,.018,accent,0,.06,0,valve);spoke.rotation.y=i*Math.PI/3; }
  // Pressure gauge with a physical needle, driven by the same model as the DOM readout.
  cylinder(.025, .37, steel, -.73, 1.25, 1.05);
  const gauge = cylinder(.18, .085, steel, -.73, 1.52, 1.05); gauge.rotation.x = Math.PI / 2;
  const face = mesh(new T.CircleGeometry(.158, 40), new T.MeshStandardMaterial({ color: 0xe6f0ff }), -.73, 1.52, 1.097);
  const needle = new T.Group(); needle.position.copy(face.position); needle.position.z += .01; root.add(needle);
  box(.008, .12, .008, accent, 0, .043, 0, needle);
  const dial = cylinder(.018, .013, dark, -.73, 1.52, 1.11); dial.rotation.x = Math.PI/2;
  let width = 0, height = 0, pointerX = 0, pointerY = 0, currentX = 0, currentY = 0;
  const resize = () => {
    width = host.clientWidth; height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height;
    camera.fov = width < 460 ? 41 : 32; camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host); resize();
  const move = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = host.getBoundingClientRect(); pointerX = (e.clientX - r.left) / r.width - .5; pointerY = (e.clientY - r.top) / r.height - .5;
  };
  const leave = () => { pointerX = pointerY = 0; };
  host.addEventListener('pointermove', move); host.addEventListener('pointerleave', leave);
  return {
    render(dt: number) {
      currentX += (pointerX - currentX) * .035; currentY += (pointerY - currentY) * .035;
      camera.position.set(7 + currentX * .8, 5.5 - currentY * .6, 8.5 - currentX * .4); camera.lookAt(target);
      [model.left, model.right].forEach((level, i) => { liquids[i].scale.y = Math.max(.005, level); liquids[i].position.y = .55 + level / 2; });
      rotor.rotation.x = model.phase * 13;
      needle.rotation.z = 1.9 - Math.min(1, model.pressure / 4) * 3.8;
      handwheel.rotation.z = (1 - model.valve) * 3;
      for (const p of pipes) {
        p.phase = (p.phase + model[p.kind] * dt * .6) % 1;
        p.beads.forEach((bead, i) => { bead.position.copy(p.curve.getPointAt((i / p.beads.length + p.phase) % 1)); });
      }
      renderer.render(scene, camera);
    },
    dispose() {
      resizeObserver.disconnect(); host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave);
      scene.traverse(o => { if (o instanceof T.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if ('map' in m) (m as T.MeshStandardMaterial).map?.dispose(); m.dispose(); } } });
      environmentMap.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
