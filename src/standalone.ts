import { installEquipment } from '../plant/equipment';
installEquipment('ru');
import { SceneView } from './view';
const svg = document.getElementById('scene') as unknown as SVGSVGElement;
const model = JSON.parse(document.getElementById('model')!.textContent!);
const view = new SceneView(svg); view.render(model); view.setRuntime(JSON.parse(document.getElementById('runtime')!.textContent!)); view.fit();
const button = document.getElementById('pause')!;
function sync() { button.textContent = view.paused ? 'Продолжить' : 'Пауза'; }
button.addEventListener('click', () => { view.paused = !view.paused; sync(); }); sync();
