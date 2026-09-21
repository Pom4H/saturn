export type SaturnLocale = 'en' | 'ru';
export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
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

type CodeDefinition = {
  key: string;
  status?: number;
  severity?: DiagnosticSeverity;
  en: string;
  ru: string;
};

export const codeCatalog = {
  SATURN_PORT_PROFILE_MISSING:{key:'ports.profileMissing',en:'No physical port profile: {type}',ru:'Нет профиля физических портов: {type}'},
  SATURN_PORT_UNKNOWN:{key:'ports.unknownTerminal',en:'Unknown terminal {device}.{port}',ru:'Неизвестная клемма {device}.{port}'},
  SATURN_CONNECTION_LIMIT:{key:'ports.connectionLimit',en:'At most 512 connections',ru:'Допустимо не более 512 соединений'},
  SATURN_CONNECTION_INVALID:{key:'ports.malformedConnection',en:'Malformed physical connection',ru:'Некорректное физическое соединение'},
  SATURN_CONNECTION_ID:{key:'ports.duplicateConnection',en:'Invalid or duplicate connection ID: {id}',ru:'Некорректный или повторяющийся ID соединения: {id}'},
  SATURN_CONNECTION_SELF:{key:'ports.selfConnection',en:'Self-wiring is not supported; use a junction',ru:'Нельзя соединить устройство само с собой; используйте узел соединения'},
  SATURN_CONNECTION_INCOMPATIBLE:{key:'ports.incompatibleConnection',en:'Incompatible connection {id}: {fromFamily} → {toFamily}',ru:'Несовместимое соединение {id}: {fromFamily} → {toFamily}'},
  SATURN_CONNECTION_DIRECTION:{key:'ports.reversedConnection',en:'Reversed driver or two sources: {id}',ru:'Перепутано направление или соединены два источника: {id}'},
  SATURN_PORT_OCCUPIED:{key:'ports.occupiedTerminal',en:'Occupied terminal {terminal}; use a distribution terminal',ru:'Клемма {terminal} уже занята; используйте распределительный узел'},
  SATURN_SIGNAL_SCALE:{key:'ports.invalidScale',en:'Invalid signal scale',ru:'Некорректный масштаб сигнала'},
  SATURN_PIPE_SIGNAL_SCALE:{key:'ports.pipeScale',en:'Pipe is physical fluid topology, not signal scaling',ru:'Труба описывает физический поток среды, а не масштабирование сигнала'},
  SATURN_ROUTE_POINTS:{key:'ports.invalidRoute',en:'Invalid route points',ru:'Некорректные точки маршрута'},
  SATURN_BUS_OWNERS:{key:'ports.multipleBusOwners',en:'Multiple PLC bus owners are not supported',ru:'Несколько владельцев одной шины PLC не поддерживаются'},
  SATURN_EXPANSION_SLOT:{key:'ports.invalidExpansion',en:'Invalid expansion slot',ru:'Некорректный слот модуля расширения'},
  SATURN_TYPE_VALUE:{key:'typing.valueTypeMismatch',en:'Input {model}.{input} expects {expected}; received {actual}',ru:'Вход {model}.{input} ожидает тип {expected}; получен {actual}'},
  SATURN_TYPE_DIMENSION:{key:'typing.dimensionMismatch',en:'Input {model}.{input} expects dimension {expected}; received {actual}',ru:'Вход {model}.{input} ожидает размерность {expected}; получена {actual}'},
  SATURN_TYPE_NUMERIC:{key:'typing.numericRequired',en:'{context} requires a numeric signal',ru:'Для {context} требуется числовой сигнал'},
  SATURN_TYPE_BOOLEAN:{key:'typing.booleanRequired',en:'{context} requires a boolean signal',ru:'Для {context} требуется логический сигнал'},
  SATURN_VALUE_INVALID: { key:'value.invalid', en:'Invalid value for {field}: {reason}', ru:'Некорректное значение {field}: {reason}' },
  SATURN_PERMISSION: { key:'security.permission', status:403, en:'Insufficient permission: requires {role}', ru:'Недостаточно прав: требуется роль {role}' },
  SATURN_NOT_FOUND: { key:'resource.notFound', status:404, en:'{resource} not found: {id}', ru:'Объект {resource} не найден: {id}' },
  SATURN_CONFLICT: { key:'resource.conflict', status:409, en:'Conflict in {resource}: {reason}', ru:'Конфликт {resource}: {reason}' },
  SATURN_LIMIT: { key:'limits.exceeded', en:'{resource} exceeds limit: {reason}', ru:'Превышен лимит {resource}: {reason}' },
  SATURN_DSL_INVALID: { key:'dsl.invalid', en:'Invalid declarative TypeScript: {reason}', ru:'Некорректный декларативный TypeScript: {reason}' },
  SATURN_DSL_UNKNOWN: { key:'dsl.unknown', en:'Unknown {kind}: {name}', ru:'Неизвестный объект {kind}: {name}' },
  SATURN_PROJECT_INVALID: { key:'project.invalid', en:'Invalid project: {reason}', ru:'Некорректный проект: {reason}' },
  SATURN_MODEL_INVALID: { key:'model.invalid', en:'Invalid model {model}: {reason}', ru:'Некорректная модель {model}: {reason}' },
  SATURN_PLC_INVALID: { key:'plc.invalid', en:'Invalid PLC program: {reason}', ru:'Некорректная программа PLC: {reason}' },
  SATURN_PRESENTATION_INVALID: { key:'presentation.invalid', en:'Invalid presentation: {reason}', ru:'Некорректное представление: {reason}' },
  SATURN_REPORT_INVALID: { key:'report.invalid', en:'Invalid report {report}: {reason}', ru:'Некорректный отчёт {report}: {reason}' },
  SATURN_CRON_INVALID: { key:'cron.invalid', en:'Invalid cron expression: {reason}', ru:'Некорректное cron-выражение: {reason}' },
  SATURN_SQL_INVALID: { key:'sql.invalid', en:'Invalid report SQL: {reason}', ru:'Некорректный SQL отчёта: {reason}' },
  SATURN_HISTORY_INVALID: { key:'history.invalid', en:'Invalid history request: {reason}', ru:'Некорректный запрос истории: {reason}' },
  SATURN_RUNTIME_INVALID: { key:'runtime.invalid', en:'Runtime operation failed: {reason}', ru:'Ошибка runtime: {reason}' },
  SATURN_HTTP_INVALID: { key:'http.invalid', en:'HTTP request rejected: {reason}', ru:'HTTP-запрос отклонён: {reason}' },
  SATURN_EXTENSION_INVALID: { key:'extension.invalid', en:'Invalid extension: {reason}', ru:'Некорректное расширение: {reason}' },
  SATURN_UPDATE_INVALID: { key:'update.invalid', en:'Invalid update: {reason}', ru:'Некорректное обновление: {reason}' },
  SATURN_STORAGE_INVALID: { key:'storage.invalid', en:'Storage operation failed: {reason}', ru:'Ошибка хранилища: {reason}' },
} as const satisfies Record<string, CodeDefinition>;

export type CentralDiagnosticCode = keyof typeof codeCatalog;

const reasonCatalog: Record<string, Record<SaturnLocale,string>> = {
  invalid:{en:'invalid value',ru:'некорректное значение'},
  malformed:{en:'malformed declaration',ru:'некорректное объявление'},
  tooLarge:{en:'size limit exceeded',ru:'превышен лимит размера'},
  tooMany:{en:'item count limit exceeded',ru:'превышен лимит количества'},
  missing:{en:'required value is missing',ru:'отсутствует обязательное значение'},
  duplicate:{en:'duplicate identity',ru:'повторяющийся идентификатор'},
  unknown:{en:'unknown reference',ru:'неизвестная ссылка'},
  unsafeName:{en:'unsafe name',ru:'небезопасное имя'},
  evaluationLimit:{en:'evaluation limit exceeded',ru:'превышен лимит вычисления'},
  nestingLimit:{en:'nesting limit exceeded',ru:'превышен лимит вложенности'},
  unsupportedOperator:{en:'unsupported operator',ru:'оператор не поддерживается'},
  numericRequired:{en:'a number is required',ru:'требуется число'},
  divisionByZero:{en:'division by zero',ru:'деление на ноль'},
  arrayLimit:{en:'array expansion limit exceeded',ru:'превышен лимит массива'},
  objectLimit:{en:'object expansion limit exceeded',ru:'превышен лимит объекта'},
  methodsForbidden:{en:'methods and accessors are not allowed',ru:'методы и аксессоры запрещены'},
  literalKeyRequired:{en:'a literal key is required',ru:'требуется литеральный ключ'},
  installedDslOnly:{en:'only installed DSL functions may be called',ru:'можно вызывать только установленные функции DSL'},
  declarativeOnly:{en:'executable project code is forbidden',ru:'исполняемый код проекта запрещён'},
  namedImports:{en:'use named imports',ru:'используйте именованные импорты'},
  localImportsOnly:{en:'only local modules or @saturn/core are allowed',ru:'разрешены только локальные модули и @saturn/core'},
  importEscape:{en:'import escapes project root',ru:'импорт выходит за пределы проекта'},
  constOnly:{en:'only const declarations are supported',ru:'поддерживаются только const-объявления'},
  initializedConst:{en:'const must have an initializer',ru:'const должен иметь инициализатор'},
  defaultProject:{en:'export project() as default',ru:'экспортируйте project() по умолчанию'},
  cycle:{en:'dependency cycle detected',ru:'обнаружен цикл зависимостей'},
  range:{en:'value is outside the allowed range',ru:'значение вне допустимого диапазона'},
  schema:{en:'schema does not match declaration',ru:'схема не соответствует объявлению'},
  readOnlySelect:{en:'only one read-only SELECT is allowed',ru:'разрешён только один SELECT без записи'},
  rowBudget:{en:'result row budget exceeded',ru:'превышен лимит строк результата'},
  stateChanged:{en:'state changed since the request was prepared',ru:'состояние изменилось после подготовки запроса'},
  disabled:{en:'operation is disabled',ru:'операция отключена'},
  queueFull:{en:'queue is full',ru:'очередь заполнена'},
  runtimeRejected:{en:'runtime rejected the artifact',ru:'runtime отклонил артефакт'},
};

export type LocalizedText = string | { en: string; ru?: string };
export function localizeText(value: LocalizedText, locale: SaturnLocale = 'en'): string {
  return typeof value === 'string' ? value : value[locale] ?? value.en;
}

const messages: Catalog = {
  ...Object.fromEntries(Object.values(codeCatalog).map(definition => [
    definition.key,
    { en: definition.en, ru: definition.ru },
  ])),
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
  'typing.valueTypeMismatch': {
    en: 'Input {model}.{input} expects {expected}; received {actual}',
    ru: 'Вход {model}.{input} ожидает тип {expected}; получен {actual}',
  },
  'typing.dimensionMismatch': {
    en: 'Input {model}.{input} expects dimension {expected}; received {actual}',
    ru: 'Вход {model}.{input} ожидает размерность {expected}; получена {actual}',
  },
  'typing.numericRequired': {
    en: '{context} requires a numeric signal',
    ru: 'Для {context} требуется числовой сигнал',
  },
  'typing.booleanRequired': {
    en: '{context} requires a boolean signal',
    ru: 'Для {context} требуется логический сигнал',
  },
};

function interpolate(template: string, args: Record<string, DiagnosticValue> = {}, locale: SaturnLocale = 'en'): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key: string) => {
    const value=args[key];
    if(key==='reason'&&typeof value==='string') return reasonCatalog[value]?.[locale] ?? value;
    return String(value ?? ('{' + key + '}'));
  });
}

export function formatDiagnostic(diagnostic: SaturnDiagnostic, locale: SaturnLocale = 'en'): string {
  const template = messages[diagnostic.message.key]?.[locale] ?? messages[diagnostic.message.key]?.en ?? diagnostic.message.key;
  return interpolate(template, diagnostic.message.args, locale);
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
  messageKey?: string;
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
