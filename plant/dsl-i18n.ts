import type { SaturnLocale } from './diagnostics';
import { entities, operators, type DslEntity } from './dsl-reference';

type Translation = { summary: string; note?: string };

const en: Record<string, Translation> = {
  project: { summary: 'Project root. Collects systems, models, signals, PLCs, topology, controls, presentations, alarms and reports into one validated Project IR.' },
  system: { summary: 'Hierarchical installation group used for navigation and equipment membership without creating another simulation.' },
  simulation: { summary: 'Instance of an installed dynamic model. Outputs carry literal ID, value type, unit and physical dimension; inputs are checked by TypeScript.' },
  equipment: { summary: 'Visual/engineering representation of an object bound to signals. It does not have to own a dynamic model.' },
  signal: { summary: 'Stable signal reference. Known outputs carry literal ID, value type, unit and dimension; signal(path) is an explicit dimension=unknown escape hatch.' },
  derived: { summary: 'Named computed signal derived from existing expressions without hidden state.' },
  bank: { summary: 'Compact declaration of repeated equipment that expands into ordinary instances with stable IDs before runtime.' },
  aggregate: { summary: 'Aggregates one numeric output from a model group and preserves its physical dimension through mean/sum/min/max.' },
  control: { summary: 'Operator setpoint with requested/value/blocked signals. Runtime commands change state, not project source.' },
  port: { summary: 'Dynamic port lookup escape hatch. Normal authored TypeScript should prefer typed refs such as pump.ports.inlet.' },
  pipe: { summary: 'High-level physical fluid connection between compatible typed ports.', note: 'Use pipe() for physical fluid topology; geometry, visualization and runtime consume the same Connection.' },
  cable: { summary: 'Physical power, control or bus connection. Medium and electrical family participate in typing.' },
  expansion: { summary: 'Attaches an expansion module to a controller and a physical slot.' },
  plc: { summary: 'Controller as a project entity: physical I/O, FBD outputs and local HMI keep one stable identity.' },
  pin: { summary: 'Typed reference to a local PLC terminal/signal inside a controller program.' },
  block: { summary: 'Stable reference to a named PLC function block output.' },
  functionBlock: { summary: 'Declarative FBD block. Compiler validates supported type, inputs, parameters and cycles.' },
  alarm: { summary: 'Operator alarm rule over a signal expression with thresholds, delay, priority and notification policy.' },
  reportField: { summary: 'Carries a SignalRef literal ID, value type and unit into a typed report row schema.' },
  numberField: { summary: 'Numeric SQL-result field that is not directly tied to one signal.' },
  booleanField: { summary: 'Boolean report-result field.' },
  textField: { summary: 'String report-result field.' },
  dateTimeField: { summary: 'Date/time report-result field for typed presentation and export.' },
  reportSchema: { summary: 'Named typed row schema for a SQL report; field keys become available through IntelliSense.' },
  reportColumn: { summary: 'HTML/PDF report column bound to an existing typed field without a string key.' },
  excelColumn: { summary: 'Excel column bound to a typed field. TypeScript restricts formatting according to the field value type.' },
  asc: { summary: 'Ascending Excel sort over a typed field.' },
  desc: { summary: 'Descending Excel sort over a typed field.' },
  excelSheet: { summary: 'Excel sheet definition over one typed row schema: columns, sorts, frozen rows and autofilter.' },
  workbook: { summary: 'Serializable Excel workbook definition stored with report() and consumable by a server renderer.' },
  report: { summary: 'Versioned report: inputs, time window, bounded SQL capsule, presentation and schedule.' },
  view: { summary: 'Serializable presentation blueprint for live UI, reports or constrained PLC targets.' },
  panel: { summary: 'Groups presentation nodes without binding them to a particular renderer.' },
  readout: { summary: 'Numeric indicator reading one named view binding.' },
  label: { summary: 'Static text inside the serializable presentation tree.' },
  dataTable: { summary: 'Tabular presentation of report rows using declared columns.' },
  trend: { summary: 'Chart over two result columns using the same presentation contract as reports.' },
  commandButton: { summary: 'Operator action node. Runtime adapter performs the side effect; UI callbacks are not embedded in project source.' },
};

export interface LocalizedDslEntity extends Omit<DslEntity, 'summary' | 'note'> {
  summary: string;
  note?: string;
}

export function localizedDslEntities(locale: SaturnLocale): LocalizedDslEntity[] {
  return entities.map(entity => {
    if (locale === 'ru') return { ...entity };
    const translation = en[entity.name];
    return {
      ...entity,
      summary: translation?.summary ?? entity.summary,
      ...(translation?.note ? { note: translation.note } : entity.note ? { note: entity.note } : {}),
    };
  });
}

export function localizedDslEntity(name: string, locale: SaturnLocale): LocalizedDslEntity | undefined {
  return localizedDslEntities(locale).find(entity => entity.name === name);
}

export function localizedDslOperators() {
  return operators.map(([name, signature]) => ({ name, signature }));
}
