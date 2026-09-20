const vscode = require('vscode');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const {
  buildCatalog,
  quoteArg,
  readTargets,
  targetCommand,
} = require('./lib/model.cjs');

const execFileAsync = promisify(execFile);

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

function config() {
  return vscode.workspace.getConfiguration('saturn');
}

function cliPath() {
  return config().get('cli.path', 'saturn');
}

function serverOrigin() {
  const host = config().get('server.host', '127.0.0.1');
  const port = config().get('server.port', 4176);
  return `http://${host}:${port}`;
}

async function runCliJson(args) {
  const cwd = workspaceRoot() ?? undefined;
  const { stdout } = await execFileAsync(cliPath(), args, {
    cwd,
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

class RefreshableTree {
  constructor() {
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }
  refresh() { this._emitter.fire(undefined); }
  dispose() { this._emitter.dispose(); }
}

class ProjectTreeProvider extends RefreshableTree {
  getTreeItem(item) { return item; }
  async getChildren(element) {
    const root = workspaceRoot();
    if (!root) {
      const item = new vscode.TreeItem('Open a folder to use Saturn');
      item.iconPath = new vscode.ThemeIcon('folder-opened');
      return [item];
    }
    if (element) return [];

    const entry = config().get('project.entry', 'plant.ts');
    const source = new vscode.TreeItem(entry);
    source.description = 'project source';
    source.iconPath = new vscode.ThemeIcon('code');
    source.command = {
      command: 'vscode.open',
      title: 'Open Saturn entry',
      arguments: [vscode.Uri.file(path.join(root, entry))],
    };

    const diagram = new vscode.TreeItem('Diagram');
    diagram.iconPath = new vscode.ThemeIcon('graph');
    diagram.command = { command: 'saturn.openDiagram', title: 'Open diagram' };

    const runtime = new vscode.TreeItem('Local runtime');
    runtime.description = serverOrigin();
    runtime.iconPath = new vscode.ThemeIcon('server-process');
    runtime.command = { command: 'saturn.runServer', title: 'Run Saturn server' };

    const hmi = new vscode.TreeItem('Operator HMI');
    hmi.iconPath = new vscode.ThemeIcon('preview');
    hmi.command = { command: 'saturn.openHmi', title: 'Open HMI' };

    return [source, diagram, runtime, hmi];
  }
}

class CatalogTreeProvider extends RefreshableTree {
  constructor() {
    super();
    this.catalog = [];
    this.error = null;
  }

  async reload() {
    try {
      let extensions = [];
      try {
        extensions = await runCliJson(['extension', 'list', '--json']);
      } catch (error) {
        extensions = [];
      }
      this.catalog = buildCatalog(extensions);
      this.error = null;
    } catch (error) {
      this.catalog = [];
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.refresh();
  }

  getTreeItem(item) { return item; }

  async getChildren(element) {
    if (!this.catalog.length && !this.error) await this.reload();
    if (this.error && !element) {
      const problem = new vscode.TreeItem('Catalog unavailable');
      problem.description = this.error;
      problem.iconPath = new vscode.ThemeIcon('warning');
      return [problem];
    }
    if (!element) {
      return this.catalog.map(group => {
        const item = new vscode.TreeItem(group.title, vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = 'saturnCatalog';
        item.description = group.source;
        item.iconPath = new vscode.ThemeIcon(group.id === 'core' ? 'library' : 'extensions');
        item._saturnGroup = group;
        return item;
      });
    }
    if (element._saturnGroup) {
      return element._saturnGroup.items.map(equipment => {
        const item = new vscode.TreeItem(equipment.title);
        item.contextValue = 'saturnEquipment';
        item.description = equipment.type;
        item.tooltip = `${equipment.title}\n${equipment.type}\n${equipment.source}`;
        item.iconPath = new vscode.ThemeIcon('symbol-structure');
        item.command = {
          command: 'saturn.insertEquipment',
          title: 'Insert equipment',
          arguments: [equipment],
        };
        item._saturnEquipment = equipment;
        return item;
      });
    }
    return [];
  }
}

class TargetsTreeProvider extends RefreshableTree {
  constructor() {
    super();
    this.targets = [];
    this.error = null;
  }

  reload() {
    try {
      this.targets = readTargets(workspaceRoot());
      this.error = null;
    } catch (error) {
      this.targets = [];
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.refresh();
  }

  getTreeItem(item) { return item; }

  async getChildren(element) {
    if (!this.targets.length && !this.error) this.reload();
    if (element) return [];
    if (this.error) {
      const problem = new vscode.TreeItem('Invalid targets');
      problem.description = this.error;
      problem.iconPath = new vscode.ThemeIcon('error');
      return [problem];
    }
    return this.targets.map(target => {
      const item = new vscode.TreeItem(target.title);
      item.contextValue = 'saturnTarget';
      item.description = `${target.kind} · ${target.provider}`;
      item.tooltip = target.endpoint
        ? `${target.title}\n${target.endpoint}\nActions: ${target.actions.join(', ') || 'none'}`
        : `${target.title}\nActions: ${target.actions.join(', ') || 'none'}`;
      item.iconPath = new vscode.ThemeIcon(
        target.kind === 'controller' ? 'circuit-board' :
        target.kind === 'server' ? 'server' :
        target.kind === 'hmi' ? 'device-mobile' : 'device-desktop'
      );
      item.command = {
        command: 'saturn.openTarget',
        title: 'Open target',
        arguments: [target],
      };
      item._saturnTarget = target;
      return item;
    });
  }
}

class SaturnTerminal {
  constructor(statusBar) {
    this.terminal = null;
    this.statusBar = statusBar;
  }

  runServer() {
    const root = workspaceRoot();
    if (!root) return vscode.window.showWarningMessage('Open a Saturn project folder first.');
    if (this.terminal) {
      this.terminal.show();
      return;
    }
    const host = config().get('server.host', '127.0.0.1');
    const port = config().get('server.port', 4176);
    this.terminal = vscode.window.createTerminal({
      name: 'Saturn',
      cwd: root,
      env: { HOST: host, PORT: String(port) },
    });
    const command = [
      quoteArg(cliPath()),
      'open',
      quoteArg(root),
    ].join(' ');
    this.terminal.sendText(command, true);
    this.terminal.show();
    this.statusBar.text = '$(radio-tower) Saturn: starting';
    this.statusBar.tooltip = serverOrigin();
    this.statusBar.show();
    setTimeout(() => {
      if (this.terminal) this.statusBar.text = '$(radio-tower) Saturn: local';
    }, 1200);
  }

  stop() {
    this.terminal?.dispose();
    this.terminal = null;
    this.statusBar.text = '$(circle-slash) Saturn: stopped';
    this.statusBar.show();
  }

  execute(command) {
    const root = workspaceRoot();
    if (!root) return vscode.window.showWarningMessage('Open a Saturn project folder first.');
    const terminal = vscode.window.createTerminal({ name: 'Saturn target', cwd: root });
    terminal.sendText(command, true);
    terminal.show();
  }

  handleClosed(terminal) {
    if (this.terminal === terminal) {
      this.terminal = null;
      this.statusBar.text = '$(circle-slash) Saturn: stopped';
    }
  }

  dispose() { this.stop(); }
}

function diagramHtml(origin) {
  const app = `${origin}/plant/app/`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src http://127.0.0.1:* http://localhost:* https:;">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{height:100%;margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font:13px var(--vscode-font-family)}
main{height:100%;display:grid;grid-template-rows:36px 1fr}
header{display:flex;align-items:center;gap:10px;padding:0 10px;border-bottom:1px solid var(--vscode-panel-border)}
header strong{font-weight:600} header span{opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
iframe{width:100%;height:100%;border:0;background:white}
</style>
</head>
<body>
<main>
<header><strong>Saturn Diagram</strong><span>${app}</span></header>
<iframe src="${app}" title="Saturn engineering view"></iframe>
</main>
</body>
</html>`;
}

async function insertEquipment(equipment) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.window.showWarningMessage('Open a TypeScript project file first.');
    return;
  }
  const id = await vscode.window.showInputBox({
    title: `Add ${equipment.title}`,
    prompt: 'Equipment ID',
    value: equipment.type.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 8) + '-101',
    validateInput: value => /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? null : 'Use letters, digits, _, . or -',
  });
  if (!id) return;
  const type = JSON.stringify(equipment.type);
  const snippet = `\nconst ${id.replace(/[^A-Za-z0-9_$]/g, '_')} = simulation(${JSON.stringify(id)}, ${type}, {\n  at: { x: 0, y: 0 },\n});\n`;
  await editor.edit(builder => builder.insert(editor.selection.active, snippet));
}

async function chooseTarget(provider, action, kind) {
  provider.reload();
  const candidates = provider.targets.filter(target =>
    (!kind || target.kind === kind) && target.actions.includes(action)
  );
  if (!candidates.length) {
    await vscode.window.showInformationMessage(
      action === 'flash'
        ? 'No controller target advertises flash. Install/configure a Saturn target provider first.'
        : 'No Saturn target advertises this deployment action.'
    );
    return null;
  }
  if (candidates.length === 1) return candidates[0];
  const picked = await vscode.window.showQuickPick(
    candidates.map(target => ({ label: target.title, description: `${target.kind} · ${target.provider}`, target })),
    { title: `Saturn: ${action}` }
  );
  return picked?.target ?? null;
}

function activate(context) {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  statusBar.command = 'saturn.openDiagram';
  statusBar.text = '$(circle-slash) Saturn: stopped';
  statusBar.tooltip = 'Open Saturn diagram';
  statusBar.show();

  const terminal = new SaturnTerminal(statusBar);
  const project = new ProjectTreeProvider();
  const catalog = new CatalogTreeProvider();
  const targets = new TargetsTreeProvider();

  context.subscriptions.push(
    statusBar,
    terminal,
    project,
    catalog,
    targets,
    vscode.window.registerTreeDataProvider('saturn.project', project),
    vscode.window.registerTreeDataProvider('saturn.catalog', catalog),
    vscode.window.registerTreeDataProvider('saturn.targets', targets),
    vscode.window.onDidCloseTerminal(value => terminal.handleClosed(value)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      project.refresh();
      void catalog.reload();
      targets.reload();
    }),
    vscode.workspace.onDidSaveTextDocument(document => {
      if (document.fileName.endsWith('.ts')) project.refresh();
      if (document.fileName.endsWith(path.join('.saturn', 'targets.json'))) targets.reload();
    }),
    vscode.commands.registerCommand('saturn.refresh', async () => {
      project.refresh();
      await catalog.reload();
      targets.reload();
    }),
    vscode.commands.registerCommand('saturn.runServer', () => terminal.runServer()),
    vscode.commands.registerCommand('saturn.stopServer', () => terminal.stop()),
    vscode.commands.registerCommand('saturn.openDiagram', () => {
      const panel = vscode.window.createWebviewPanel(
        'saturn.diagram',
        'Saturn Diagram',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true, enableForms: false }
      );
      panel.webview.html = diagramHtml(serverOrigin());
    }),
    vscode.commands.registerCommand('saturn.openHmi', async () => {
      const uri = vscode.Uri.parse(`${serverOrigin()}/plant/app/`);
      await vscode.env.openExternal(uri);
    }),
    vscode.commands.registerCommand('saturn.insertEquipment', equipment => insertEquipment(equipment?._saturnEquipment ?? equipment)),
    vscode.commands.registerCommand('saturn.openTarget', async targetOrItem => {
      const target = targetOrItem?._saturnTarget ?? targetOrItem;
      if (!target) return;
      if (target.local) {
        terminal.runServer();
        return;
      }
      if (target.endpoint) {
        await vscode.env.openExternal(vscode.Uri.parse(target.endpoint));
        return;
      }
      const action = target.actions.includes('monitor') ? 'monitor' : target.actions.includes('logs') ? 'logs' : null;
      if (!action) {
        await vscode.window.showInformationMessage(`${target.title}: no open/monitor action is available.`);
        return;
      }
      terminal.execute(targetCommand(cliPath(), action, target, workspaceRoot()));
    }),
    vscode.commands.registerCommand('saturn.deployTarget', async () => {
      const target = await chooseTarget(targets, 'deploy', 'server');
      if (target) terminal.execute(targetCommand(cliPath(), 'deploy', target, workspaceRoot()));
    }),
    vscode.commands.registerCommand('saturn.flashController', async () => {
      const target = await chooseTarget(targets, 'flash', 'controller');
      if (target) terminal.execute(targetCommand(cliPath(), 'flash', target, workspaceRoot()));
    }),
  );

  void catalog.reload();
  targets.reload();
}

function deactivate() {}

module.exports = { activate, deactivate };
