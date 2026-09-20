import { AppError } from './types';

export type SaturnLocale = 'en' | 'ru';
export type DiagnosticSeverity = 'error' | 'warning' | 'info';
export type DiagnosticValue = string | number | boolean | null;

export interface DiagnosticMessage {
  key: string;
  args?: Record<string, DiagnosticValue>;
}

export interface SaturnDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: DiagnosticMessage;
  data?: Record<string, unknown>;
}

type Catalog = Record<string, Record<SaturnLocale, string>>;

const messages: Catalog = {
  'ports.profileMissing': { en: 'No physical port profile: {type}', ru: 'Нет профиля физических портов: {type}' },
  'ports.unknownTerminal': { en: 'Unknown terminal {device}.{port}', ru: 'Неизвестная клемма {device}.{port}' },
  'ports.connectionLimit': { en: 'At most 512 connections', ru: 'Допустимо не более 512 соединений' },
  'ports.malformedConnection': { en: 'Malformed physical connection', ru: 'Некорректное физическое соединение' },
  'ports.duplicateConnection': { en: 'Invalid or duplicate connection ID: {id}', ru: 'Некорректный или повторяющийся ID соединения: {id}' },
  'ports.selfConnection': { en: 'Self-wiring is not supported; use a junction', ru: 'Нельзя соединить устройство само с собой; используйте узел соединения' },
  'ports.incompatibleConnection': { en: 'Incompatible connection {id}: {fromFamily} → {toFamily}', ru: 'Несовместимое соединение {id}: {fromFamily} → {toFamily}' },
  'ports.reversedConnection': { en: 'Reversed driver or two sources: {id}', ru: 'Перепутано направление или соединены два источника: {id}' },
  'ports.occupiedTerminal': { en: 'Occupied terminal {terminal}; use a distribution terminal', ru: 'Клемма {terminal} уже занята; используйте распределительный узел' },
  'ports.invalidScale': { en: 'Invalid signal scale', ru: 'Некорректный масштаб сигнала' },
  'ports.pipeScale': { en: 'Pipe is physical fluid topology, not signal scaling', ru: 'Труба описывает физический поток среды, а не масштабирование сигнала' },
  'ports.invalidRoute': { en: 'Invalid route points', ru: 'Некорректные точки маршрута' },
  'ports.multipleBusOwners': { en: 'Multiple PLC bus owners are not supported', ru: 'Несколько владельцев одной шины PLC не поддерживаются' },
  'ports.invalidExpansion': { en: 'Invalid expansion slot', ru: 'Некорректный слот модуля расширения' },
};

function interpolate(template: string, args: Record<string, DiagnosticValue> = {}): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key: string) => String(args[key] ?? ('{' + key + '}')));
}

export function formatDiagnostic(diagnostic: SaturnDiagnostic, locale: SaturnLocale = 'en'): string {
  const template = messages[diagnostic.message.key]?.[locale] ?? messages[diagnostic.message.key]?.en ?? diagnostic.message.key;
  return interpolate(template, diagnostic.message.args);
}

export function diagnostic(
  code: string,
  key: string,
  args?: Record<string, DiagnosticValue>,
  data?: Record<string, unknown>,
  severity: DiagnosticSeverity = 'error',
): SaturnDiagnostic {
  return { code, severity, message: { key, ...(args ? { args } : {}) }, ...(data ? { data } : {}) };
}

export class SaturnDiagnosticError extends AppError {
  readonly diagnostic: SaturnDiagnostic;
  constructor(diagnosticValue: SaturnDiagnostic, locale: SaturnLocale = 'en', status = 400) {
    super(formatDiagnostic(diagnosticValue, locale), status);
    this.diagnostic = diagnosticValue;
  }
}

export function failDiagnostic(
  code: string,
  key: string,
  args?: Record<string, DiagnosticValue>,
  data?: Record<string, unknown>,
): never {
  throw new SaturnDiagnosticError(diagnostic(code, key, args, data));
}
