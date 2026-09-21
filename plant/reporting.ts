import {
    signalInfo,
    type ExcelColumnSpec,
    type ExcelSheetSpec,
    type ExcelSortSpec,
    type ExcelWorkbookSpec,
    type ReportField,
    type ReportValueType,
    type Scalar,
    type SignalRef,
    type SignalUnitOf,
    type SignalValueOf,
} from './types';
import { failCode } from './diagnostics';

declare const fieldValue: unique symbol;
export interface ReportFieldRef<Key extends string = string, Value = unknown, Unit extends string = string> {
    readonly key: Key;
    readonly type: ReportValueType;
    readonly unit: Unit;
    readonly [fieldValue]?: Value;
}

type UnkeyedField = ReportFieldRef<'', unknown, string>;
type Keyed<F, K extends string> = F extends ReportFieldRef<string, infer Value, infer Unit>
    ? ReportFieldRef<K, Value, Unit>
    : never;

export type ReportSchema<Definition extends Record<string, UnkeyedField> = Record<string, UnkeyedField>> = {
    readonly [K in keyof Definition]: Keyed<Definition[K], K & string>;
};

const schemaMetadata = Symbol('saturn.report.schema');

export function reportField<S extends SignalRef<string, Scalar, string>>(signal: S): ReportFieldRef<'', SignalValueOf<S>, SignalUnitOf<S>> {
    const metadata = signalInfo(signal);
    return { key: '', type: metadata.type, unit: metadata.unit } as ReportFieldRef<'', SignalValueOf<S>, SignalUnitOf<S>>;
}

export function numberField<const Unit extends string = ''>(unit?: Unit): ReportFieldRef<'', number, Unit> {
    return { key: '', type: 'number', unit: (unit ?? '') as Unit };
}

export function booleanField(): ReportFieldRef<'', boolean, ''> {
    return { key: '', type: 'boolean', unit: '' };
}

export function textField(): ReportFieldRef<'', string, ''> {
    return { key: '', type: 'string', unit: '' };
}

export function dateTimeField(): ReportFieldRef<'', Date, ''> {
    return { key: '', type: 'datetime', unit: '' };
}

export function reportSchema<const Definition extends Record<string, UnkeyedField>>(definition: Definition): ReportSchema<Definition> {
    const result: Record<string, ReportFieldRef> = {};
    for (const [key, field] of Object.entries(definition))
        result[key] = { key, type: field.type, unit: field.unit };
    Object.defineProperty(result, schemaMetadata, {
        value: Object.values(result).map(field => ({ key: field.key, type: field.type, ...(field.unit ? { unit: field.unit } : {}) })),
        enumerable: false,
    });
    return result as ReportSchema<Definition>;
}

export function reportSchemaFields(schema: ReportSchema<Record<string, UnkeyedField>>): ReportField[] {
    return (schema as ReportSchema<Record<string, UnkeyedField>> & { [schemaMetadata]?: ReportField[] })[schemaMetadata]
        ?? Object.entries(schema).map(([key, field]) => ({ key, type: field.type, ...(field.unit ? { unit: field.unit } : {}) }));
}

type FieldValue<F> = F extends ReportFieldRef<string, infer Value, string> ? Value : never;
type ExcelColumnOptions<F extends ReportFieldRef> = {
    width?: number;
} & (FieldValue<F> extends number | Date ? { format?: string } : { format?: never });

export function reportColumn<F extends ReportFieldRef>(title: string, field: F): { key: F['key']; title: string; unit?: F['unit'] } {
    return { key: field.key, title, ...(field.unit ? { unit: field.unit } : {}) } as { key: F['key']; title: string; unit?: F['unit'] };
}

export function excelColumn<F extends ReportFieldRef>(title: string, field: F, options: ExcelColumnOptions<F> = {} as ExcelColumnOptions<F>): ExcelColumnSpec {
    return { key: field.key, title, ...(field.unit ? { unit: field.unit } : {}), ...options };
}

export function asc<F extends ReportFieldRef>(field: F): ExcelSortSpec {
    return { key: field.key, direction: 'asc' };
}

export function desc<F extends ReportFieldRef>(field: F): ExcelSortSpec {
    return { key: field.key, direction: 'desc' };
}

export function excelSheet(
    name: string,
    schema: ReportSchema<Record<string, UnkeyedField>>,
    options: { columns: ExcelColumnSpec[]; sort?: ExcelSortSpec[]; freezeRows?: number; autoFilter?: boolean },
): ExcelSheetSpec {
    const keys = new Set(reportSchemaFields(schema).map(field => field.key));
    for (const column of options.columns)
        if (!keys.has(column.key)) failCode('SATURN_REPORT_INVALID',{report:'workbook',reason:'unknown'},{field:'excel.column',key:column.key});
    for (const sort of options.sort ?? [])
        if (!keys.has(sort.key)) failCode('SATURN_REPORT_INVALID',{report:'workbook',reason:'unknown'},{field:'excel.sort',key:sort.key});
    return { name, ...options };
}

export function workbook(sheets: ExcelSheetSpec[]): ExcelWorkbookSpec {
    return { sheets };
}
