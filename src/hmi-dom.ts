import type { HmiEquipmentNode, HmiNode, HmiPrimitive, HmiRuntime } from './hmi';

export interface HmiDomEquipmentInstance {
  element: HTMLElement;
  update?: () => void;
  destroy?: () => void;
}
export type HmiDomEquipmentRenderer = (node: HmiEquipmentNode, runtime: HmiRuntime) => HmiDomEquipmentInstance | HTMLElement;
export interface HmiDomOptions {
  equipment?: Readonly<Record<string, HmiDomEquipmentRenderer>>;
  interactive?: () => boolean;
  onError?: (error: unknown) => void;
}

const display = (value: HmiPrimitive, digits?: number, unit?: string) => {
  const text = typeof value === 'number' && digits !== undefined ? value.toFixed(digits) : value === null ? '—' : String(value);
  return unit ? `${text} ${unit}` : text;
};
const tag = (name: string) => document.createElement(name);

export function mountHmiDom(host: HTMLElement, runtime: HmiRuntime, options: HmiDomOptions = {}) {
  let structure = '';
  const updates: (() => void)[] = [];
  const destroys: (() => void)[] = [];
  const fail = (error: unknown) => options.onError?.(error);

  const common = (element: HTMLElement, node: HmiNode) => {
    element.id = node.id;
    element.dataset.hmiNode = node.type;
    if (node.className) element.className = node.className;
    if (node.style) for (const [key, value] of Object.entries(node.style)) element.style.setProperty(key, String(value));
    return element;
  };

  const build = (node: HmiNode): HTMLElement => {
    if (node.type === 'group') {
      const element = common(tag(node.as ?? 'div'), node);
      for (const child of node.children) element.append(build(child));
      return element;
    }
    if (node.type === 'text') {
      const element = common(tag(node.as ?? 'span'), node);
      const update = () => { element.textContent = display(runtime.resolve(node.text)); };
      updates.push(update); update(); return element;
    }
    if (node.type === 'readout') {
      const element = common(tag('output'), node);
      element.classList.add('hmi-readout');
      const update = () => {
        const value = runtime.resolve(node.value);
        element.textContent = display(value, node.digits, node.unit);
        element.dataset.quality = value === null ? 'bad' : 'good';
      };
      updates.push(update); update(); return element;
    }
    if (node.type === 'button') {
      const element = common(tag('button'), node) as HTMLButtonElement;
      element.type = 'button';
      element.onclick = () => void runtime.dispatch(node.action).catch(fail);
      const update = () => {
        element.textContent = display(runtime.resolve(node.label));
        element.disabled = (options.interactive ? !options.interactive() : false) || (node.disabledWhen ? Boolean(runtime.resolve(node.disabledWhen)) : false);
      };
      updates.push(update); update(); return element;
    }
    const renderer = options.equipment?.[node.renderer ?? node.equipmentId];
    if (!renderer) {
      const fallback = common(tag('div'), node);
      fallback.dataset.equipmentId = node.equipmentId;
      fallback.textContent = node.equipmentId;
      return fallback;
    }
    const rendered = renderer(node, runtime);
    const instance: HmiDomEquipmentInstance = rendered instanceof HTMLElement ? { element: rendered } : rendered;
    common(instance.element, node);
    instance.element.dataset.equipmentId = node.equipmentId;
    if (instance.update) updates.push(instance.update);
    if (instance.destroy) destroys.push(instance.destroy);
    instance.update?.();
    return instance.element;
  };

  const rebuild = () => {
    for (const destroy of destroys.splice(0)) destroy();
    updates.splice(0);
    const screen = runtime.currentScreen(), dialogs = runtime.currentDialogs();
    const main = tag('main');
    main.className = 'hmi-dom-screen';
    main.dataset.hmiApp = runtime.app.id;
    main.dataset.hmiScreen = screen.id;
    main.setAttribute('aria-label', screen.title);
    for (const node of screen.body) main.append(build(node));
    const nodes: Node[] = [main];
    for (const item of dialogs) {
      const dialog = document.createElement('dialog');
      dialog.open = true;
      dialog.className = 'hmi-dom-dialog';
      dialog.dataset.hmiDialog = item.id;
      dialog.setAttribute('aria-label', item.title);
      const title = tag('h2'); title.textContent = item.title; dialog.append(title);
      for (const node of item.body) dialog.append(build(node));
      nodes.push(dialog);
    }
    host.replaceChildren(...nodes);
  };

  const render = () => {
    const snapshot = runtime.snapshot();
    const next = runtime.currentScreen().id + '|' + snapshot.dialogs.join(',');
    if (structure !== next) { structure = next; rebuild(); }
    else for (const update of updates) update();
    host.dataset.hmiRevision = String(snapshot.revision);
  };

  const unsubscribe = runtime.subscribe(render);
  render();
  return {
    render,
    dispose() { unsubscribe(); for (const destroy of destroys) destroy(); host.replaceChildren(); },
  };
}
