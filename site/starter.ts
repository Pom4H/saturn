/** The downloadable example is compiled by the actual Saturn compiler in site:check. */
export const starter: Record<string, string> = {
  'plant.ts': `import { project, system } from '@scada/plant';
import { drive, pump } from './equipment';
import { screen } from './views';

export default project('first-pump', {
  title: 'Моя первая установка',
  description: 'Учебный насосный стенд',
  systems: [system('loop', 'Циркуляция')],
  simulations: [pump],
  controls: [drive],
  views: [screen],
  signals: [], alarms: [], reports: [],
});
`,
  'equipment.ts': `import { control, simulation } from '@scada/plant';

export const drive = control('drive', {
  title: 'Скорость насоса', system: 'loop',
  min: 0, max: 1, initial: 0.64, rate: 0.25,
});

export const pump = simulation('PUMP-01', 'pump', {
  system: 'loop',
  at: { x: 240, y: 160 },
  inputs: { voltage: drive.value },
  parameters: { inertia: 1.6 },
});
`,
  'views.ts': `import {
  view, panel, readout, commandButton,
} from '@scada/plant';
import { pump } from './equipment';

export const screen = view('operator', {
  title: 'Насосная станция',
  bindings: { rpm: pump.rpm, flow: pump.flow },
  body: panel([
    readout('Обороты', 'rpm', 'об/мин', 0),
    readout('Поток', 'flow', 'отн.'),
    commandButton('Пуск', 'drive', 0.64),
    commandButton('Стоп', 'drive', 0),
  ]),
});
`,
  'README.md': `# Первая установка Saturn

Откройте автономную демонстрацию Saturn. В разделе «Проект» импортируйте
этот JSON, проверьте исходники, сохраните ревизию и опубликуйте её.
Импорт заменит текущий черновик: сначала экспортируйте свой проект.

- plant.ts — точка входа, состав проекта.
- equipment.ts — модель насоса и команда оператора.
- views.ts — операторский экран, привязанный к тем же сигналам.

Это учебная симуляция. Пример не подключается к физическому оборудованию.
TypeScript DSL декларативный: const, named imports и функции Saturn.
Не используйте произвольные JS-функции, циклы или сетевые импорты.
`,
};
