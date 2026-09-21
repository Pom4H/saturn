import { registerComponent } from '../../core';
import { deriveSchematicProjection } from '../../elements/model';
import { registry as elementRegistry } from '../../elements/core-elements';
const projection=deriveSchematicProjection(elementRegistry.get('process.filter.inline'),{}, {width:130,height:100});
registerComponent('filter', {
  version: '1.0.0', label: 'Фильтр', prefix: 'FLT', width: 130, height: 100,
  fields: {
    x: { scope: 'layout', label: 'X', default: 100, min: -3000, max: 6000 }, y: { scope: 'layout', label: 'Y', default: 100, min: -3000, max: 6000 },
    resistance: { label: 'Сопротивление', default: .1, min: 0, max: 1, step: .01, unit: 'доля' },
    quality: { label: 'Качество', default: 'good', choices: ['good', 'stale', 'bad'] },
    alarm: { label: 'Состояние', default: 'none', choices: ['none', 'warning', 'trip'] },
  },
  ports: projection.ports as any,
  signals: { flow: { label: 'Расход', type: 'number', unit: 'm3/h' }, differentialPressure: { label: 'Перепад давления', type: 'number', unit: 'bar' } },
  commands: { clean: { label: 'Очистить фильтр' } },
  visual: elementRegistry.get('process.filter.inline').visual,
});
