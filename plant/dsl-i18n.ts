import type { SaturnLocale } from './diagnostics';
import { entities, operators, type DslEntity } from './dsl-reference';

type Translation = { summary: string; note?: string };
const docs: Record<string, Record<SaturnLocale, Translation>> = {
  project: { en:{ summary:'Project root. Collects systems, models, signals, PLCs, topology, controls, presentations, alarms and reports into one validated Project IR.' }, ru:{ summary:'Корень проекта. Собирает системы, модели, сигналы, PLC, соединения, управление, представления, алармы и отчёты в один проверяемый Project IR.' } },
  system: { en:{ summary:'Hierarchical installation group used for navigation and equipment membership without creating another simulation.' }, ru:{ summary:'Иерархическая группа установки. Даёт навигацию и принадлежность оборудования, но не создаёт отдельную копию симуляции.' } },
  simulation: { en:{ summary:'Instance of an installed dynamic model. Outputs carry literal ID, value type, unit and physical dimension; inputs are checked by TypeScript.' }, ru:{ summary:'Экземпляр установленной динамической модели. Выходы несут literal ID, value type, unit и physical dimension; входы проверяют совместимость этих типов ещё в TypeScript.' } },
  equipment: { en:{ summary:'Visual/engineering representation of an object bound to signals. It does not have to own a dynamic model.' }, ru:{ summary:'Визуальное/инженерное представление объекта, привязанное к сигналам. Не обязано иметь собственную динамическую модель.' } },
  signal: { en:{ summary:'Stable signal reference. Known outputs carry literal ID, value type, unit and dimension; signal(path) is an explicit dimension=unknown escape hatch.' }, ru:{ summary:'Стабильная ссылка на сигнал по ID. Известные выходы simulation/control/PLC несут literal ID, value type, unit и dimension; строковый signal(path) остаётся явным escape hatch с dimension=unknown.' } },
  derived: { en:{ summary:'Named computed signal derived from existing expressions without hidden state.' }, ru:{ summary:'Именованный вычисляемый сигнал. Не создаёт скрытое состояние: значение получается из выражения над существующими сигналами.' } },
  bank: { en:{ summary:'Compact declaration of repeated equipment that expands into ordinary instances with stable IDs before runtime.' }, ru:{ summary:'Компактно объявляет повторяющееся оборудование, но перед runtime разворачивается в обычные экземпляры со стабильными ID.' } },
  aggregate: { en:{ summary:'Aggregates one numeric output from a model group and preserves its physical dimension through mean/sum/min/max.' }, ru:{ summary:'Агрегирует только числовой выход группы моделей и сохраняет его physical dimension через mean/sum/min/max.' } },
  control: { en:{ summary:'Operator setpoint with requested/value/blocked signals. Runtime commands change state, not project source.' }, ru:{ summary:'Операторская уставка с requested/value/blocked. Команда меняет runtime state, а не исходник проекта.' } },
  port: { en:{ summary:'Dynamic port lookup escape hatch. Normal authored TypeScript should prefer typed refs such as pump.ports.inlet.' }, ru:{ summary:'Динамический escape hatch для ссылки на порт по имени. В обычном TypeScript-коде предпочитайте типизированные refs вроде pump.ports.inlet.' } },
  pipe: { en:{ summary:'High-level physical fluid connection between compatible typed ports.', note:'Use pipe() for physical fluid topology; geometry, visualization and runtime consume the same Connection.' }, ru:{ summary:'Высокоуровневая технологическая связь между двумя портами. Семантика medium = pipe фиксирована самим конструктором.', note:'Предпочтительный уровень для технологической схемы: проект говорит «это труба», а геометрия, визуализация и runtime получают единый Connection.' } },
  cable: { en:{ summary:'Physical power, control or bus connection. Medium and electrical family participate in typing.' }, ru:{ summary:'Физическая электрическая, управляющая или шинная связь. Medium задаётся явно в options.' } },
  expansion: { en:{ summary:'Attaches an expansion module to a controller and a physical slot.' }, ru:{ summary:'Привязывает модуль расширения к контроллеру и физическому слоту.' } },
  plc: { en:{ summary:'Controller as a project entity: physical I/O, FBD outputs and local HMI keep one stable identity.' }, ru:{ summary:'Контроллер как часть проекта: физические I/O, вычисляемые выходы, FBD-блоки и локальный HMI остаются привязаны к одному стабильному ID.' } },
  pin: { en:{ summary:'Typed reference to a local PLC terminal/signal inside a controller program.' }, ru:{ summary:'Ссылка на локальную клемму/сигнал PLC внутри программы контроллера.' } },
  block: { en:{ summary:'Stable reference to a named PLC function block output.' }, ru:{ summary:'Стабильная ссылка на выход именованного функционального блока.' } },
  functionBlock: { en:{ summary:'Declarative FBD block. Compiler validates supported type, inputs, parameters and cycles.' }, ru:{ summary:'Декларативный FBD-блок контроллера. Компилятор проверяет тип, входы, параметры и циклы.' } },
  alarm: { en:{ summary:'Operator alarm rule over a signal expression with thresholds, delay, priority and notification policy.' }, ru:{ summary:'Правило операторского аларма поверх signal expression: пороги, задержка, приоритет и уведомление.' } },
  reportField: { en:{ summary:'Carries a SignalRef literal ID, value type and unit into a typed report row schema.' }, ru:{ summary:'Переносит literal ID, тип значения и единицу измерения SignalRef в типизированную схему строк отчёта.' } },
  numberField: { en:{ summary:'Numeric SQL-result field that is not directly tied to one signal.' }, ru:{ summary:'Числовое поле результата SQL, которое не связано напрямую с одним сигналом.' } },
  booleanField: { en:{ summary:'Boolean report-result field.' }, ru:{ summary:'Логическое поле результата отчёта.' } },
  textField: { en:{ summary:'String report-result field.' }, ru:{ summary:'Строковое поле результата отчёта.' } },
  dateTimeField: { en:{ summary:'Date/time report-result field for typed presentation and export.' }, ru:{ summary:'Поле даты/времени для типизированного представления и экспорта.' } },
  reportSchema: { en:{ summary:'Named typed row schema for a SQL report; field keys become available through IntelliSense.' }, ru:{ summary:'Именованная типизированная схема строк SQL-отчёта; ключи становятся доступными через IntelliSense.' } },
  reportColumn: { en:{ summary:'HTML/PDF report column bound to an existing typed field without a string key.' }, ru:{ summary:'Колонка HTML/PDF-представления, привязанная к существующему полю схемы без строкового key.' } },
  excelColumn: { en:{ summary:'Excel column bound to a typed field. TypeScript restricts formatting according to the field value type.' }, ru:{ summary:'Колонка Excel-артефакта. TypeScript ограничивает форматирование по типу поля.' } },
  asc: { en:{ summary:'Ascending Excel sort over a typed field.' }, ru:{ summary:'Сортировка Excel-таблицы по типизированному полю по возрастанию.' } },
  desc: { en:{ summary:'Descending Excel sort over a typed field.' }, ru:{ summary:'Сортировка Excel-таблицы по типизированному полю по убыванию.' } },
  excelSheet: { en:{ summary:'Excel sheet definition over one typed row schema: columns, sorts, frozen rows and autofilter.' }, ru:{ summary:'Описание листа Excel поверх той же схемы строк: колонки, сортировки, freeze rows и autofilter.' } },
  workbook: { en:{ summary:'Serializable Excel workbook definition stored with report() and consumable by a server renderer.' }, ru:{ summary:'Сериализуемая структура Excel-книги, хранящаяся вместе с report() и пригодная для серверного renderer.' } },
  report: { en:{ summary:'Versioned report: inputs, time window, bounded SQL capsule, presentation and schedule.' }, ru:{ summary:'Версионируемый отчёт: входные параметры, окно данных, SQL над ограниченной капсулой, таблица/график и расписание.' } },
  view: { en:{ summary:'Serializable presentation blueprint for live UI, reports or constrained PLC targets.' }, ru:{ summary:'Сериализуемое представление данных для live UI, отчёта или ограниченного PLC target. Не содержит React callbacks.', note:'Presentation — текущий общий serializable UI contract. Новые renderer-specific модели не должны создавать второй тип сигнала или второй project IR.' } },
  panel: { en:{ summary:'Groups presentation nodes without binding them to a particular renderer.' }, ru:{ summary:'Группирует presentation nodes без привязки к конкретному renderer.' } },
  readout: { en:{ summary:'Numeric indicator reading one named view binding.' }, ru:{ summary:'Числовой индикатор, который читает именованный binding из view.' } },
  label: { en:{ summary:'Static text inside the serializable presentation tree.' }, ru:{ summary:'Статический текст внутри сериализуемого presentation tree.' } },
  dataTable: { en:{ summary:'Tabular presentation of report rows using declared columns.' }, ru:{ summary:'Табличное представление строк отчёта по объявленному набору колонок.' } },
  trend: { en:{ summary:'Chart over two result columns using the same presentation contract as reports.' }, ru:{ summary:'График по двум колонкам набора данных. Использует тот же presentation contract, что и отчёт.' } },
  commandButton: { en:{ summary:'Operator action node. Runtime adapter performs the side effect; UI callbacks are not embedded in project source.' }, ru:{ summary:'Операторское действие в сериализуемом presentation tree. Побочный эффект выполняет runtime adapter, а не UI callback.' } },
};

export interface LocalizedDslEntity extends Omit<DslEntity, 'textKey'> {
  summary: string;
  note?: string;
}

export function localizedDslEntities(locale: SaturnLocale): LocalizedDslEntity[] {
  return entities.map(entity => {
    const translation = docs[entity.textKey]?.[locale] ?? docs[entity.textKey]?.en;
    if (!translation) throw new Error(`Missing DSL translation: ${entity.textKey} (${locale})`);
    const { textKey: _textKey, ...stable } = entity;
    return { ...stable, ...translation };
  });
}

export function localizedDslEntity(name: string, locale: SaturnLocale): LocalizedDslEntity | undefined {
  return localizedDslEntities(locale).find(entity => entity.name === name);
}

export function localizedDslOperators() {
  return operators.map(([name, signature]) => ({ name, signature }));
}
