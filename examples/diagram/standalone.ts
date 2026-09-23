import { simulate } from "./simulation";
import "../../src/components/installed";
import "../../src/visual-components";
import { SceneView } from "../../src/view";
const svg = document.getElementById('scene') as unknown as SVGSVGElement;
const model = JSON.parse(document.getElementById('model')!.textContent!);
const view = new SceneView(svg, simulate); view.render(model); view.fit();
const button = document.getElementById('pause')!;
function sync() { button.textContent = view.paused ? 'Продолжить' : 'Пауза'; }
button.addEventListener('click', () => { view.paused = !view.paused; sync(); }); sync();
