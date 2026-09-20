const fs = require('node:fs');
const path = require('node:path');

function buildCatalog(document) {
  if (!document || document.schema !== 1 || !Array.isArray(document.catalogs)) return [];
  return document.catalogs
    .filter(group => group && typeof group.id === 'string' && typeof group.title === 'string' && Array.isArray(group.items))
    .map(group => ({
      id: group.id,
      title: group.title,
      source: typeof group.source === 'string' ? group.source : group.id,
      items: group.items
        .filter(item => item && typeof item.type === 'string' && typeof item.title === 'string')
        .map(item => ({
          type: item.type,
          title: item.title,
          source: typeof item.source === 'string' ? item.source : group.id,
          tag: typeof item.tag === 'string' ? item.tag : '',
        })),
    }))
    .filter(group => group.items.length);
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
  buildCatalog,
  quoteArg,
  readTargets,
  targetCommand,
};
