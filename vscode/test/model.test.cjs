const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildCatalog,
  quoteArg,
  readTargets,
  targetCommand,
} = require('../lib/model.cjs');

test('canonical CLI catalog keeps core and plugin groups without host-owned model names', () => {
  const catalog = buildCatalog({
    schema: 1,
    catalogs: [
      {
        id: 'core',
        title: 'Saturn Core',
        source: '@saturn/core',
        items: [{ type: 'heat-exchanger', title: 'Конденсатор', source: '@saturn/core' }],
      },
      {
        id: '@factory/motors',
        title: '@factory/motors',
        source: '@factory/motors@1.2.3',
        items: [{ type: 'factory.motor.ie4', title: 'IE4 Motor', tag: 'factory-motor', source: '@factory/motors' }],
      },
    ],
  });
  assert.equal(catalog[0].items[0].type, 'heat-exchanger');
  assert.equal(catalog[1].id, '@factory/motors');
  assert.equal(catalog[1].items[0].tag, 'factory-motor');
});

test('targets file is declarative and keeps provider/action identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saturn-vscode-'));
  fs.mkdirSync(path.join(root, '.saturn'));
  fs.writeFileSync(path.join(root, '.saturn', 'targets.json'), JSON.stringify({
    schema: 1,
    targets: [
      {
        id: 'operator-a',
        title: 'Operator A',
        kind: 'server',
        provider: '@factory/docker',
        endpoint: 'https://operator.example.test',
        actions: ['deploy', 'logs'],
      },
      {
        id: 'plc-01',
        title: 'Saturn PLC 01',
        kind: 'controller',
        provider: '@saturn/plc',
        actions: ['flash', 'monitor'],
      },
    ],
  }));
  try {
    const targets = readTargets(root);
    assert.equal(targets[0].id, 'local-runtime');
    assert.equal(targets[1].id, 'operator-a');
    assert.deepEqual(targets[2].actions, ['flash', 'monitor']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('project cannot smuggle arbitrary target actions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saturn-vscode-'));
  fs.mkdirSync(path.join(root, '.saturn'));
  fs.writeFileSync(path.join(root, '.saturn', 'targets.json'), JSON.stringify({
    schema: 1,
    targets: [{
      id: 'plc',
      title: 'PLC',
      kind: 'controller',
      provider: '@saturn/plc',
      actions: ['flash', 'rm -rf /'],
    }],
  }));
  try {
    const targets = readTargets(root);
    assert.deepEqual(targets[1].actions, ['flash']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('target commands are assembled from fixed Saturn verbs', () => {
  assert.equal(
    targetCommand('saturn', 'flash', { id: 'plc-01' }, '/work/plant', 'linux'),
    'saturn target flash plc-01 --project /work/plant'
  );
  assert.equal(quoteArg('/Program Files/Saturn/saturn.exe', 'win32'), '"/Program Files/Saturn/saturn.exe"');
});
