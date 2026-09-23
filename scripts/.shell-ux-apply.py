from pathlib import Path
root=Path('.')
def edit(path, old, new):
 p=root/path;s=p.read_text();assert old in s,(path,old[:100]);p.write_text(s.replace(old,new))
edit('site/styles.css','--canvas-bg: #0e151b;','--canvas-bg: var(--shell-bg);\n  --canvas-grid: var(--shell-border);')
for old,new in [(' #1c2024ed',' var(--shell-panel)'),(' #353a3f',' var(--shell-border)'),(' #bdc6cf',' var(--shell-text)'),(' #353b41',' var(--shell-hover)'),(' #3a424b',' var(--shell-selection)'),(' #13212ce8',' var(--shell-panel)'),(' #3a5667',' var(--shell-border)'),(' #9eb9ca',' var(--shell-text)')]:
 p=root/'site/styles.css';s=p.read_text();s=s.replace(':'+old+';',':'+new+';');p.write_text(s)
edit('site/index.html','<aside class="equipment-browser" id="equipment-browser" hidden>','<aside class="equipment-browser" id="equipment-browser" aria-label="Оборудование" hidden>')
edit('site/index.html','''                <div id="equipment-catalog-list" class="equipment-catalog-list" aria-label="Каталог оборудования"></div>
                <div class="studio-add-box catalog-fallback"><select id="studio-catalog" aria-label="Тип оборудования"></select><button id="studio-add">Добавить выбранное</button></div>
                <div class="catalog-scene-heading">На схеме</div><div id="studio-tree"></div>''','''                <div class="equipment-browser-content">
                  <div id="equipment-catalog-list" class="equipment-catalog-list" aria-label="Добавить оборудование"></div>
                  <p id="equipment-empty" class="equipment-empty" role="status" hidden>Ничего не найдено. Попробуйте другое название.</p>
                  <div class="catalog-scene-heading">На схеме</div><div id="studio-tree"></div>
                </div>''')
edit('site/index.html','id="equipment-toggle" aria-expanded="false"','id="equipment-toggle" aria-label="Добавить оборудование" aria-controls="equipment-browser" aria-expanded="false"')
edit('site/index.html','id="studio-code" class="surface-tab" aria-label="Код"','id="studio-code" class="surface-tab" aria-label="Показать или скрыть код" aria-controls="studio-editor-pane" title="Показать или скрыть код"')
p=root/'site/studio.css';s=p.read_text()
s=s.replace('fill: #b7ccd9; font-family: var(--mono);','fill: var(--canvas-label-text); font-family: var(--mono);')
s=s.replace('.shell[data-project-kind=plant] #studio-svg .object-label text { fill: #38566a; }','')
s=s.replace('color: #cbe4f1; font-size: 11px;', 'color: var(--canvas-label-text); font-size: 11px;')
s=s.replace('stroke: #527184; stroke-width: 1;', 'stroke: var(--canvas-label-border); stroke-width: 1;')
s=s.replace('.equipment-browser { position: absolute; z-index: 10; top: 0; left: 0; bottom: 0; width: 230px; overflow: auto; background: var(--panel); border-right: 1px solid var(--line); box-shadow: 15px 0 30px #0005; }', '''.equipment-browser { position: relative; z-index: 10; display: flex; flex-direction: column; flex: 0 0 248px; min-width: 0; min-height: 0; overflow: hidden; background: var(--panel); border-right: 1px solid var(--line); }
.equipment-browser-content { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.equipment-browser .panel-heading { height: 40px; font-size: 13px; color: var(--text); }
.equipment-browser .panel-heading button { min-width: 32px; min-height: 32px; }
.equipment-empty { padding: 14px; font-size: 12px; line-height: 1.5; color: var(--muted); }
@media(max-width:1100px) {
 .equipment-browser { position: absolute; inset: 0 auto 0 0; width: min(280px, 100%); max-width: 100%; box-shadow: var(--shadow-popover); }
}''')
s='\n'.join(line for line in s.split('\n') if not line.startswith('.studio-add-box') and not line.startswith('.catalog-fallback'))
s=s.replace('.equipment-catalog-search { display:flex;', '.equipment-catalog-search { flex-shrink:0;display:flex;').replace('height:30px;border:1px solid var(--line);border-radius:7px;background:var(--bg);','height:36px;border:1px solid var(--line);border-radius:7px;background:var(--bg);')
s=s.replace('#equipment-search { width:100%;min-width:0;border:0;outline:0;background:transparent;color:var(--text);font-size:11px; }','#equipment-search { width:100%;min-width:0;border:0;background:transparent;color:var(--text);font-size:12px; }\n.equipment-catalog-search:focus-within { outline:2px solid var(--focus-ring); outline-offset:1px; }\n#equipment-search:focus-visible { outline:none; }')
s=s.replace('.equipment-catalog-list { max-height:52%;overflow:auto;padding:0 7px 8px; }','.equipment-catalog-list { padding:0 7px 8px; }')
s=s.replace('.equipment-catalog-item strong { overflow:hidden;text-overflow:ellipsis;font-size:11px;font-weight:550;color:var(--text); }','.equipment-catalog-item strong { white-space:normal;overflow-wrap:anywhere;font-size:13px;font-weight:500;line-height:1.4;color:var(--text); }')
s=s.replace('.equipment-catalog-item small { overflow:hidden;text-overflow:ellipsis;font:9px var(--mono);color:var(--muted);white-space:nowrap; }','')
s += '\n/* A dock shares width with the source rather than covering it. */\n@media(min-width:1101px) {\n .studio-workarea:has(.equipment-browser:not([hidden])) .studio-editor-pane { width:min(var(--source-width, 38%), 32%); }\n}\n#studio-tree button { min-height:40px; font-size:12px; }\n'
p.write_text(s)
p=root/'site/studio.ts';s=p.read_text()
s=s.replace("    $('studio-add').toggleAttribute('disabled', error || isPlant() || runtimeOnly);", "    $('equipment-catalog-list').querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = error || isPlant() || runtimeOnly);")
s=s.replace("const categoryTitle:Record<string,string>={process:'Process',instrumentation:'Instrumentation',electrical:'Electrical',mechanical:'Mechanical',control:'Control',structure:'Structure',generic:'Other'};", "const categoryTitle:Record<string,string>={process:'Технологическое',instrumentation:'Измерительные приборы',electrical:'Электрика',mechanical:'Механика',control:'Управление',structure:'Конструкции',generic:'Другое'};")
s=s.replace("    const select=$<HTMLSelectElement>('studio-catalog'), host=$('equipment-catalog-list'), query=$<HTMLInputElement>('equipment-search').value.trim().toLocaleLowerCase();\n    const previous=select.value; select.replaceChildren(); host.replaceChildren();", "    const host=$('equipment-catalog-list'), query=$<HTMLInputElement>('equipment-search').value.trim().toLocaleLowerCase();\n    host.replaceChildren();")
s=s.replace("        const option=document.createElement('option');option.value=kind;option.textContent=definition.label;select.append(option);\n",'')
s=s.replace("        const copy=document.createElement('span'),title=document.createElement('strong'),meta=document.createElement('small');\n        title.textContent=definition.label;meta.textContent=definition.visual?.geometry??kind;copy.append(title,meta);button.append(copy);\n        button.onclick=()=>{select.value=kind;$('studio-add').click();};section.append(button);", "        const copy=document.createElement('span'),title=document.createElement('strong');\n        title.textContent=definition.label;copy.append(title);button.append(copy);\n        button.title=definition.visual?.geometry??kind;\n        button.setAttribute('aria-label', `Добавить: ${definition.label}`);\n        button.disabled=error || isPlant() || runtimeOnly;\n        button.onclick=()=>addEquipment(kind);section.append(button);")
s=s.replace("    if(previous&&[...select.options].some(o=>o.value===previous))select.value=previous;", "    $('equipment-empty').hidden=entries.length>0;")
s=s.replace("  function toggleEquipment(open = $('equipment-browser').hidden) { $('equipment-browser').hidden = !open; $('equipment-toggle').setAttribute('aria-expanded', String(open)); }", """  function toggleEquipment(open = $('equipment-browser').hidden) {
    const browser = $('equipment-browser');
    const restoreFocus = browser.contains(document.activeElement);
    browser.hidden = !open;
    $('equipment-toggle').setAttribute('aria-expanded', String(open));
    if (open) {
      filesVisible = false; syncPanels();
      $<HTMLInputElement>('equipment-search').focus({ preventScroll: true });
    } else if (restoreFocus) $('equipment-toggle').focus({ preventScroll: true });
    requestAnimationFrame(() => editor.requestMeasure());
  }""")
s=s.replace("else if (filesVisible) { filesVisible = false; syncPanels(); } else if (!$('equipment-browser').hidden) toggleEquipment(false);", "else if (!$('equipment-browser').hidden) toggleEquipment(false); else if (filesVisible) { filesVisible = false; syncPanels(); }")
s=s.replace("  $('studio-add').onclick = () => {\n    if (error || runtimeOnly) return;\n    try { const kind = $<HTMLSelectElement>('studio-catalog').value;", "  function addEquipment(kind: string) {\n    if (error || isPlant() || runtimeOnly) return;\n    try {")
s=s.replace("userEvent: 'input' }); fitScene(); spatial?.fit(); select(compiled.scene.nodes.at(-1)?.id ?? null); }", "userEvent: 'input' }); toggleEquipment(false); fitScene(); spatial?.fit(); select(compiled.scene.nodes.at(-1)?.id ?? null); }")
s=s.replace("else renderInspector(); });\n  canvas.addEventListener('pointercancel'", "else { view.previewMove(d.id, d.x, d.y); renderInspector(); } });\n  canvas.addEventListener('pointercancel'")
s=s.replace("  window.addEventListener('resize', () => { spatial?.fit(); syncPanels(); });", """  function syncCanvasTheme() {
    const style = getComputedStyle(shell);
    spatial?.setAppearance(style.getPropertyValue('--canvas-bg').trim(), style.getPropertyValue('--canvas-grid').trim());
  }
  window.addEventListener('saturn-theme-change', syncCanvasTheme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncCanvasTheme);
  window.addEventListener('resize', () => { spatial?.fit(); syncPanels(); });""")
s=s.replace("spatial = new SceneView3D(spatialHost, { landing: true }); spatial.onSelect = select;", "spatial = new SceneView3D(spatialHost, { landing: true }); syncCanvasTheme(); spatial.onSelect = select;")
p.write_text(s)
p=root/'src/view3d.ts';s=p.read_text()
s=s.replace('  private camera = new THREE.PerspectiveCamera', '  private floorMaterial: THREE.MeshStandardMaterial;\n  private grid: THREE.GridHelper;\n  private camera = new THREE.PerspectiveCamera')
s=s.replace("    const floor = addMesh(this.world, new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: options.landing ? 0x0c0c0f : 0xe6edef, roughness: .9 }),", "    this.floorMaterial = new THREE.MeshStandardMaterial({ color: options.landing ? 0x0c0c0f : 0xe6edef, roughness: .9 });\n    const floor = addMesh(this.world, new THREE.PlaneGeometry(160, 160), this.floorMaterial,")
s=s.replace('const grid = new THREE.GridHelper(100, 100,','const grid = this.grid = new THREE.GridHelper(100, 100,')
s=s.replace('  dispose() { cancelAnimationFrame(this.raf);', '''  /** Host palette is presentation state, independent of source and telemetry. */
  setAppearance(background: string, grid: string) {
    this.renderer.setClearColor(background);
    this.floorMaterial.color.set(background);
    const material = this.grid.material as THREE.LineBasicMaterial;
    material.vertexColors = false;
    material.color.set(grid);
    material.needsUpdate = true;
    this.draw();
  }
  dispose() { this.floorMaterial.dispose(); this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose(); cancelAnimationFrame(this.raf);''')
p.write_text(s)
for name in ['scripts/site-studio-check.mjs','scripts/site-interaction-check.mjs']:
 p=root/name;s=p.read_text()
 import re
 s=re.sub(r"await page.locator\('#studio-catalog'\).selectOption\('(\w+)'\);\s*await page.locator\('#studio-add'\).click\(\);",r"await page.locator('#equipment-toggle').evaluate(button => { if (button.getAttribute('aria-expanded') !== 'true') button.click(); });\n  await page.locator('[data-catalog-kind=\"\1\"]').click();",s)
 p.write_text(s)
p=root/'site/studio.css';s=p.read_text().replace('background: var(--overlay-hover); color: #fff;', 'background: var(--overlay-hover); color: var(--overlay-text);').replace('background: var(--overlay-active); color: #fff;', 'background: var(--overlay-active); color: var(--overlay-text);')
s=s.replace('.equipment-catalog-item strong { overflow:hidden;text-overflow:ellipsis;font-size:11px;font-weight:550; }', '.equipment-catalog-item strong { white-space:normal;overflow-wrap:anywhere;font-size:13px;font-weight:500;line-height:1.4; }')
s='\n'.join(line for line in s.split('\n') if not line.startswith('.equipment-catalog-item small'));p.write_text(s)
p=root/'site/studio.ts';s=p.read_text().replace("filesVisible = false; syncPanels();\n      $<HTMLInputElement>('equipment-search')", "filesVisible = false; syncPanels(); renderEquipmentCatalog();\n      $<HTMLInputElement>('equipment-search')").replace("else if (!$('equipment-browser').hidden) toggleEquipment(false);", "else if (!$('equipment-browser').hidden) { event.preventDefault(); toggleEquipment(false); }");p.write_text(s)
p=root/'scripts/site-interaction-check.mjs';s=p.read_text().replace("    await page.locator('#studio-catalog').selectOption('pump');\n", '').replace("await page.locator('#studio-add').click();", "await page.locator('[data-catalog-kind=\"pump\"]').click();").replace("    await page.locator('#equipment-close').click();\n    await page.locator('#studio-connect')", "    assert(!await page.locator('#equipment-browser').isVisible(), 'Insertion closes the catalog');\n    await page.locator('#studio-connect')");p.write_text(s)
p=root/'scripts/site-release-check.mjs';s=p.read_text().replace("import assert from 'node:assert/strict';", "import assert from 'node:assert/strict';\nimport { checkShellUx } from './site-shell-ux-check.mjs';").replace("  const animated=await browser.newContext", "  await checkShellUx(page);\n  const animated=await browser.newContext").replace("env:{...process.env,PORT:String(port)}", "env:{...process.env,PORT:String(port),...(process.argv.includes('--built')?{SATURN_SITE_DIR:'dist/plant/site'}:{})}");p.write_text(s)
p=root/'scripts/site-dev.mjs';s=p.read_text().replace("await buildSite();\nconst root = resolve('dist/site'),", "// Release checks serve the already-built deployable app, never rebuild it.\nif (!process.env.SATURN_SITE_DIR) await buildSite();\nconst root = resolve(process.env.SATURN_SITE_DIR ?? 'dist/site'),");p.write_text(s)
p=root/'package.json';s=p.read_text().replace('    "site:test:browser":', '    "check:release": "npm run check && npm run site:check && npm run authoring:typecheck && npm run authoring:test && npm run site:test:release && npm audit --audit-level=high",\n    "site:test:release": "node scripts/site-release-check.mjs --built",\n    "site:test:browser":');p.write_text(s)
(root/'.github/workflows/pages.yml').write_bytes((root/'scripts/.shell-ux-final-ci.yml').read_bytes())
# Refuse to publish anything other than the locally checked candidate bytes.
import hashlib
expected = {'.github/workflows/pages.yml': '03d60433d455886edc498a4f24f22c361f41c70546015b2b9a8ab335277ac6c5', 'package.json': '161f68065d8a1937f366ba91b54f611e924a20c83ad99dcef1fff42a1b0a7a1e', 'scripts/site-dev.mjs': '6892c7c6f972fb61f66ace72677282f2a711a356189a9f24adbaa15bdacac0fa', 'scripts/site-interaction-check.mjs': '53fdfb0f50b016390153321dd0f123df4d25f53d4f7af43eea0df74db0e09c8e', 'scripts/site-release-check.mjs': '6a1d6279793a5eef0e6554675478fa9ebdd17294e05acecae15da4b7d1308cb9', 'scripts/site-shell-ux-check.mjs': '1f002474e04ec7eba7bf6f035236ebbd35e14c5c6cb47634699539d734e984b4', 'scripts/site-studio-check.mjs': '0cc748998258ad54e461a8d5eb2718c065b9c3d47eecd403ea3c9a503937655f', 'site/index.html': '87ee38da1b4402a88d660e1d4f2085614a96506c3df9a109e0fa93bdf822fbb0', 'site/studio.css': '19769ebf5c6bab47be65454e312d07d726493da523f4451f5a02d3338e5f4684', 'site/studio.ts': 'afa06cb5131289dc4f47505be510b845e4473ba2557f81c6dce10435eba970f6', 'site/styles.css': '0b3fab3058f49da126585f0ba57b1e25500dfc291cfe8f29bc690fb48dbef2d4', 'src/view3d.ts': '375171855fc9ca354f1a35276fe6694b385b1c81c5eedc3b73c6626ac83099f8'}
for path, sha in expected.items():
 assert hashlib.sha256((root/path).read_bytes()).hexdigest() == sha, path
