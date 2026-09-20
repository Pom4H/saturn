export type DslCategory = 'Project' | 'Model' | 'Signals' | 'Topology' | 'Control' | 'PLC' | 'Presentation' | 'Reports';

export type DslEntity = {
  name: string;
  signature: string;
  category: DslCategory;
  summary: string;
  relations: string[];
  example: string;
  note?: string;
  featured?: boolean;
};

export const entities: DslEntity[] = [
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

export const operators = [
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

