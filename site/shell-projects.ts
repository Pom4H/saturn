/** Built-in examples are ordinary canonical @saturn/core projects. */
export const examples = {
  pump: {
    title: 'Насосная станция',
    subtitle: 'Подача воды · 5 объектов',
    source: `import { project, system, simulation, pipe } from "@saturn/core";

const water = system("water", "Подача воды");

const reservoir = simulation("TK-01", "reservoir", {
  system: water.id,
  at: { x: 40, y: 180 },
  inputs: { inflow: 0.08, demand: 0.12 },
  parameters: { initialLevel: 0.68 },
});

const motor = simulation("P-01", "pump", {
  system: water.id,
  at: { x: 330, y: 268 },
  inputs: { voltage: 1, resistance: 1 },
  parameters: { nominalFlow: 1.2 },
});

const meter = simulation("FT-01", "strainer", {
  system: water.id,
  at: { x: 620, y: 160 },
  inputs: { flow: motor.flow, impurity: 0.02, flush: 0 },
});

const gate = simulation("V-01", "motor-valve", {
  system: water.id,
  at: { x: 850, y: 96 },
  inputs: { demand: 0.8, pressure: 1 },
});

const receiver = simulation("TK-02", "reservoir", {
  system: water.id,
  at: { x: 1100, y: 178 },
  inputs: { inflow: gate.flow, demand: 0.05 },
  parameters: { initialLevel: 0.35 },
});

const suction = pipe("PIPE-101", reservoir.ports.outlet, motor.ports.inlet);
const discharge = pipe("PIPE-102", motor.ports.outlet, meter.ports.inlet);
const control = pipe("PIPE-103", meter.ports.outlet, gate.ports.inlet);
const delivery = pipe("PIPE-104", gate.ports.outlet, receiver.ports.inlet);

export default project("pump-station", {
  title: "Насосная станция",
  description: "Учебный контур подачи воды",
  systems: [water],
  simulations: [reservoir, motor, meter, gate, receiver],
  connections: [suction, discharge, control, delivery],
  signals: [],
  alarms: [],
  reports: [],
});
`,
  },
  thermal: {
    title: 'Тепловой контур',
    subtitle: 'Передача тепла · 5 объектов',
    source: `import { project, system, simulation, pipe } from "@saturn/core";

const water = system("thermal", "Тепловой контур");

const reservoir = simulation("TK-02", "reservoir", {
  system: water.id,
  at: { x: 40, y: 240 },
  inputs: { inflow: 0.08, demand: 0.1 },
  parameters: { initialLevel: 0.82 },
});

const motor = simulation("P-02", "pump", {
  system: water.id,
  at: { x: 330, y: 328 },
  inputs: { voltage: 0.85, resistance: 1 },
});

const heater = simulation("HX-01", "heat-exchanger", {
  system: water.id,
  at: { x: 620, y: 197 },
  inputs: { heat: 0.45, cooling: motor.flow },
});

const gate = simulation("V-02", "motor-valve", {
  system: water.id,
  at: { x: 880, y: 180 },
  inputs: { demand: 0.65, pressure: 1 },
});

const receiver = simulation("TK-03", "reservoir", {
  system: water.id,
  at: { x: 1130, y: 250 },
  inputs: { inflow: gate.flow, demand: 0.04 },
  parameters: { initialLevel: 0.5 },
});

const suction = pipe("PIPE-201", reservoir.ports.outlet, motor.ports.inlet);
const supply = pipe("PIPE-202", motor.ports.outlet, heater.ports.inlet);
const regulated = pipe("PIPE-203", heater.ports.outlet, gate.ports.inlet);
const returnLine = pipe("PIPE-204", gate.ports.outlet, receiver.ports.inlet);

export default project("thermal-loop", {
  title: "Тепловой контур",
  description: "Учебный контур переноса тепла",
  systems: [water],
  simulations: [reservoir, motor, heater, gate, receiver],
  connections: [suction, supply, regulated, returnLine],
  signals: [],
  alarms: [],
  reports: [],
});
`,
  },
} as const;

export type ExampleId = keyof typeof examples;

export const emptySource = `import { project, system } from "@saturn/core";

const process = system("process", "Новая установка");

export default project("new-installation", {
  title: "Новая установка",
  description: "",
  systems: [process],
  simulations: [],
  connections: [],
  signals: [],
  alarms: [],
  reports: [],
});
`;

export interface LocalProject {
  id: string;
  title: string;
  source: string;
  updatedAt: string;
  files?: Record<string, string>;
}
export interface WorkspaceState {
  version: 2;
  active: { kind: 'example'; id: ExampleId } | { kind: 'project'; id: string };
  drafts: Record<ExampleId, string>;
  projects: LocalProject[];
}

export const workspaceKey = 'saturn.shell.workspace.v1';

export function createWorkspace(): WorkspaceState {
  return {
    version: 2,
    active: { kind: 'example', id: 'pump' },
    drafts: { pump: examples.pump.source, thermal: examples.thermal.source },
    projects: [],
  };
}

export function parseWorkspace(raw: string): WorkspaceState {
  const value = JSON.parse(raw);
  if (value?.version === 1) {
    value.version = 2;
    // Built-in examples are product code, not user documents. Never keep a stale
    // historical DSL snapshot in localStorage after the canonical DSL changes.
    value.drafts = { pump: examples.pump.source, thermal: examples.thermal.source };
  }
  if (value?.version !== 2 || !Array.isArray(value.projects) || value.projects.length > 100 ||
    !['pump', 'thermal'].every(id => typeof value.drafts?.[id] === 'string' && value.drafts[id].length <= 120000) ||
    !value.projects.every((p: LocalProject) => typeof p.id === 'string' && typeof p.title === 'string' && p.title.length <= 80 && typeof p.source === 'string' && p.source.length <= (p.files ? 200000 : 120000) && typeof p.updatedAt === 'string' && validProjectFiles(p.files)) ||
    new Set(value.projects.map((p: LocalProject) => p.id)).size !== value.projects.length ||
    !(value.active?.kind === 'example' && Object.hasOwn(examples, value.active.id) || value.active?.kind === 'project' && value.projects.some((p: LocalProject) => p.id === value.active.id))) {
    throw new Error('Не удалось прочитать сохранённые проекты');
  }
  return value;
}

export function currentDocument(state: WorkspaceState): { title: string; source: string; files?: Record<string, string> } {
  if (state.active.kind === 'example') {
    const source = state.drafts[state.active.id];
    return { title: examples[state.active.id].title, source, files: { 'plant.ts': source } };
  }
  const project = state.projects.find(p => p.id === state.active.id);
  if (!project) throw new Error('Проект не найден');
  return project;
}

export function updateSource(state: WorkspaceState, source: string) {
  if (state.active.kind === 'example') state.drafts[state.active.id] = source;
  else {
    const project = state.projects.find(p => p.id === state.active.id)!;
    project.source = source;
    project.updatedAt = new Date().toISOString();
  }
}

export function createProject(state: WorkspaceState, title: string, source: string, id = crypto.randomUUID()): LocalProject {
  if (!title.trim() || title.trim().length > 80) throw new Error('Введите название от 1 до 80 символов');
  if (state.projects.length >= 100) throw new Error('Достигнут лимит 100 локальных проектов. Скачайте исходник.');
  const project = { id, title: title.trim(), source, updatedAt: new Date().toISOString() };
  state.projects.push(project);
  state.active = { kind: 'project', id };
  return project;
}

export function validProjectFiles(files: unknown): files is Record<string, string> | undefined {
  if (files === undefined) return true;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return false;
  const entries = Object.entries(files);
  return (Object.hasOwn(files, 'plant.ts') || Object.hasOwn(files, 'station.ts')) &&
    entries.length > 0 && entries.length <= 128 &&
    entries.every(([p, s]) => /^[A-Za-z0-9_/-]+\.(ts|sql|html|md|json|css)$/.test(p) &&
      !p.startsWith('/') && !p.split('/').some(x => !x || x === '.' || x === '..') &&
      typeof s === 'string' && !s.includes('\0') && s.length <= 200000) &&
    entries.reduce((n, [, s]) => n + new TextEncoder().encode(s as string).length, 0) <= 2000000;
}

export function updateFiles(state: WorkspaceState, files: Record<string, string>) {
  if (!validProjectFiles(files)) throw new Error('Неверные файлы проекта');
  if (state.active.kind === 'example') {
    const source = files['plant.ts'];
    if (typeof source !== 'string') throw new Error('У примера отсутствует plant.ts');
    state.drafts[state.active.id] = source;
    return;
  }
  const project = state.projects.find(p => p.id === state.active.id)!;
  project.files = { ...files };
  project.source = files['plant.ts'] ?? files['station.ts'];
  project.updatedAt = new Date().toISOString();
}
