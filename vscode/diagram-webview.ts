import { installEquipment } from '../plant/equipment';
import { SceneView } from '../src/view';
import type { Scene } from '../src/scene';

declare function acquireVsCodeApi(): { postMessage(value: unknown): void };

interface DiagramDocument {
  schema: 1;
  project: { id: string; title: string; directory: string };
  scene: Scene;
}

const data = document.getElementById('data');
const svg = document.getElementById('scene') as unknown as SVGSVGElement;
if (!data || !svg)
  throw new Error('Saturn diagram webview is missing its data or SVG host');

const documentModel = JSON.parse(data.textContent ?? '') as DiagramDocument;
if (documentModel.schema !== 1 || !documentModel.scene)
  throw new Error('Unsupported Saturn diagram document');

installEquipment();
const vscode = acquireVsCodeApi();
const view = new SceneView(svg);
view.render(documentModel.scene);
view.fit();

svg.addEventListener('click', event => {
  const target = (event.target as Element | null)?.closest<SVGGElement>('[data-node]');
  const id = target?.dataset.node;
  if (!id)
    return;
  view.select(id);
  vscode.postMessage({ type: 'reveal', id });
});

svg.addEventListener('dblclick', event => {
  const group = (event.target as Element | null)?.closest<SVGGElement>('[data-group]');
  const id = group?.dataset.group;
  if (id)
    view.fitGroup(id);
});

svg.addEventListener('wheel', event => {
  event.preventDefault();
  view.zoom(event.deltaY < 0 ? 0.88 : 1.14);
}, { passive: false });

window.addEventListener('keydown', event => {
  if (event.key === '+' || event.key === '=') view.zoom(0.82);
  else if (event.key === '-') view.zoom(1.22);
  else if (event.key === '0') view.fit();
});
window.addEventListener('resize', () => view.fit());
window.addEventListener('unload', () => view.dispose());
