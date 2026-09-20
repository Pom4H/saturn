import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HmiRuntime, ack, back, bind, button, close, command, confirm, dialog, hmi, navigate, open,
  readout, screen, sequence, text, toggle, write, matchPath, pathFor,
} from '../src/hmi';
import { createReactHmiRenderer } from '../src/hmi-react';

const stopDialog = dialog('stopDialog', {
  title: 'Stop P101?',
  body: [
    text('stopPrompt', 'Stop pump P101?'),
    button('cancelStop', 'Cancel', close()),
    button('confirmStop', 'Stop', command('P101', 'stop')),
  ],
});
const mainScreen = screen('main', {
  title: 'Plant',
  route: '/',
  body: [
    text('mainTitle', 'Pumping station', { as: 'h1' }),
    button('openPump', 'P101', navigate('pump', { id: 'P101' })),
  ],
});
const pumpScreen = screen('pump', {
  title: 'Pump',
  route: '/pump/:id',
  body: [
    readout('pumpCurrent', bind('P101.current'), { unit: 'A', digits: 1 }),
    button('pumpStart', 'Start', command('P101', 'start')),
    button('pumpStop', 'Stop', open(stopDialog)),
    button('pumpToggle', 'Auto', toggle('P101.auto')),
    button('pumpWrite', 'Set 24 A', write('P101.currentSetpoint', 24)),
    button('pumpAck', 'Acknowledge', ack('P101.fault')),
    button('pumpBack', 'Back', back()),
  ],
});
const app = hmi('station', { initial: mainScreen, screens: [mainScreen, pumpScreen], dialogs: [stopDialog] });

test('routes are derived from typed screens and deep links resolve back to screens', () => {
  assert.equal(pathFor(pumpScreen, { id: 'P101' }), '/pump/P101');
  assert.deepEqual(matchPath(app, '/pump/P202?tab=trend'), { screen: pumpScreen, params: { id: 'P202' } });
  assert.equal(matchPath(app, '/missing'), null);
});

test('navigation, dialogs and back are runtime state, not component callbacks', async () => {
  const runtime = new HmiRuntime(app);
  assert.equal(runtime.snapshot().screen, 'main');
  await runtime.dispatch(navigate(pumpScreen, { id: 'P101' }));
  assert.equal(runtime.snapshot().screen, 'pump');
  assert.equal(runtime.snapshot().params.id, 'P101');
  await runtime.dispatch(open(stopDialog));
  assert.deepEqual(runtime.snapshot().dialogs, ['stopDialog']);
  await runtime.dispatch(close());
  assert.deepEqual(runtime.snapshot().dialogs, []);
  await runtime.dispatch(back());
  assert.equal(runtime.snapshot().screen, 'main');
});

test('operator actions cross an explicit adapter boundary', async () => {
  const commands: unknown[] = [], writes: unknown[] = [], acknowledgements: unknown[] = [], scripts: string[] = [];
  let ids = 0;
  const runtime = new HmiRuntime(app, {
    commandId: () => `cmd-${++ids}`,
    command: value => { commands.push(value); },
    write: (signal, value) => { writes.push([signal, value]); },
    ack: alarm => { acknowledgements.push(alarm); },
    confirm: async () => true,
    script: id => { scripts.push(id); },
  });
  runtime.updateSignals({ 'P101.auto': false, 'P101.current': 18.44 });
  await runtime.dispatch(sequence(
    confirm('Start?', command('P101', 'start')),
    toggle('P101.auto'),
    write('P101.currentSetpoint', bind('P101.current')),
    ack('P101.fault'),
    { type: 'script', id: 'openDiagnostics' },
  ));
  assert.deepEqual(commands, [{ commandId: 'cmd-1', equipmentId: 'P101', command: 'start' }]);
  assert.deepEqual(writes, [['P101.auto', true], ['P101.currentSetpoint', 18.44]]);
  assert.deepEqual(acknowledgements, ['P101.fault']);
  assert.deepEqual(scripts, ['openDiagnostics']);
});

test('React renderer is a projection of the same HMI runtime', async () => {
  type Element = { type: unknown; props: Record<string, unknown> | null; children: unknown[] };
  const React = {
    Fragment: 'fragment',
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element { return { type, props, children }; },
    useSyncExternalStore(_subscribe: (listener: () => void) => () => void, getSnapshot: () => ReturnType<HmiRuntime['snapshot']>) { return getSnapshot(); },
  };
  const runtime = new HmiRuntime(app);
  const Renderer = createReactHmiRenderer(React);
  let tree = Renderer({ runtime }) as Element;
  const main = tree.children[0] as Element;
  assert.equal(main.props?.['data-hmi-screen'], 'main');

  await runtime.dispatch(navigate('pump', { id: 'P101' }));
  runtime.updateSignals({ 'P101.current': 31.26 });
  tree = Renderer({ runtime }) as Element;
  const pump = tree.children[0] as Element;
  assert.equal(pump.props?.['data-hmi-screen'], 'pump');
  const output = pump.children[0] as Element;
  assert.equal(output.type, 'output');
  assert.deepEqual(output.children, ['31.3 A']);
});

test('invalid navigation is rejected while building the canonical HMI model', () => {
  const bad = screen('bad', { body: button('badButton', 'Missing', navigate('nowhere')) });
  assert.throws(() => hmi('badApp', { initial: bad, screens: [bad] }), /Unknown HMI screen/);
});
