import { hasText, text, type TextKey } from './i18n';

export type SaturnLocale = 'en' | 'ru';
export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export type DiagnosticSeverity = 'error' | 'warning' | 'info';
export type DiagnosticValue = string | number | boolean | null;

export interface DiagnosticMessage {
  key: TextKey;
  args?: Record<string, DiagnosticValue>;
}

export interface SaturnDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: DiagnosticMessage;
  data?: Record<string, unknown>;
}

type CodeDefinition = {
  key: TextKey;
  status?: number;
  severity?: DiagnosticSeverity;
};

export const codeCatalog = {
  SATURN_PORT_PROFILE_MISSING: { key:'ports.profileMissing' },
  SATURN_PORT_UNKNOWN: { key:'ports.unknownTerminal' },
  SATURN_CONNECTION_LIMIT: { key:'ports.connectionLimit' },
  SATURN_CONNECTION_INVALID: { key:'ports.malformedConnection' },
  SATURN_CONNECTION_ID: { key:'ports.duplicateConnection' },
  SATURN_CONNECTION_SELF: { key:'ports.selfConnection' },
  SATURN_CONNECTION_INCOMPATIBLE: { key:'ports.incompatibleConnection' },
  SATURN_CONNECTION_DIRECTION: { key:'ports.reversedConnection' },
  SATURN_PORT_OCCUPIED: { key:'ports.occupiedTerminal' },
  SATURN_SIGNAL_SCALE: { key:'ports.invalidScale' },
  SATURN_PIPE_SIGNAL_SCALE: { key:'ports.pipeScale' },
  SATURN_ROUTE_POINTS: { key:'ports.invalidRoute' },
  SATURN_BUS_OWNERS: { key:'ports.multipleBusOwners' },
  SATURN_EXPANSION_SLOT: { key:'ports.invalidExpansion' },
  SATURN_TYPE_VALUE: { key:'typing.valueTypeMismatch' },
  SATURN_TYPE_DIMENSION: { key:'typing.dimensionMismatch' },
  SATURN_TYPE_NUMERIC: { key:'typing.numericRequired' },
  SATURN_TYPE_BOOLEAN: { key:'typing.booleanRequired' },
  SATURN_VALUE_INVALID: { key:'value.invalid' },
  SATURN_PERMISSION: { key:'security.permission', status:403 },
  SATURN_NOT_FOUND: { key:'resource.notFound', status:404 },
  SATURN_CONFLICT: { key:'resource.conflict', status:409 },
  SATURN_LIMIT: { key:'limits.exceeded' },
  SATURN_DSL_INVALID: { key:'dsl.invalid' },
  SATURN_DSL_UNKNOWN: { key:'dsl.unknown' },
  SATURN_PROJECT_INVALID: { key:'project.invalid' },
  SATURN_MODEL_INVALID: { key:'model.invalid' },
  SATURN_PLC_INVALID: { key:'plc.invalid' },
  SATURN_PRESENTATION_INVALID: { key:'presentation.invalid' },
  SATURN_REPORT_INVALID: { key:'report.invalid' },
  SATURN_CRON_INVALID: { key:'cron.invalid' },
  SATURN_SQL_INVALID: { key:'sql.invalid' },
  SATURN_HISTORY_INVALID: { key:'history.invalid' },
  SATURN_RUNTIME_INVALID: { key:'runtime.invalid' },
  SATURN_HTTP_INVALID: { key:'http.invalid' },
  SATURN_EXTENSION_INVALID: { key:'extension.invalid' },
  SATURN_UPDATE_INVALID: { key:'update.invalid' },
  SATURN_STORAGE_INVALID: { key:'storage.invalid' },
} as const satisfies Record<string, CodeDefinition>;

export type CentralDiagnosticCode = keyof typeof codeCatalog;

function interpolate(template: string, args: Record<string, DiagnosticValue> = {}, locale: SaturnLocale = 'en'): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key: string) => {
    const value = args[key];
    if (key === 'reason' && typeof value === 'string') {
      const reasonKey = `reason.${value}`;
      return hasText(reasonKey) ? text(reasonKey, locale) : value;
    }
    return String(value ?? ('{' + key + '}'));
  });
}

export function formatDiagnostic(diagnostic: SaturnDiagnostic, locale: SaturnLocale = 'en'): string {
  return interpolate(text(diagnostic.message.key, locale), diagnostic.message.args, locale);
}

export function diagnostic(
  code: string,
  key: TextKey,
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
  key: TextKey,
  args?: Record<string, DiagnosticValue>,
  data?: Record<string, unknown>,
): never {
  throw new SaturnDiagnosticError(diagnostic(code, key, args, data));
}

export function failCode(
  code: CentralDiagnosticCode,
  args?: Record<string, DiagnosticValue>,
  data?: Record<string, unknown>,
  overrides?: { status?: number; severity?: DiagnosticSeverity },
): never {
  const definition: CodeDefinition = codeCatalog[code];
  throw new SaturnDiagnosticError(
    diagnostic(code, definition.key, args, data, overrides?.severity ?? definition.severity ?? 'error'),
    'en',
    overrides?.status ?? definition.status ?? 400,
  );
}

export interface SaturnErrorPayload {
  error: string;
  code?: string;
  severity?: DiagnosticSeverity;
  messageKey?: TextKey;
  messageArgs?: Record<string, DiagnosticValue>;
  data?: Record<string, unknown>;
  locale?: SaturnLocale;
}

export function diagnosticLocale(value: string | undefined | null): SaturnLocale {
  return value && /(?:^|[,;\s])ru(?:-|_|[,;\s]|$)/i.test(value) ? 'ru' : 'en';
}

export function errorPayload(error: unknown, locale: SaturnLocale = 'en', fallback = 'Internal error'): SaturnErrorPayload {
  if (error instanceof SaturnDiagnosticError) {
    return {
      error: formatDiagnostic(error.diagnostic, locale),
      code: error.diagnostic.code,
      severity: error.diagnostic.severity,
      messageKey: error.diagnostic.message.key,
      ...(error.diagnostic.message.args ? { messageArgs: error.diagnostic.message.args } : {}),
      ...(error.diagnostic.data ? { data: error.diagnostic.data } : {}),
      locale,
    };
  }
  return { error: error instanceof Error ? error.message : fallback, locale };
}
