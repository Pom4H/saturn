import type { EquipmentCommand } from './runtime/protocol';

export type HmiPrimitive = string | number | boolean | null;
export type HmiRouteParam = string | number | boolean;
export interface HmiSignalRef<T extends HmiPrimitive = HmiPrimitive> {
  kind: 'signal';
  path: string;
  fallback?: T;
}
export type HmiValue<T extends HmiPrimitive = HmiPrimitive> = T | HmiSignalRef<T>;

export interface HmiNodeBase {
  id: string;
  className?: string;
  style?: Readonly<Record<string, string | number>>;
}
export interface HmiGroupNode extends HmiNodeBase {
  type: 'group';
  as?: 'div' | 'section' | 'nav' | 'header' | 'footer';
  children: readonly HmiNode[];
}
export interface HmiTextNode extends HmiNodeBase {
  type: 'text';
  as?: 'span' | 'p' | 'h1' | 'h2' | 'label';
  text: HmiValue<string>;
}
export interface HmiReadoutNode extends HmiNodeBase {
  type: 'readout';
  value: HmiValue;
  unit?: string;
  digits?: number;
}
export interface HmiButtonNode extends HmiNodeBase {
  type: 'button';
  label: HmiValue<string>;
  action: HmiAction;
  disabledWhen?: HmiValue<boolean>;
}
export interface HmiEquipmentNode extends HmiNodeBase {
  type: 'equipment';
  equipmentId: string;
  renderer?: string;
  props?: Readonly<Record<string, HmiValue>>;
}
export type HmiNode = HmiGroupNode | HmiTextNode | HmiReadoutNode | HmiButtonNode | HmiEquipmentNode;

export type HmiAction =
  | { type: 'navigate'; screen: string; params?: Readonly<Record<string, HmiRouteParam>>; replace?: boolean }
  | { type: 'back' }
  | { type: 'command'; equipmentId: string; command: string; value?: HmiValue<Exclude<HmiPrimitive, null>> }
  | { type: 'operate'; control: string; value: HmiValue<number> }
  | { type: 'write'; signal: string; value: HmiValue<Exclude<HmiPrimitive, null>> }
  | { type: 'toggle'; signal: string }
  | { type: 'open'; dialog: string }
  | { type: 'close' }
  | { type: 'ack'; alarm?: string }
  | { type: 'sequence'; actions: readonly HmiAction[] }
  | { type: 'confirm'; message: string; then: HmiAction }
  | { type: 'script'; id: string };

export interface HmiScreen {
  kind: 'screen';
  id: string;
  title: string;
  route: string;
  body: readonly HmiNode[];
}
export interface HmiDialog {
  kind: 'dialog';
  id: string;
  title: string;
  body: readonly HmiNode[];
}
export interface HmiApplication {
  version: 1;
  id: string;
  initial: string;
  screens: readonly HmiScreen[];
  dialogs: readonly HmiDialog[];
}
export interface HmiSnapshot {
  screen: string;
  params: Readonly<Record<string, string>>;
  dialogs: readonly string[];
  signals: Readonly<Record<string, HmiPrimitive>>;
  revision: number;
}
export interface HmiEnvironment {
  command?: (command: EquipmentCommand) => void | Promise<void>;
  operate?: (control: string, value: number) => void | Promise<void>;
  write?: (signal: string, value: Exclude<HmiPrimitive, null>) => void | Promise<void>;
  ack?: (alarm?: string) => void | Promise<void>;
  script?: (id: string, runtime: HmiRuntime) => void | Promise<void>;
  confirm?: (message: string) => boolean | Promise<boolean>;
  commandId?: () => string;
}
export interface HmiNavigation {
  current?: () => string;
  push(path: string): void;
  replace(path: string): void;
  back?: () => void;
  subscribe?: (listener: (path: string) => void) => () => void;
}

const identifier = /^[A-Za-z][A-Za-z0-9_.-]{0,95}$/;
const checkId = (value: string, label: string) => {
  if (!identifier.test(value) || /(?:__proto__|constructor|prototype)/.test(value)) throw new Error(`${label}: invalid identifier ${value}`);
  return value;
};
const list = (value: HmiNode | readonly HmiNode[]): readonly HmiNode[] => Array.isArray(value) ? value : [value as HmiNode];

export const bind = <T extends HmiPrimitive>(path: string, fallback?: T): HmiSignalRef<T> =>
  ({ kind: 'signal', path: checkId(path, 'signal'), ...(fallback === undefined ? {} : { fallback }) });
export const group = (id: string, children: HmiNode | readonly HmiNode[], options: Omit<HmiGroupNode, 'id' | 'type' | 'children'> = {}): HmiGroupNode =>
  ({ type: 'group', id: checkId(id, 'group'), children: list(children), ...options });
export const text = (id: string, value: HmiValue<string>, options: Omit<HmiTextNode, 'id' | 'type' | 'text'> = {}): HmiTextNode =>
  ({ type: 'text', id: checkId(id, 'text'), text: value, ...options });
export const readout = (id: string, value: HmiValue, options: Omit<HmiReadoutNode, 'id' | 'type' | 'value'> = {}): HmiReadoutNode =>
  ({ type: 'readout', id: checkId(id, 'readout'), value, ...options });
export const button = (id: string, label: HmiValue<string>, action: HmiAction, options: Omit<HmiButtonNode, 'id' | 'type' | 'label' | 'action'> = {}): HmiButtonNode =>
  ({ type: 'button', id: checkId(id, 'button'), label, action, ...options });
export const equipmentView = (id: string, equipmentId: string, options: Omit<HmiEquipmentNode, 'id' | 'type' | 'equipmentId'> = {}): HmiEquipmentNode =>
  ({ type: 'equipment', id: checkId(id, 'equipment view'), equipmentId: checkId(equipmentId, 'equipment'), ...options });
export const screen = (id: string, options: { title?: string; route?: string; body: HmiNode | readonly HmiNode[] }): HmiScreen =>
  ({ kind: 'screen', id: checkId(id, 'screen'), title: options.title ?? id, route: options.route ?? `/${id}`, body: list(options.body) });
export const dialog = (id: string, options: { title?: string; body: HmiNode | readonly HmiNode[] }): HmiDialog =>
  ({ kind: 'dialog', id: checkId(id, 'dialog'), title: options.title ?? id, body: list(options.body) });
export const hmi = (id: string, options: { initial: string | HmiScreen; screens: readonly HmiScreen[]; dialogs?: readonly HmiDialog[] }): HmiApplication => {
  const app: HmiApplication = { version: 1, id: checkId(id, 'hmi'), initial: typeof options.initial === 'string' ? options.initial : options.initial.id, screens: options.screens, dialogs: options.dialogs ?? [] };
  validateHmi(app);
  return app;
};

const targetId = (target: string | HmiScreen) => typeof target === 'string' ? target : target.id;
export const navigate = (target: string | HmiScreen, params?: Readonly<Record<string, HmiRouteParam>>, replace = false): HmiAction =>
  ({ type: 'navigate', screen: targetId(target), ...(params ? { params } : {}), ...(replace ? { replace: true } : {}) });
export const back = (): HmiAction => ({ type: 'back' });
export const command = (equipmentId: string, name: string, value?: HmiValue<Exclude<HmiPrimitive, null>>): HmiAction =>
  ({ type: 'command', equipmentId: checkId(equipmentId, 'equipment'), command: checkId(name, 'command'), ...(value === undefined ? {} : { value }) });
export const operate = (control: string, value: HmiValue<number>): HmiAction =>
  ({ type: 'operate', control: checkId(control, 'control'), value });
export const write = (signal: string, value: HmiValue<Exclude<HmiPrimitive, null>>): HmiAction =>
  ({ type: 'write', signal: checkId(signal, 'signal'), value });
export const toggle = (signal: string): HmiAction => ({ type: 'toggle', signal: checkId(signal, 'signal') });
export const open = (target: string | HmiDialog): HmiAction => ({ type: 'open', dialog: typeof target === 'string' ? target : target.id });
export const close = (): HmiAction => ({ type: 'close' });
export const ack = (alarm?: string): HmiAction => ({ type: 'ack', ...(alarm ? { alarm: checkId(alarm, 'alarm') } : {}) });
export const sequence = (...actions: readonly HmiAction[]): HmiAction => ({ type: 'sequence', actions });
export const confirm = (message: string, then: HmiAction): HmiAction => ({ type: 'confirm', message, then });
export const script = (id: string): HmiAction => ({ type: 'script', id: checkId(id, 'script') });

const splitPath = (value: string) => value.split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
const segments = (value: string) => splitPath(value).split('/').filter(Boolean);
const routeParams = (route: string) => segments(route).filter(x => x.startsWith(':')).map(x => x.slice(1));

export function pathFor(screen: HmiScreen, params: Readonly<Record<string, HmiRouteParam>> = {}): string {
  return '/' + segments(screen.route).map(part => {
    if (!part.startsWith(':')) return encodeURIComponent(part);
    const key = part.slice(1), value = params[key];
    if (value === undefined) throw new Error(`Missing route parameter: ${key}`);
    return encodeURIComponent(String(value));
  }).join('/');
}
export function matchPath(app: HmiApplication, path: string): { screen: HmiScreen; params: Record<string, string> } | null {
  const actual = segments(path);
  for (const screen of app.screens) {
    const pattern = segments(screen.route);
    if (pattern.length !== actual.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i].startsWith(':')) params[pattern[i].slice(1)] = decodeURIComponent(actual[i]);
      else if (decodeURIComponent(actual[i]) !== pattern[i]) { ok = false; break; }
    }
    if (ok) return { screen, params };
  }
  return null;
}

function walkAction(action: HmiAction, screens: Set<string>, dialogs: Set<string>): void {
  if (action.type === 'navigate' && !screens.has(action.screen)) throw new Error(`Unknown HMI screen: ${action.screen}`);
  if (action.type === 'open' && !dialogs.has(action.dialog)) throw new Error(`Unknown HMI dialog: ${action.dialog}`);
  if (action.type === 'sequence') for (const nested of action.actions) walkAction(nested, screens, dialogs);
  if (action.type === 'confirm') walkAction(action.then, screens, dialogs);
}
export function hmiActions(app: HmiApplication): HmiAction[] {
  const result: HmiAction[] = [];
  const collectAction = (action: HmiAction): void => {
    result.push(action);
    if (action.type === 'sequence') for (const nested of action.actions) collectAction(nested);
    if (action.type === 'confirm') collectAction(action.then);
  };
  const collectNode = (node: HmiNode): void => {
    if (node.type === 'group') for (const child of node.children) collectNode(child);
    if (node.type === 'button') collectAction(node.action);
  };
  for (const item of app.screens) for (const node of item.body) collectNode(node);
  for (const item of app.dialogs) for (const node of item.body) collectNode(node);
  return result;
}

function walkNode(node: HmiNode, screens: Set<string>, dialogs: Set<string>, ids: Set<string>): void {
  if (ids.has(node.id)) throw new Error(`Duplicate HMI node id: ${node.id}`);
  ids.add(node.id);
  if (node.type === 'group') for (const child of node.children) walkNode(child, screens, dialogs, ids);
  if (node.type === 'button') walkAction(node.action, screens, dialogs);
}
export function validateHmi(app: HmiApplication): void {
  checkId(app.id, 'hmi');
  const screens = new Set<string>(), routes = new Set<string>(), dialogs = new Set<string>();
  for (const item of app.screens) {
    checkId(item.id, 'screen');
    if (!item.route.startsWith('/')) throw new Error(`Screen route must start with /: ${item.route}`);
    for (const param of routeParams(item.route)) checkId(param, 'route parameter');
    if (screens.has(item.id)) throw new Error(`Duplicate HMI screen: ${item.id}`);
    if (routes.has(item.route)) throw new Error(`Duplicate HMI route: ${item.route}`);
    screens.add(item.id); routes.add(item.route);
  }
  for (const item of app.dialogs) {
    checkId(item.id, 'dialog');
    if (dialogs.has(item.id)) throw new Error(`Duplicate HMI dialog: ${item.id}`);
    dialogs.add(item.id);
  }
  if (!screens.has(app.initial)) throw new Error(`Unknown initial HMI screen: ${app.initial}`);
  const ids = new Set<string>();
  for (const item of app.screens) for (const node of item.body) walkNode(node, screens, dialogs, ids);
  for (const item of app.dialogs) for (const node of item.body) walkNode(node, screens, dialogs, ids);
}

const isSignalRef = (value: unknown): value is HmiSignalRef =>
  !!value && typeof value === 'object' && (value as HmiSignalRef).kind === 'signal' && typeof (value as HmiSignalRef).path === 'string';

export class HmiRuntime {
  private state: HmiSnapshot;
  private listeners = new Set<() => void>();
  private localHistory: { screen: string; params: Record<string, string> }[] = [];
  private navigationStop?: () => void;
  private commandSeq = 0;
  constructor(public readonly app: HmiApplication, private readonly environment: HmiEnvironment = {}, private readonly navigation?: HmiNavigation) {
    validateHmi(app);
    const initial = app.screens.find(item => item.id === app.initial)!;
    const fromLocation = navigation?.current ? matchPath(app, navigation.current()) : null;
    const selected = fromLocation ?? { screen: initial, params: {} };
    this.state = { screen: selected.screen.id, params: selected.params, dialogs: [], signals: {}, revision: 0 };
    this.localHistory.push({ screen: this.state.screen, params: { ...this.state.params } });
    this.navigationStop = navigation?.subscribe?.(path => this.syncPath(path));
  }
  dispose(): void { this.navigationStop?.(); this.navigationStop = undefined; this.listeners.clear(); }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  snapshot = (): HmiSnapshot => this.state;
  currentScreen(): HmiScreen { return this.app.screens.find(item => item.id === this.state.screen)!; }
  currentDialogs(): readonly HmiDialog[] {
    const byId = new Map(this.app.dialogs.map(item => [item.id, item]));
    return this.state.dialogs.map(id => byId.get(id)).filter((value): value is HmiDialog => !!value);
  }
  resolve<T extends HmiPrimitive>(value: HmiValue<T>): T | null {
    if (!isSignalRef(value)) return value as T;
    const current = this.state.signals[value.path];
    return (current === undefined ? value.fallback ?? null : current) as T | null;
  }
  updateSignals(signals: Readonly<Record<string, HmiPrimitive>>): void {
    let changed = false;
    const next = { ...this.state.signals };
    for (const [key, value] of Object.entries(signals)) {
      checkId(key, 'signal');
      if (next[key] !== value) { next[key] = value; changed = true; }
    }
    if (changed) this.update({ signals: next });
  }
  syncPath(path: string): boolean {
    const matched = matchPath(this.app, path);
    if (!matched) return false;
    if (this.state.screen === matched.screen.id && JSON.stringify(this.state.params) === JSON.stringify(matched.params)) return true;
    this.localHistory.push({ screen: matched.screen.id, params: matched.params });
    this.update({ screen: matched.screen.id, params: matched.params, dialogs: [] });
    return true;
  }
  go(target: string | HmiScreen, params: Readonly<Record<string, HmiRouteParam>> = {}, replace = false): void {
    const id = targetId(target), screen = this.app.screens.find(item => item.id === id);
    if (!screen) throw new Error(`Unknown HMI screen: ${id}`);
    const route = pathFor(screen, params);
    const normalizedParams = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)]));
    if (replace) this.localHistory[this.localHistory.length - 1] = { screen: id, params: normalizedParams };
    else this.localHistory.push({ screen: id, params: normalizedParams });
    this.update({ screen: id, params: normalizedParams, dialogs: [] });
    if (replace) this.navigation?.replace(route); else this.navigation?.push(route);
  }
  private update(patch: Partial<Omit<HmiSnapshot, 'revision'>>): void {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    for (const listener of this.listeners) listener();
  }
  private nextCommandId(): string {
    const supplied = this.environment.commandId?.();
    if (supplied) return supplied;
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `hmi-${Date.now().toString(36)}-${++this.commandSeq}`;
  }
  async dispatch(action: HmiAction): Promise<void> {
    switch (action.type) {
      case 'navigate': this.go(action.screen, action.params ?? {}, action.replace ?? false); return;
      case 'back': {
        if (this.navigation?.back) { this.navigation.back(); return; }
        if (this.localHistory.length <= 1) return;
        this.localHistory.pop();
        const previous = this.localHistory[this.localHistory.length - 1];
        this.update({ screen: previous.screen, params: previous.params, dialogs: [] });
        return;
      }
      case 'command': {
        if (!this.environment.command) throw new Error('HMI command adapter is not configured');
        const value = action.value === undefined ? undefined : this.resolve(action.value);
        if (value === null) throw new Error(`Command value is unavailable: ${action.equipmentId}.${action.command}`);
        const payload: EquipmentCommand = { commandId: this.nextCommandId(), equipmentId: action.equipmentId, command: action.command, ...(value === undefined ? {} : { value }) };
        await this.environment.command(payload); return;
      }
      case 'operate': {
        if (!this.environment.operate) throw new Error('HMI operate adapter is not configured');
        const value = this.resolve(action.value);
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Control value is unavailable: ${action.control}`);
        await this.environment.operate(action.control, value); return;
      }
      case 'write': {
        if (!this.environment.write) throw new Error('HMI write adapter is not configured');
        const value = this.resolve(action.value);
        if (value === null) throw new Error(`Signal value is unavailable: ${action.signal}`);
        await this.environment.write(action.signal, value); return;
      }
      case 'toggle': {
        if (!this.environment.write) throw new Error('HMI write adapter is not configured');
        const value = this.state.signals[action.signal];
        if (typeof value !== 'boolean') throw new Error(`Toggle requires a boolean signal: ${action.signal}`);
        await this.environment.write(action.signal, !value); return;
      }
      case 'open':
        if (!this.app.dialogs.some(item => item.id === action.dialog)) throw new Error(`Unknown HMI dialog: ${action.dialog}`);
        this.update({ dialogs: [...this.state.dialogs, action.dialog] }); return;
      case 'close':
        if (this.state.dialogs.length) this.update({ dialogs: this.state.dialogs.slice(0, -1) });
        return;
      case 'ack':
        if (!this.environment.ack) throw new Error('HMI alarm adapter is not configured');
        await this.environment.ack(action.alarm); return;
      case 'sequence':
        for (const nested of action.actions) await this.dispatch(nested);
        return;
      case 'confirm':
        if (!this.environment.confirm) throw new Error('HMI confirm adapter is not configured');
        if (await this.environment.confirm(action.message)) await this.dispatch(action.then);
        return;
      case 'script':
        if (!this.environment.script) throw new Error(`HMI script adapter is not configured: ${action.id}`);
        await this.environment.script(action.id, this); return;
    }
  }
}

const trimBase = (base: string) => base === '/' ? '' : ('/' + base.split('/').filter(Boolean).join('/'));
export function browserNavigation(base = ''): HmiNavigation {
  if (typeof window === 'undefined') throw new Error('Browser navigation requires window');
  const prefix = trimBase(base);
  const current = () => {
    const path = window.location.pathname;
    return prefix && path.startsWith(prefix) ? path.slice(prefix.length) || '/' : path;
  };
  const url = (path: string) => (prefix + (path.startsWith('/') ? path : '/' + path)) || '/';
  return {
    current,
    push: path => window.history.pushState(null, '', url(path)),
    replace: path => window.history.replaceState(null, '', url(path)),
    back: () => window.history.back(),
    subscribe: listener => {
      const handler = () => listener(current());
      window.addEventListener('popstate', handler);
      return () => window.removeEventListener('popstate', handler);
    },
  };
}


export function hashNavigation(prefix = 'hmi'): HmiNavigation {
  if (typeof window === 'undefined') throw new Error('Hash navigation requires window');
  const marker = '#' + prefix.replace(/^#/, '').replace(/\/$/, '');
  const current = () => {
    const hash = window.location.hash;
    if (!hash.startsWith(marker)) return '/';
    const value = hash.slice(marker.length);
    return value.startsWith('/') ? value : value ? '/' + value : '/';
  };
  const url = (path: string) => marker + (path.startsWith('/') ? path : '/' + path);
  return {
    current,
    push: path => { window.history.pushState(null, '', url(path)); window.dispatchEvent(new HashChangeEvent('hashchange')); },
    replace: path => { window.history.replaceState(null, '', url(path)); window.dispatchEvent(new HashChangeEvent('hashchange')); },
    back: () => window.history.back(),
    subscribe: listener => {
      const handler = () => listener(current());
      window.addEventListener('hashchange', handler);
      window.addEventListener('popstate', handler);
      return () => { window.removeEventListener('hashchange', handler); window.removeEventListener('popstate', handler); };
    },
  };
}
