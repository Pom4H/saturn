/** These exact downloadable projects are checked by Saturn's compiler in site:check. */
export const bankCounts = [1, 4, 8] as const;
export function bankExample(count: number) {
  if (!bankCounts.some(value => value === count)) throw new Error('Unsupported example size');
  const source = `import { bank } from '@saturn/core';

export const pumps = bank('PUMP-', 'pump', {
  count: ${count},
  system: 'loop', at: { x: 0, y: 0 },
  columns: 4, pitch: { x: 240, y: 180 },
  parameters: { inertia: 1.6 },
});
`;
  const files: Record<string, string> = {
    'equipment.ts': source,
    'plant.ts': `import { project, system } from '@saturn/core';
import { pumps } from './equipment';
import { screen } from './views';

export default project('pump-bank', {
  title: 'Насосная группа',
  description: 'Повторяемое оборудование из одной декларации',
  systems: [system('loop', 'Насосная группа')],
  simulations: pumps,
  views: [screen],
  signals: [], alarms: [], reports: [],
});
`,
    'views.ts': `import { view, panel, readout, aggregate } from '@saturn/core';
import { pumps } from './equipment';

export const screen = view('operator', {
  title: 'Насосная группа',
  bindings: { flow: aggregate(pumps, 'flow', 'sum') },
  body: panel([
    readout('Общий поток', 'flow', 'отн.'),
  ]),
});
`,
    'README.md': `# Насосная группа Saturn

Измените count в equipment.ts, чтобы изменить размер группы.
bank создаёт отдельные модели PUMP-1 … PUMP-${count} с общими настройками.
views.ts суммирует их потоки и показывает результат на пульте.

Импортируйте JSON в разделе «Проект», проверьте исходники,
сохраните ревизию и опубликуйте её. Перед импортом экспортируйте
свой текущий проект: импорт заменяет черновик.

Это учебная симуляция независимых насосов, не физический стенд.
DSL использует декларативное подмножество TypeScript:
const, локальные импорты, массивы и функции Saturn.
`,
  };
  return { source, files };
}
