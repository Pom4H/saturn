import { failCode } from './diagnostics';

export type JsonObject = Record<string, unknown>;

export function objectValue(value: unknown, field = 'body'): JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        failCode('SATURN_HTTP_INVALID', { reason:'malformed' }, { field });
    return value as JsonObject;
}

export function stringValue(input: JsonObject, field: string): string {
    const value = input[field];
    if (typeof value !== 'string')
        failCode('SATURN_VALUE_INVALID', { field, reason:'invalid' }, { value });
    return value;
}

export function optionalStringValue(input: JsonObject, field: string): string | undefined {
    const value = input[field];
    if (value === undefined) return undefined;
    if (typeof value !== 'string')
        failCode('SATURN_VALUE_INVALID', { field, reason:'invalid' }, { value });
    return value;
}

export function nullableStringValue(input: JsonObject, field: string): string | null {
    const value = input[field];
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string')
        failCode('SATURN_VALUE_INVALID', { field, reason:'invalid' }, { value });
    return value;
}

export function finiteNumberValue(input: JsonObject, field: string): number | undefined {
    const value = input[field];
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value))
        failCode('SATURN_VALUE_INVALID', { field, reason:'invalid' }, { value });
    return value;
}

export function stringMapValue(value: unknown, field: string): Record<string,string> {
    const object = objectValue(value, field);
    for (const [key, item] of Object.entries(object))
        if (typeof item !== 'string')
            failCode('SATURN_VALUE_INVALID', { field: `${field}.${key}`, reason:'invalid' }, { value:item });
    return object as Record<string,string>;
}

export function numberMapValue(value: unknown, field: string): Record<string,number> {
    if (value === undefined) return {};
    const object = objectValue(value, field);
    for (const [key, item] of Object.entries(object))
        if (typeof item !== 'number' || !Number.isFinite(item))
            failCode('SATURN_VALUE_INVALID', { field: `${field}.${key}`, reason:'invalid' }, { value:item });
    return object as Record<string,number>;
}

export interface CommandInput {
    id: string;
    revision: string;
    action: string;
    runId?: string;
    target?: string;
    parameter?: string;
    value?: number;
}

export function commandValue(input: JsonObject): CommandInput {
    const runId = optionalStringValue(input,'runId');
    const target = optionalStringValue(input,'target');
    const parameter = optionalStringValue(input,'parameter');
    const value = finiteNumberValue(input,'value');
    return {
        id: stringValue(input,'id'),
        revision: stringValue(input,'revision'),
        action: stringValue(input,'action'),
        ...(runId === undefined ? {} : { runId }),
        ...(target === undefined ? {} : { target }),
        ...(parameter === undefined ? {} : { parameter }),
        ...(value === undefined ? {} : { value }),
    };
}
