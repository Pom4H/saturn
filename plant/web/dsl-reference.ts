type DslCategory = 'Project' | 'Model' | 'Signals' | 'Topology' | 'Control' | 'PLC' | 'Presentation' | 'Reports';

type DslEntity = {
  name: string;
  signature: string;
  category: DslCategory;
  summary: string;
  relations: string[];
  example: string;
  note?: string;
  featured?: boolean;
};

const entities: DslEntity[] = [
  {
    name: 'project',
    signature: 'project(name, options) → Project',
    category: 'Project',
    summary: 'Корень проекта. Собирает системы, модели, сигналы, PLC, соединения, управление, представления, алармы и отчёты в один проверяемый Project IR.',
    relations: ['system', 'simulation', 'control', 'plc', 'pipe', 'alarm', 'report'],
    example: `export default project('water-station', {
  title: 'Насосная станция',
  description: 'Основной контур',
  systems: [water],
  simulations: [pump],
  controls: [speed],
  connections: [suction],
  signals: [],
  alarms: [],
  reports: [],
})`,
  },
  {
    name: 'system',
    signature: 'system(name, title, parent?) → System',
    category: 'Project',
    summary: 'Иерархическая группа установки. Даёт навигацию и принадлежность оборудования, но не создаёт отдельную копию симуляции.',
    relations: ['project', 'simulation', 'equipment', 'control', 'plc'],
    example: `const water = system('water', 'Водоснабжение')
const pumps = system('pumps', 'Насосная группа', 'water')`,
  },
  {
    name: 'simulation',
    signature: 'simulation(name, model, options) → SimRef',
    category: 'Model',
    summary: 'Экземпляр установленной динамической модели. Выходы модели сразу доступны как типизированные signal expressions.',
    relations: ['system', 'signal', 'derived', 'equipment', 'port', 'pipe'],
    example: `const pump = simulation('P-101', 'pump', {
  system: 'water',
  at: { x: 320, y: 180 },
  inputs: { voltage: drive.value },
  parameters: { inertia: 1.6 },
})

// pump.rpm и pump.flow — Expr`,
  },
  {
    name: 'equipment',
    signature: 'equipment(name, type, { system, at, signals }) → Device',
    category: 'Model',
    summary: 'Визуальное/инженерное представление объекта, привязанное к сигналам. Не обязано иметь собственную динамическую модель.',
    relations: ['simulation', 'signal', 'system', 'port'],
    example: `const gauge = equipment('FI-101', 'sensor', {
  system: 'water',
  at: { x: 620, y: 150 },
  signals: { value: pump.flow },
})`,
  },
  {
    name: 'signal',
    signature: 'signal(path) → Expr',
    category: 'Signals',
    summary: 'Стабильная ссылка на сигнал по ID. Это общий атом выражений между моделями, правилами, алармами и интерфейсами.',
    relations: ['simulation', 'derived', 'alarm', 'control', 'view'],
    example: `const pressure = signal('PT-101.value')`,
  },
  {
    name: 'derived',
    signature: 'derived(name, expression, unit?, history?) → Derived',
    category: 'Signals',
    summary: 'Именованный вычисляемый сигнал. Не создаёт скрытое состояние: значение получается из выражения над существующими сигналами.',
    relations: ['signal', 'aggregate', 'alarm', 'report'],
    example: `const power = derived(
  'P-101.power',
  mul(signal('P-101.voltage'), signal('P-101.current')),
  'kW',
)`,
  },
  {
    name: 'bank',
    signature: 'bank(prefix, model, options) → SimRef[]',
    category: 'Model',
    summary: 'Компактно объявляет повторяющееся оборудование, но перед runtime разворачивается в обычные экземпляры со стабильными ID.',
    relations: ['simulation', 'aggregate', 'system'],
    example: `const pumps = bank('P-', 'pump', {
  count: 4,
  columns: 2,
  pitch: { x: 260, y: 180 },
  system: 'water',
  at: { x: 200, y: 120 },
})`,
  },
  {
    name: 'aggregate',
    signature: "aggregate(items, output, operation = 'mean') → Expr",
    category: 'Signals',
    summary: 'Агрегирует один выход группы моделей: mean, sum, min или max.',
    relations: ['bank', 'derived', 'signal'],
    example: `const totalFlow = derived(
  'water.totalFlow',
  aggregate(pumps, 'flow', 'sum'),
  'm³/h',
)`,
  },
  {
    name: 'control',
    signature: 'control(name, options) → ControlRef',
    category: 'Control',
    summary: 'Операторская уставка с requested/value/blocked. Команда меняет runtime state, а не исходник проекта.',
    relations: ['project', 'signal', 'view', 'plc'],
    example: `const drive = control('P-101.speed', {
  title: 'Скорость насоса',
  system: 'water',
  min: 0,
  max: 1,
  initial: 0.6,
  rate: 0.25,
})`,
  },
  {
    name: 'port',
    signature: 'port(device, name) → Endpoint',
    category: 'Topology',
    summary: 'Типизированная ссылка на физический терминал устройства или PLC. Используется соединениями и редактором топологии.',
    relations: ['simulation', 'equipment', 'plc', 'pipe', 'cable'],
    example: `const inlet = port(pump, 'inlet')
const outlet = port(pump, 'outlet')`,
  },
  {
    name: 'pipe',
    signature: 'pipe(name, from, to, { via? }) → Connection',
    category: 'Topology',
    summary: 'Высокоуровневая технологическая связь между двумя портами. Семантика medium = pipe фиксирована самим конструктором.',
    relations: ['port', 'simulation', 'equipment', 'project'],
    example: `const suction = pipe(
  'suction',
  port(tank, 'outlet'),
  port(pump, 'inlet'),
)`,
    note: 'Предпочтительный уровень для технологической схемы: проект говорит «это труба», а геометрия, визуализация и runtime получают единый Connection.',
    featured: true,
  },
  {
    name: 'cable',
    signature: 'cable(name, from, to, options) → Connection',
    category: 'Topology',
    summary: 'Физическая электрическая, управляющая или шинная связь. Medium задаётся явно в options.',
    relations: ['port', 'plc', 'equipment', 'project'],
    example: `const power = cable(
  'pump-power',
  port(feeder, 'out'),
  port(pumpDrive, 'power'),
  { medium: 'power' },
)`,
  },
  {
    name: 'expansion',
    signature: 'expansion(device, controller, slot) → Attachment',
    category: 'Topology',
    summary: 'Привязывает модуль расширения к контроллеру и физическому слоту.',
    relations: ['plc', 'simulation', 'project'],
    example: `const ai4 = expansion(module, controller, 1)`,
  },
  {
    name: 'plc',
    signature: 'plc(name, { system, at, outputs, blocks, hmi? }) → ControllerRef',
    category: 'PLC',
    summary: 'Контроллер как часть проекта: физические I/O, вычисляемые выходы, FBD-блоки и локальный HMI остаются привязаны к одному стабильному ID.',
    relations: ['pin', 'block', 'functionBlock', 'port', 'cable', 'expansion'],
    example: `const controller = plc('SATURN-1', {
  system: 'control',
  at: { x: 800, y: 280 },
  blocks: {},
  outputs: {
    DO1: gt(pin('AI1'), 500),
  },
})`,
  },
  {
    name: 'pin',
    signature: 'pin(name) → Expr',
    category: 'PLC',
    summary: 'Ссылка на локальную клемму/сигнал PLC внутри программы контроллера.',
    relations: ['plc', 'functionBlock', 'block'],
    example: `const high = gt(pin('AI1'), 500)`,
  },
  {
    name: 'block',
    signature: 'block(name) → Expr',
    category: 'PLC',
    summary: 'Стабильная ссылка на выход именованного функционального блока.',
    relations: ['plc', 'functionBlock', 'pin'],
    example: `const delayed = block('START_DELAY')`,
  },
  {
    name: 'functionBlock',
    signature: 'functionBlock(type, inputs, params?) → PlcBlock',
    category: 'PLC',
    summary: 'Декларативный FBD-блок контроллера. Компилятор проверяет тип, входы, параметры и циклы.',
    relations: ['plc', 'pin', 'block'],
    example: `const delay = functionBlock('TON', [pin('DI1')], [500])`,
  },
  {
    name: 'alarm',
    signature: 'alarm(name, options) → AlarmRule',
    category: 'Control',
    summary: 'Правило операторского аларма поверх signal expression: пороги, задержка, приоритет и уведомление.',
    relations: ['signal', 'derived', 'project'],
    example: `const hot = alarm('P-101-hot', {
  title: 'Перегрев P-101',
  signal: pump.temperature,
  above: 80,
  clearBelow: 75,
  priority: 'critical',
})`,
  },
  {
    name: 'report',
    signature: 'report(name, options) → Report',
    category: 'Reports',
    summary: 'Версионируемый отчёт: входные параметры, окно данных, SQL над ограниченной капсулой, таблица/график и расписание.',
    relations: ['signal', 'derived', 'view', 'project'],
    example: `const hourly = report('flow-hour', {
  title: 'Расход за час',
  on: { schedule: [{ cron: '0 * * * *' }] },
  signals: ['water.totalFlow'],
  window: 3_600_000,
  sql: 'SELECT signal, AVG(value) AS average FROM samples GROUP BY signal',
  columns: [
    { key: 'signal', title: 'Сигнал' },
    { key: 'average', title: 'Среднее' },
  ],
})`,
  },
  {
    name: 'view',
    signature: 'view(name, options) → Presentation',
    category: 'Presentation',
    summary: 'Сериализуемое представление данных для live UI, отчёта или ограниченного PLC target. Не содержит React callbacks.',
    relations: ['panel', 'readout', 'commandButton', 'signal', 'control', 'report'],
    example: `const operator = view('operator', {
  title: 'Насосная',
  bindings: { rpm: pump.rpm, flow: pump.flow },
  body: panel([
    readout('Обороты', 'rpm', 'об/мин', 0),
    readout('Расход', 'flow', 'м³/ч', 1),
  ]),
})`,
    note: 'Presentation — текущий общий serializable UI contract. Новые renderer-specific модели не должны создавать второй тип сигнала или второй project IR.',
  },
  {
    name: 'panel',
    signature: "panel(children, direction = 'column', title?) → ViewNode",
    category: 'Presentation',
    summary: 'Группирует presentation nodes без привязки к конкретному renderer.',
    relations: ['view', 'readout', 'commandButton'],
    example: `panel([
  readout('Расход', 'flow', 'м³/ч'),
  commandButton('Стоп', 'P-101.speed', 0),
], 'column', 'P-101')`,
  },
  {
    name: 'readout',
    signature: "readout(label, binding, unit = '', digits = 2) → ViewNode",
    category: 'Presentation',
    summary: 'Числовой индикатор, который читает именованный binding из view.',
    relations: ['view', 'signal', 'panel'],
    example: `readout('Обороты', 'rpm', 'об/мин', 0)`,
  },
  {
    name: 'commandButton',
    signature: 'commandButton(label, target, value) → ViewNode',
    category: 'Presentation',
    summary: 'Операторское действие в сериализуемом presentation tree. Побочный эффект выполняет runtime adapter, а не UI callback.',
    relations: ['view', 'control', 'panel'],
    example: `commandButton('Пуск', 'P-101.speed', 0.64)`,
  },
];

const operators = [
  ['add', 'add(...expr)'],
  ['sub', 'sub(a, b)'],
  ['mul', 'mul(...expr)'],
  ['div', 'div(a, b)'],
  ['min', 'min(...expr)'],
  ['max', 'max(...expr)'],
  ['gt', 'gt(a, b)'],
  ['lt', 'lt(a, b)'],
  ['and', 'and(...expr)'],
] as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

const tabs = document.querySelector<HTMLElement>('.tabs');
const main = document.querySelector<HTMLElement>('main');

if (tabs && main && !document.querySelector('[data-tab="dsl"]')) {
  const tab = document.createElement('button');
  tab.dataset.tab = 'dsl';
  tab.textContent = 'DSL';
  tab.title = 'Интерактивная документация @saturn/core';
  tabs.insertBefore(tab, tabs.querySelector('[data-tab="extensions"]'));

  const panel = document.createElement('section');
  panel.dataset.panel = 'dsl';
  panel.hidden = true;
  panel.innerHTML = `
    <style>
      .dsl-docs{display:grid;gap:20px}
      .dsl-hero{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr);gap:18px;align-items:stretch}
      .dsl-hero>div,.dsl-map,.dsl-operators{border:1px solid #cbdbe2;background:#f8fbfc;padding:18px}
      .dsl-kicker{margin:0 0 7px;font:700 10px ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.12em;color:#527383}
      .dsl-hero h2{margin:0 0 9px;font-size:25px;color:#183c4d}
      .dsl-hero p{margin:7px 0;line-height:1.55}
      .dsl-package{display:grid;gap:7px;font:12px ui-monospace,SFMono-Regular,Consolas,monospace}
      .dsl-package span{display:grid;grid-template-columns:116px minmax(0,1fr);gap:8px;padding:7px 0;border-bottom:1px solid #dbe5e9}
      .dsl-package b{color:#173746}.dsl-package code{overflow-wrap:anywhere}
      .dsl-map{overflow:auto}
      .dsl-map-grid{min-width:650px;display:grid;grid-template-columns:repeat(6,minmax(88px,1fr));gap:8px;align-items:center}
      .dsl-map button{min-height:58px;padding:9px;border:1px solid #c7d6dc;background:white;text-align:left;font:600 11px ui-monospace,SFMono-Regular,Consolas,monospace}
      .dsl-map button small{display:block;margin-top:4px;font:10px system-ui;color:#6a818c}
      .dsl-map .arrow{border:0;background:transparent;text-align:center;color:#78909b;font-size:18px;min-height:0}
      .dsl-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .dsl-toolbar input{flex:1;min-width:220px}
      .dsl-categories{display:flex;gap:6px;flex-wrap:wrap}
      .dsl-categories button[aria-pressed=true]{background:#173746;color:white;border-color:#173746}
      .dsl-results{font-size:11px;color:#637d88;margin-left:auto}
      .dsl-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .dsl-card{border:1px solid #cbdbe2;background:white;min-width:0}
      .dsl-card[data-featured=true]{border-color:#83a9b7;background:#fbfdfe}
      .dsl-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:15px}
      .dsl-card h3{margin:0 0 5px;font:700 17px ui-monospace,SFMono-Regular,Consolas,monospace;color:#173746}
      .dsl-signature{font:11px ui-monospace,SFMono-Regular,Consolas,monospace;color:#527383;overflow-wrap:anywhere}
      .dsl-category{font:700 9px ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;letter-spacing:.08em;color:#6a818c}
      .dsl-card p{margin:0;padding:0 15px 14px;line-height:1.5;color:#395b68}
      .dsl-card button[data-dsl-expand]{margin:0 15px 15px;white-space:nowrap}
      .dsl-detail{border-top:1px solid #dbe5e9;padding:14px 15px 16px;background:#f8fbfc}
      .dsl-detail pre{margin:0 0 12px;padding:13px;overflow:auto;background:#102c38;color:#e7f1f4;font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}
      .dsl-relations{display:flex;gap:5px;flex-wrap:wrap}
      .dsl-relations button{font:10px ui-monospace,SFMono-Regular,Consolas,monospace;padding:5px 7px}
      .dsl-note{margin-top:12px!important;padding:10px!important;background:#eef5f7;border-left:3px solid #5c8797;color:#315563!important}
      .dsl-operators code{display:inline-block;margin:4px 5px 0 0;padding:6px 8px;border:1px solid #d3e0e5;background:white;font-size:11px}
      .dsl-empty{grid-column:1/-1;padding:32px;text-align:center;border:1px dashed #cbdbe2;color:#6a818c}
      @media(max-width:900px){.dsl-hero{grid-template-columns:1fr}.dsl-grid{grid-template-columns:1fr}}
      @media(max-width:680px){.dsl-hero>div,.dsl-map,.dsl-operators{padding:13px}.dsl-package span{grid-template-columns:1fr}.dsl-toolbar{align-items:stretch}.dsl-toolbar input{min-width:100%;width:100%}.dsl-results{width:100%;margin-left:0}.dsl-card-head{flex-direction:column}}
    </style>
    <div class="dsl-docs">
      <div class="dsl-hero">
        <div>
          <p class="dsl-kicker">SATURN · AUTHORING API</p>
          <h2>DSL проекта</h2>
          <p>Один декларативный TypeScript-проект описывает состав установки, сигналы, топологию, управление, PLC, интерфейсы и отчёты. Runtime-состояние и подключение к операторскому Saturn остаются вне исходников.</p>
          <pre><code>import { project, system, simulation, port, pipe } from '@saturn/core'</code></pre>
        </div>
        <div class="dsl-package">
          <span><b>Приложение</b><code>@saturn/scada</code></span>
          <span><b>DSL / contracts</b><code>@saturn/core</code></span>
          <span><b>Расширение</b><code>@saturn/my-extension</code></span>
          <span><b>Project IR</b><code>один на все renderer/runtime targets</code></span>
        </div>
      </div>

      <div class="dsl-map">
        <p class="dsl-kicker">КАК СУЩНОСТИ СВЯЗАНЫ</p>
        <div class="dsl-map-grid" aria-label="Связи сущностей DSL">
          <button type="button" data-dsl-jump="system">system()<small>структура</small></button>
          <span class="arrow">→</span>
          <button type="button" data-dsl-jump="simulation">simulation()<small>поведение</small></button>
          <span class="arrow">→</span>
          <button type="button" data-dsl-jump="port">port()<small>терминал</small></button>
          <span></span>
          <button type="button" data-dsl-jump="signal">signal()<small>данные</small></button>
          <span class="arrow">→</span>
          <button type="button" data-dsl-jump="derived">derived()<small>выражение</small></button>
          <span class="arrow">→</span>
          <button type="button" data-dsl-jump="alarm">alarm()<small>событие</small></button>
          <span></span>
          <button type="button" data-dsl-jump="control">control()<small>уставка</small></button>
          <span class="arrow">→</span>
          <button type="button" data-dsl-jump="plc">plc()<small>логика</small></button>
          <span class="arrow">↔</span>
          <button type="button" data-dsl-jump="cable">cable()<small>электрика / bus</small></button>
          <span></span>
          <button type="button" data-dsl-jump="equipment">equipment()<small>представление</small></button>
          <span class="arrow">←</span>
          <button type="button" data-dsl-jump="pipe">pipe()<small>технология</small></button>
          <span class="arrow">→</span>
          <button type="button" data-dsl-jump="project">project()<small>единый IR</small></button>
        </div>
      </div>

      <div class="dsl-toolbar">
        <input id="dsl-search" type="search" placeholder="Найти pipe, PLC, сигнал, отчёт…" aria-label="Поиск по DSL">
        <div class="dsl-categories" id="dsl-categories"></div>
        <span class="dsl-results" id="dsl-results" aria-live="polite"></span>
      </div>

      <div class="dsl-grid" id="dsl-grid"></div>

      <div class="dsl-operators">
        <p class="dsl-kicker">ВЫРАЖЕНИЯ</p>
        <p>Операторы работают с тем же <code>Expr</code>, что и выходы моделей, derived signals, условия и PLC bindings.</p>
        <div id="dsl-operators"></div>
      </div>
    </div>
  `;
  main.append(panel);

  const search = panel.querySelector<HTMLInputElement>('#dsl-search')!;
  const categories = panel.querySelector<HTMLElement>('#dsl-categories')!;
  const grid = panel.querySelector<HTMLElement>('#dsl-grid')!;
  const results = panel.querySelector<HTMLElement>('#dsl-results')!;
  const operatorHost = panel.querySelector<HTMLElement>('#dsl-operators')!;
  const allCategories = ['All', ...new Set(entities.map(entity => entity.category))] as const;
  let category = 'All';

  categories.innerHTML = allCategories.map(name => `<button type="button" data-dsl-category="${escapeHtml(name)}" aria-pressed="${name === 'All'}">${escapeHtml(name)}</button>`).join('');
  operatorHost.innerHTML = operators.map(([, signature]) => `<code>${escapeHtml(signature)}</code>`).join('');

  const render = () => {
    const query = search.value.trim().toLocaleLowerCase('ru');
    const visible = entities.filter(entity => {
      const inCategory = category === 'All' || entity.category === category;
      const haystack = [entity.name, entity.signature, entity.category, entity.summary, entity.relations.join(' '), entity.note ?? ''].join(' ').toLocaleLowerCase('ru');
      return inCategory && (!query || haystack.includes(query));
    });
    results.textContent = `${visible.length} / ${entities.length}`;
    grid.innerHTML = visible.length ? visible.map(entity => `
      <article class="dsl-card" data-dsl-entity="${escapeHtml(entity.name)}" data-featured="${String(!!entity.featured)}">
        <div class="dsl-card-head">
          <div>
            <div class="dsl-category">${escapeHtml(entity.category)}</div>
            <h3>${escapeHtml(entity.name)}()</h3>
            <div class="dsl-signature">${escapeHtml(entity.signature)}</div>
          </div>
          ${entity.featured ? '<span class="badge active">core abstraction</span>' : ''}
        </div>
        <p>${escapeHtml(entity.summary)}</p>
        <button type="button" data-dsl-expand="${escapeHtml(entity.name)}" aria-expanded="false">Пример и связи</button>
        <div class="dsl-detail" hidden>
          <pre><code>${escapeHtml(entity.example)}</code></pre>
          <div class="dsl-relations">${entity.relations.map(name => `<button type="button" data-dsl-jump="${escapeHtml(name)}">${escapeHtml(name)}()</button>`).join('')}</div>
          ${entity.note ? `<p class="dsl-note">${escapeHtml(entity.note)}</p>` : ''}
        </div>
      </article>
    `).join('') : '<div class="dsl-empty">Ничего не найдено. Сбросьте категорию или поиск.</div>';
  };

  search.addEventListener('input', render);
  categories.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-dsl-category]');
    if (!button) return;
    category = button.dataset.dslCategory ?? 'All';
    categories.querySelectorAll<HTMLButtonElement>('[data-dsl-category]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    render();
  });

  panel.addEventListener('click', event => {
    const target = event.target as Element;
    const expand = target.closest<HTMLButtonElement>('[data-dsl-expand]');
    if (expand) {
      const card = expand.closest<HTMLElement>('.dsl-card')!;
      const detail = card.querySelector<HTMLElement>('.dsl-detail')!;
      const open = detail.hidden;
      detail.hidden = !open;
      expand.setAttribute('aria-expanded', String(open));
      expand.textContent = open ? 'Свернуть' : 'Пример и связи';
      return;
    }
    const jump = target.closest<HTMLButtonElement>('[data-dsl-jump]');
    if (jump) {
      const name = jump.dataset.dslJump!;
      category = 'All';
      search.value = name;
      categories.querySelectorAll<HTMLButtonElement>('[data-dsl-category]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.dslCategory === 'All')));
      render();
      const card = grid.querySelector<HTMLElement>(`[data-dsl-entity="${CSS.escape(name)}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card?.querySelector<HTMLButtonElement>('[data-dsl-expand]')?.focus();
    }
  });

  render();
}
