import type { HmiEquipmentNode, HmiNode, HmiPrimitive, HmiRuntime, HmiSnapshot } from './hmi';

export interface ReactLike {
  Fragment: unknown;
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
  useSyncExternalStore(subscribe: (listener: () => void) => () => void, getSnapshot: () => HmiSnapshot, getServerSnapshot?: () => HmiSnapshot): HmiSnapshot;
}
export interface HmiReactEquipmentProps {
  node: HmiEquipmentNode;
  runtime: HmiRuntime;
  snapshot: HmiSnapshot;
}
export type HmiReactEquipment = (props: HmiReactEquipmentProps) => unknown;
export interface HmiReactProps {
  runtime: HmiRuntime;
  equipment?: Readonly<Record<string, HmiReactEquipment>>;
  className?: string;
}

const textValue = (value: HmiPrimitive): string => value === null ? '—' : String(value);
const formatReadout = (value: HmiPrimitive, digits?: number, unit?: string): string => {
  const formatted = typeof value === 'number' && digits !== undefined ? value.toFixed(digits) : textValue(value);
  return unit ? `${formatted} ${unit}` : formatted;
};

export function createReactHmiRenderer(React: ReactLike) {
  const renderNode = (runtime: HmiRuntime, snapshot: HmiSnapshot, equipment: Readonly<Record<string, HmiReactEquipment>>, node: HmiNode): unknown => {
    const common = { key: node.id, id: node.id, className: node.className, style: node.style, 'data-hmi-node': node.type };
    if (node.type === 'group') {
      const tag = node.as ?? 'div';
      return React.createElement(tag, common, ...node.children.map(child => renderNode(runtime, snapshot, equipment, child)));
    }
    if (node.type === 'text') {
      return React.createElement(node.as ?? 'span', common, textValue(runtime.resolve(node.text)));
    }
    if (node.type === 'readout') {
      return React.createElement('output', common, formatReadout(runtime.resolve(node.value), node.digits, node.unit));
    }
    if (node.type === 'button') {
      const disabled = node.disabledWhen ? Boolean(runtime.resolve(node.disabledWhen)) : false;
      return React.createElement('button', {
        ...common,
        type: 'button',
        disabled,
        onClick: () => { void runtime.dispatch(node.action); },
      }, textValue(runtime.resolve(node.label)));
    }
    const Component = equipment[node.renderer ?? node.equipmentId];
    if (Component) return React.createElement(Component, { key: node.id, node, runtime, snapshot });
    return React.createElement('div', {
      ...common,
      'data-equipment-id': node.equipmentId,
      'data-renderer': node.renderer ?? '',
    }, node.equipmentId);
  };

  function HmiRenderer({ runtime, equipment = {}, className = '' }: HmiReactProps): unknown {
    const snapshot = React.useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot);
    const screen = runtime.currentScreen();
    const body = screen.body.map(node => renderNode(runtime, snapshot, equipment, node));
    const dialogs = runtime.currentDialogs().map(item => React.createElement('dialog', {
      key: item.id,
      open: true,
      'data-hmi-dialog': item.id,
      'aria-label': item.title,
    }, ...item.body.map(node => renderNode(runtime, snapshot, equipment, node))));
    return React.createElement(React.Fragment, null,
      React.createElement('main', {
        className,
        'data-hmi-app': runtime.app.id,
        'data-hmi-screen': screen.id,
        'data-hmi-revision': snapshot.revision,
      }, ...body),
      ...dialogs,
    );
  }

  return HmiRenderer;
}
