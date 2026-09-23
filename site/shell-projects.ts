/** Local projects use the same source document as the landing preview. */
export const examples = {
  pump: {
    title: 'Насосная станция', subtitle: 'Подача воды · 5 объектов',
    source: `import { tank, pump, valve, flowmeter, outlet, pipe } from "@saturn/core";

// Первый проект начинается с работающего примера.
const reservoir = tank("TK-01", { x: 40, y: 180, level: 68 });
const motor = pump("P-01", { x: 330, y: 268, rpm: 1850 });
const meter = flowmeter("FT-01", { x: 655, y: 160 });
const gate = valve("V-01", { x: 865, y: 96, opening: 80 });
const system = outlet("OUT-01", { x: 1150, y: 178 });

pipe("PIPE-101", reservoir.outlet, motor.inlet);
pipe("PIPE-102", motor.outlet, meter.inlet);
pipe("PIPE-103", meter.outlet, gate.inlet);
pipe("PIPE-104", gate.outlet, system.inlet);
`,
  },
  thermal: {
    title: 'Тепловой контур', subtitle: 'Передача тепла · 6 объектов',
    source: `import { tank, pump, valve, exchanger, outlet, temperature, pipe, tap } from "@saturn/core";

const reservoir = tank("TK-02", { x: 40, y: 240, level: 82 });
const motor = pump("P-02", { x: 330, y: 328, rpm: 1450 });
const gate = valve("V-02", { x: 650, y: 180, opening: 65 });
const heater = exchanger("HX-01", { x: 925, y: 197, temperature: 72 });
const system = outlet("OUT-02", { x: 1260, y: 262 });
pipe("PIPE-201", reservoir.outlet, motor.inlet);
pipe("PIPE-202", motor.outlet, gate.inlet);
pipe("PIPE-203", gate.outlet, heater.inlet);
const supply = pipe("PIPE-204", heater.outlet, system.inlet);
tap(supply, temperature("TT-01", { value: 72, at: 0.5, offset: 110 }));
`,
  },
} as const;
export type ExampleId = keyof typeof examples;
export const emptySource = `import { tank, pump, valve, flowmeter, exchanger, outlet, pipe } from "@saturn/core";

// Добавьте оборудование из каталога или опишите установку здесь.
`;
export interface LocalProject { id: string; title: string; source: string; updatedAt: string; files?: Record<string, string>; }
export interface WorkspaceState {
  version: 1;
  active: { kind: 'example'; id: ExampleId } | { kind: 'project'; id: string };
  drafts: Record<ExampleId, string>;
  projects: LocalProject[];
}
export const workspaceKey = 'saturn.shell.workspace.v1';
export function createWorkspace(): WorkspaceState {
  return { version: 1, active: { kind: 'example', id: 'pump' }, drafts: { pump: examples.pump.source, thermal: examples.thermal.source }, projects: [] };
}
export function parseWorkspace(raw: string): WorkspaceState {
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !Array.isArray(value.projects) || value.projects.length > 100 ||
    !['pump', 'thermal'].every(id => typeof value.drafts?.[id] === 'string' && value.drafts[id].length <= 120000) ||
    !value.projects.every((p: LocalProject) => typeof p.id === 'string' && typeof p.title === 'string' && p.title.length <= 80 && typeof p.source === 'string' && p.source.length <= (p.files ? 200000 : 120000) && typeof p.updatedAt === 'string' && validProjectFiles(p.files)) ||
    new Set(value.projects.map((p: LocalProject) => p.id)).size !== value.projects.length ||
    !(value.active?.kind === 'example' && Object.hasOwn(examples, value.active.id) || value.active?.kind === 'project' && value.projects.some((p: LocalProject) => p.id === value.active.id))) {
    throw new Error('Не удалось прочитать сохранённые проекты');
  }
  return value;
}
export function currentDocument(state: WorkspaceState): { title: string; source: string; files?: Record<string, string> } {
  if (state.active.kind === 'example') return { title: examples[state.active.id].title, source: state.drafts[state.active.id] };
  const project = state.projects.find(p => p.id === state.active.id);
  if (!project) throw new Error('Проект не найден');
  return project;
}
export function updateSource(state: WorkspaceState, source: string) {
  if (state.active.kind === 'example') state.drafts[state.active.id] = source;
  else {
    const project = state.projects.find(p => p.id === state.active.id)!;
    project.source = source; project.updatedAt = new Date().toISOString();
  }
}
export function createProject(state: WorkspaceState, title: string, source: string, id = crypto.randomUUID()): LocalProject {
  if (!title.trim() || title.trim().length > 80) throw new Error('Введите название от 1 до 80 символов');
  if (state.projects.length >= 100) throw new Error('Достигнут лимит 100 локальных проектов. Скачайте исходник.');
  const project = { id, title: title.trim(), source, updatedAt: new Date().toISOString() };
  state.projects.push(project); state.active = { kind: 'project', id };
  return project;
}

export function validProjectFiles(files: unknown): files is Record<string, string> | undefined {
  if (files === undefined) return true;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return false;
  const entries = Object.entries(files);
  return (Object.hasOwn(files, 'plant.ts') || Object.hasOwn(files, 'station.ts')) && entries.length > 0 && entries.length <= 128 && entries.every(([p,s]) => /^[A-Za-z0-9_/-]+\.(ts|sql|html|md|json|css)$/.test(p) && !p.startsWith('/') && !p.split('/').some(x => !x || x === '.' || x === '..') && typeof s === 'string' && !s.includes('\0') && s.length <= 200000) && entries.reduce((n,[,s]) => n + new TextEncoder().encode(s as string).length, 0) <= 2000000;
}
export function updateFiles(state: WorkspaceState, files: Record<string, string>) {
  if (!validProjectFiles(files)) throw new Error('Неверные файлы проекта');
  if (state.active.kind !== 'project') { updateSource(state, files['station.ts']); return; }
  const project = state.projects.find(p => p.id === state.active.id)!;
  project.files = { ...files }; project.source = files['plant.ts'] ?? files['station.ts']; project.updatedAt = new Date().toISOString();
}
