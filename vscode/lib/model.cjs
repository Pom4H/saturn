const fs = require('node:fs');
const path = require('node:path');

const CORE_EQUIPMENT = [
  ['pump', 'Pump'],
  ['tank', 'Tank'],
  ['valve', 'Valve'],
  ['flowmeter', 'Flow meter'],
  ['heat-exchanger', 'Heat exchanger'],
  ['pressure-gauge', 'Pressure gauge'],
  ['temperature-sensor', 'Temperature sensor'],
  ['filter', 'Filter'],
];

function normalizeExtensionList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item.name === 'string' && typeof item.version === 'string')
    .map(item => ({
      name: item.name,
      version: item.version,
      capabilities: Array.isArray(item.capabilities) ? item.capabilities.filter(x => typeof x === 'string') : [],
      elements: Array.isArray(item.elements)
        ? item.elements
            .filter(element => element && typeof element.type === 'string' && typeof element.title === 'string')
            .map(element => ({
              type: element.type,
              title: element.title,
              tag: typeof element.tag === 'string' ? element.tag : '',
            }))
        : [],
    }));
}

function buildCatalog(extensionList) {
  const groups = [{
    id: 'core',
    title: 'Saturn Core',
    source: '@saturn/core',
    items: CORE_EQUIPMENT.map(([type, title]) => ({ type, title, source: '@saturn/core' })),
  }];

  for (const extension of normalizeExtensionList(extensionList)) {
    if (!extension.elements.length) continue;
    groups.push({
      id: extension.name,
      title: extension.name,
      source: `${extension.name}@${extension.version}`,
      items: extension.elements.map(element => ({
        type: element.type,
        title: element.title,
        tag: element.tag,
        source: extension.name,
      })),
    });
  }
  return groups;
}

function readTargets(workspace) {
  const result = [{
    id: 'local-runtime',
    title: 'Local Saturn',
    kind: 'server',
    provider: '@saturn/scada',
    actions: ['run', 'open'],
    local: true,
  }];
  if (!workspace) return result;
  const file = path.join(workspace, '.saturn', 'targets.json');
  if (!fs.existsSync(file)) return result;

  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || parsed.schema !== 1 || !Array.isArray(parsed.targets))
    throw new Error('.saturn/targets.json must use schema 1');

  const ids = new Set(result.map(item => item.id));
  for (const target of parsed.targets) {
    if (!target || typeof target.id !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(target.id))
      throw new Error('Invalid Saturn target id');
    if (ids.has(target.id)) throw new Error(`Duplicate Saturn target: ${target.id}`);
    if (!['server', 'controller', 'hmi', 'device'].includes(target.kind))
      throw new Error(`Unsupported Saturn target kind: ${target.kind}`);
    if (typeof target.title !== 'string' || !target.title.trim())
      throw new Error(`Target ${target.id} requires a title`);
    if (typeof target.provider !== 'string' || !target.provider.trim())
      throw new Error(`Target ${target.id} requires a provider`);
    const actions = Array.isArray(target.actions)
      ? [...new Set(target.actions.filter(action => ['deploy', 'flash', 'open', 'logs', 'monitor'].includes(action)))]
      : [];
    ids.add(target.id);
    result.push({
      id: target.id,
      title: target.title,
      kind: target.kind,
      provider: target.provider,
      actions,
      endpoint: typeof target.endpoint === 'string' ? target.endpoint : undefined,
    });
  }
  return result;
}

function quoteArg(value, platform = process.platform) {
  const string = String(value);
  if (platform === 'win32') {
    if (!/[\s"&|<>^]/.test(string)) return string;
    return '"' + string.replace(/"/g, '""') + '"';
  }
  if (!/[\s'"\\$&|;<>()[\]{}*?!]/.test(string)) return string;
  return "'" + string.replace(/'/g, "'\\''") + "'";
}

function targetCommand(cli, action, target, workspace, platform = process.platform) {
  return [
    quoteArg(cli, platform),
    'target',
    quoteArg(action, platform),
    quoteArg(target.id, platform),
    '--project',
    quoteArg(workspace, platform),
  ].join(' ');
}

module.exports = {
  CORE_EQUIPMENT,
  buildCatalog,
  normalizeExtensionList,
  quoteArg,
  readTargets,
  targetCommand,
};
