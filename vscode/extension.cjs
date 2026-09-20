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
const diagramPanels = new Set();

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
      const document = await runCliJson(['ide', 'catalog', '--json']);
      this.catalog = buildCatalog(document);
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

function diagramHtml(document) {
  const payload = JSON.stringify(document).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{height:100%;margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font:12px var(--vscode-font-family)}
main{height:100%;display:grid;grid-template-rows:36px 1fr;overflow:hidden}
header{display:flex;align-items:center;gap:10px;padding:0 12px;border-bottom:1px solid var(--vscode-panel-border)}
header strong{font-weight:600} header span{opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#viewport{overflow:auto}
svg{display:block;min-width:100%;min-height:100%}
.group{fill:var(--vscode-sideBar-background);stroke:var(--vscode-panel-border);stroke-width:1}
.group-title{fill:var(--vscode-descriptionForeground);font-size:12px;font-weight:600}
.connection{fill:none;stroke:var(--vscode-descriptionForeground);stroke-width:6;stroke-linecap:round;stroke-linejoin:round;opacity:.55}
.node{cursor:pointer}
.node:hover .body{stroke:var(--vscode-focusBorder);stroke-width:2}
.body{fill:var(--vscode-editorWidget-background);stroke:var(--vscode-widget-border);stroke-width:1.2}
.kind{fill:var(--vscode-descriptionForeground);font-size:10px}
.name{fill:var(--vscode-editor-foreground);font-size:12px;font-weight:600}
.icon{fill:none;stroke:var(--vscode-symbolIcon-classForeground,var(--vscode-editor-foreground));stroke-width:2}
.empty{padding:24px;color:var(--vscode-descriptionForeground)}
</style>
</head>
<body>
<main>
<header><strong>Saturn Diagram</strong><span id="title"></span></header>
<div id="viewport"><svg id="scene" xmlns="http://www.w3.org/2000/svg" role="img"></svg></div>
</main>
<script id="data" type="application/json">${payload}</script>
<script>
const vscode = acquireVsCodeApi();
const data = JSON.parse(document.getElementById('data').textContent);
document.getElementById('title').textContent = data.project.title;
const svg = document.getElementById('scene');
const ns = 'http://www.w3.org/2000/svg';
const make=(name,attrs={},text='')=>{const e=document.createElementNS(ns,name);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(text)e.textContent=text;return e};
const nodes=data.scene.nodes||[], groups=data.scene.groups||[], connections=data.scene.connections||[], defs=data.definitions||{};
if(!nodes.length){document.getElementById('viewport').innerHTML='<div class="empty">No equipment in this project.</div>';}
else {
  const boxes=nodes.map(n=>{const d=defs[n.kind]||{width:150,height:100,label:n.kind};return{x:Number(n.props.x)||0,y:Number(n.props.y)||0,w:d.width,h:d.height,n,d}});
  const xs=boxes.flatMap(b=>[b.x,b.x+b.w]).concat(groups.flatMap(g=>[g.x,g.x+g.width]));
  const ys=boxes.flatMap(b=>[b.y,b.y+b.h]).concat(groups.flatMap(g=>[g.y,g.y+g.height]));
  const minX=Math.min(...xs)-80,minY=Math.min(...ys)-80,maxX=Math.max(...xs)+80,maxY=Math.max(...ys)+80;
  svg.setAttribute('viewBox', [minX,minY,Math.max(320,maxX-minX),Math.max(240,maxY-minY)].join(' '));
  for(const group of groups){
    svg.appendChild(make('rect',{class:'group',x:group.x,y:group.y,width:group.width,height:group.height,rx:10}));
    svg.appendChild(make('text',{class:'group-title',x:group.x+12,y:group.y+20},group.title||group.id));
  }
  for(const connection of connections){
    const points=(connection.points||[]).map(p=>p.x+','+p.y).join(' ');
    if(points) svg.appendChild(make('polyline',{class:'connection',points,'data-medium':connection.medium||''}));
  }
  for(const b of boxes){
    const g=make('g',{class:'node',transform:'translate('+b.x+' '+b.y+')','data-id':b.n.id,tabindex:'0'});
    g.appendChild(make('rect',{class:'body',x:0,y:0,width:b.w,height:b.h,rx:8}));
    const cx=b.w/2,cy=Math.min(42,b.h*.42),r=Math.max(10,Math.min(22,b.w*.15,b.h*.22));
    if(/pump|fan|turbine|motor|alternator/.test(b.n.kind)){
      g.appendChild(make('circle',{class:'icon',cx,cy,r}));
      g.appendChild(make('path',{class:'icon',d:'M'+(cx-r*.65)+' '+cy+'H'+(cx+r*.65)+' M'+cx+' '+(cy-r*.65)+'V'+(cy+r*.65)}));
    } else if(/valve/.test(b.n.kind)){
      g.appendChild(make('path',{class:'icon',d:'M'+(cx-r)+' '+(cy-r*.6)+'L'+cx+' '+cy+'L'+(cx-r)+' '+(cy+r*.6)+'Z M'+(cx+r)+' '+(cy-r*.6)+'L'+cx+' '+cy+'L'+(cx+r)+' '+(cy+r*.6)+'Z'}));
    } else {
      g.appendChild(make('rect',{class:'icon',x:cx-r,y:cy-r,width:r*2,height:r*2,rx:Math.min(6,r*.3)}));
    }
    g.appendChild(make('text',{class:'name',x:10,y:b.h-25},b.n.id));
    g.appendChild(make('text',{class:'kind',x:10,y:b.h-10},b.d.label||b.n.kind.replace(/^plant_/,'')));
    const reveal=()=>vscode.postMessage({type:'reveal',id:b.n.id});
    g.addEventListener('click',reveal);
    g.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();reveal();}});
    svg.appendChild(g);
  }
}
</script>
</body>
</html>`;
}

function diagramErrorHtml(message) {
  return `<!doctype html><meta charset="utf-8"><style>body{font:13px var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);padding:24px}code{color:var(--vscode-errorForeground)}</style><h3>Saturn Diagram</h3><p>Unable to build the mnemonic.</p><code>${String(message).replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</code>`;
}

async function refreshDiagram(panel) {
  const root = workspaceRoot();
  if (!root) {
    panel.webview.html = diagramErrorHtml('Open a Saturn project folder first.');
    return;
  }
  panel.webview.html = '<!doctype html><meta charset="utf-8"><style>body{font:13px var(--vscode-font-family);color:var(--vscode-descriptionForeground);background:var(--vscode-editor-background);padding:24px}</style>Building Saturn diagram…';
  try {
    const document = await runCliJson(['ide', 'diagram', '--project', root, '--json']);
    panel.webview.html = diagramHtml(document);
  } catch (error) {
    panel.webview.html = diagramErrorHtml(error instanceof Error ? error.message : String(error));
  }
}

async function revealEquipment(id) {
  const files = await vscode.workspace.findFiles('**/*.ts', '**/{node_modules,dist,.git}/**', 256);
  for (const uri of files) {
    const document = await vscode.workspace.openTextDocument(uri);
    const source = document.getText();
    const index = source.indexOf(id);
    if (index < 0) continue;
    const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
    const start = document.positionAt(index), end = document.positionAt(index + id.length);
    editor.selection = new vscode.Selection(start, end);
    editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    return;
  }
  void vscode.window.showInformationMessage(`Saturn: source for ${id} was not found.`);
}

async function insertEquipment(equipment, forcedId) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.window.showWarningMessage('Open a TypeScript project file first.');
    return false;
  }
  const id = forcedId ?? await vscode.window.showInputBox({
    title: `Add ${equipment.title}`,
    prompt: 'Equipment ID',
    value: equipment.type.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 8) + '-101',
    validateInput: value => /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? null : 'Use letters, digits, _, . or -',
  });
  if (!id) return false;
  const type = JSON.stringify(equipment.type);
  const snippet = `\n// Added from Saturn Equipment Catalog\nconst ${id.replace(/[^A-Za-z0-9_$]/g, '_')} = simulation(${JSON.stringify(id)}, ${type}, {\n  system: "main",\n  at: { x: 0, y: 0 },\n});\n`;
  const position = editor.document.positionAt(editor.document.getText().length);
  await editor.edit(builder => builder.insert(position, snippet));
  const start = editor.document.positionAt(editor.document.getText().length - snippet.length);
  const end = editor.document.positionAt(editor.document.getText().length);
  editor.selection = new vscode.Selection(start, end);
  editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
  return true;
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


const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function showEntryFile() {
  const root = workspaceRoot();
  if (!root) return null;
  const uri = vscode.Uri.file(path.join(root, config().get('project.entry', 'plant.ts')));
  const document = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
}

async function runRecordedTour(catalog, targets, terminal) {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await showEntryFile();
  await vscode.commands.executeCommand('workbench.view.extension.saturn');
  await catalog.reload();
  targets.reload();
  await sleep(3500);

  await vscode.commands.executeCommand('saturn.openDiagram');
  await sleep(6000);

  const root = workspaceRoot();
  if (root) {
    try {
      const diagram = await runCliJson(['ide', 'diagram', '--project', root, '--json']);
      const first = diagram?.scene?.nodes?.[0]?.id;
      if (first) {
        await revealEquipment(first);
        await sleep(3500);
      }
    } catch {}
  }

  await vscode.commands.executeCommand('workbench.view.extension.saturn');
  await sleep(2500);

  const groups = catalog.catalog;
  const equipment = groups.flatMap(group => group.items).find(item => item.type === 'pump')
    ?? groups.flatMap(group => group.items)[0];
  if (equipment) {
    const editor = await showEntryFile();
    if (editor) {
      editor.selection = new vscode.Selection(editor.document.lineAt(editor.document.lineCount - 1).range.end, editor.document.lineAt(editor.document.lineCount - 1).range.end);
      await insertEquipment(equipment, 'VS-CODE-DEMO-101');
      await sleep(4000);
    }
  }

  terminal.runServer();
  await sleep(7000);
  await vscode.commands.executeCommand('workbench.view.extension.saturn');
  await sleep(3000);

  await vscode.commands.executeCommand('saturn.flashController');
  await sleep(3500);

  terminal.stop();
  await sleep(2000);
  await showEntryFile();
  await vscode.commands.executeCommand('workbench.view.extension.saturn');
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
      if (document.fileName.endsWith('.ts')) {
        project.refresh();
        for (const panel of diagramPanels) void refreshDiagram(panel);
      }
      if (document.fileName.endsWith(path.join('.saturn', 'targets.json'))) targets.reload();
    }),
    vscode.commands.registerCommand('saturn.refresh', async () => {
      project.refresh();
      await catalog.reload();
      targets.reload();
    }),
    vscode.commands.registerCommand('saturn.runServer', () => terminal.runServer()),
    vscode.commands.registerCommand('saturn.stopServer', () => terminal.stop()),
    vscode.commands.registerCommand('saturn.openDiagram', async () => {
      const panel = vscode.window.createWebviewPanel(
        'saturn.diagram',
        'Saturn Diagram',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true, enableForms: false }
      );
      diagramPanels.add(panel);
      panel.onDidDispose(() => diagramPanels.delete(panel));
      panel.webview.onDidReceiveMessage(message => {
        if (message?.type === 'reveal' && typeof message.id === 'string') void revealEquipment(message.id);
      });
      await refreshDiagram(panel);
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

  if (process.env.SATURN_VSCODE_TOUR === '1') {
    setTimeout(() => { void runRecordedTour(catalog, targets, terminal); }, 6000);
  } else if (process.env.SATURN_VSCODE_CAPTURE === '1') {
    setTimeout(() => {
      void (async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await showEntryFile();
        await vscode.commands.executeCommand('workbench.view.extension.saturn');
        await vscode.commands.executeCommand('saturn.openDiagram');
      })();
    }, 1500);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
