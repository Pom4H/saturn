import type { SaturnLocale } from './diagnostics';

export const textCatalog = {
  'model.supply': { en:'Power supply', ru:'Электропитание' },
  'model.pump': { en:'Circulation pump', ru:'Циркуляционный насос' },
  'model.feedback-source': { en:'Active core · aggregate', ru:'Активная зона · агрегат' },
  'model.channel': { en:'Fuel channel', ru:'Топливный канал' },
  'model.separator': { en:'Drum separator', ru:'Барабан-сепаратор' },
  'model.turbine': { en:'Turbine', ru:'Турбина' },
  'model.heat-exchanger': { en:'Condenser', ru:'Конденсатор' },
  'model.sensor': { en:'Measurement channel', ru:'Измерительный канал' },
  'model.protection': { en:'Protection and absorber', ru:'Защита и поглотитель' },
  'model.structure': { en:'Reactor building', ru:'Реакторное здание' },
  'model.reservoir': { en:'Buffer tank', ru:'Буферная ёмкость' },
  'model.motor-valve': { en:'Control valve', ru:'Регулирующий клапан' },
  'model.ups': { en:'Backup power', ru:'Резервное питание' },
  'model.switchgear': { en:'Power switchgear', ru:'Щит питания' },
  'model.fan': { en:'Ventilation and heat removal', ru:'Вентиляция и теплоотвод' },
  'model.electric-motor': { en:'Electric drive', ru:'Электропривод' },
  'model.cooling-tower': { en:'Circulating-water cooler', ru:'Охладитель оборотной воды' },
  'model.strainer': { en:'Strainer', ru:'Сетчатый фильтр' },
  'model.check-valve': { en:'Check valve', ru:'Обратный клапан' },
  'model.expansion-vessel': { en:'Expansion vessel', ru:'Расширительный бак' },
  'model.relief-valve': { en:'Relief valve', ru:'Предохранительный клапан' },
  'model.transformer': { en:'Transformer', ru:'Трансформатор' },
  'model.alternator': { en:'Turbogenerator', ru:'Турбогенератор' },
  'model.thermal-store': { en:'Thermal training unit', ru:'Тепловой учебный агрегат' },
  'model.dc-supply': { en:'24 V DC supply · bench', ru:'Источник 24 V DC · стенд' },
  'model.transmitter': { en:'Measurement transmitter', ru:'Измерительный преобразователь' },
  'model.contactor': { en:'Intermediate relay · bench', ru:'Промежуточное реле · стенд' },
  'model.indicator': { en:'Indicator lamp · bench', ru:'Сигнальная лампа · стенд' },
  'model.io-module': { en:'Virtual AI4 module · non-hardware profile', ru:'Виртуальный модуль AI4 · не аппаратный профиль' },
  'model.junction': { en:'Tee · diagram', ru:'Тройник · схема' },
  'model.saturn-plc': { en:'Saturn PLC · FBD', ru:'Saturn PLC · FBD' },

  'report.badQuality': { en:'unknown-quality intervals are not zero; data time is model time', ru:'интервалы неизвестного качества не равны нулю; время данных — модельное' },
  'report.revision': { en:'Revision', ru:'Ревизия' },
  'report.run': { en:'Run', ru:'Прогон' },
  'report.simulation': { en:'SIMULATION', ru:'СИМУЛЯЦИЯ' },

  'presentation.noReliableData': { en:'no reliable data', ru:'нет достоверных данных' },
  'presentation.commandUnavailable': { en:'Command is unavailable in a report snapshot', ru:'Команда недоступна в снимке отчёта' },

  'hmi.yes': { en:'YES', ru:'ДА' },
  'hmi.no': { en:'NO', ru:'НЕТ' },
  'hmi.on': { en:'ON', ru:'ВКЛ' },
  'hmi.off': { en:'OFF', ru:'ВЫКЛ' },
} as const;

export type TextKey = keyof typeof textCatalog;

export function text(key: TextKey, locale: SaturnLocale = 'en'): string {
  return textCatalog[key][locale] ?? textCatalog[key].en;
}

export function modelTitleKey(kind: string): TextKey {
  const key = `model.${kind}` as TextKey;
  return Object.hasOwn(textCatalog, key) ? key : 'model.saturn-plc';
}

export function modelTitle(kind: string, locale: SaturnLocale = 'en'): string {
  return text(modelTitleKey(kind), locale);
}

export function localeFromLanguage(value: string | undefined | null): SaturnLocale {
  return value?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}
