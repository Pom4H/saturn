export type AppLanguage = 'system' | 'ru' | 'en';
export type ResolvedLanguage = 'ru' | 'en';

const LANGUAGE_KEY = 'saturn.ui.language';

const messages = {
  ru: {
    'hero.subtitle': 'Схема и TypeScript в одном проекте.',
    'common.install': 'Установить',
    'common.createProject': 'Создать проект',
    'common.commands': 'Команды…',
    'common.add': 'Добавить',
    'common.connect': 'Соединить',
    'common.scene': 'Схема',
    'common.code': 'Код',
    'common.properties': 'Свойства',
    'common.signals': 'Сигналы',
    'common.controls': 'Управление',
    'common.alarms': 'Алармы',
    'common.settings': 'Настройки',
    'common.help': 'Справка',
    'common.fullscreen': 'Развернуть на весь экран',
    'common.backToLanding': 'Вернуться на лендинг',
    'common.system': 'Системный',
    'settings.title': 'Настройки',
    'settings.appearance': 'Оформление',
    'settings.theme': 'Тема приложения',
    'settings.themeSystem': 'Системная',
    'settings.themeLight': 'Светлая',
    'settings.themeDark': 'Тёмная',
    'settings.language': 'Язык',
    'settings.languageSystem': 'Системный',
    'settings.languageRussian': 'Русский',
    'settings.languageEnglish': 'English',
    'settings.application': 'Приложение',
    'settings.network': 'Сеть',
    'settings.offline': 'Доступ без сети',
    'settings.updates': 'Обновления',
    'settings.notifications': 'Уведомления',
    'settings.checkUpdates': 'Проверить обновления',
    'settings.updateApp': 'Обновить приложение',
    'settings.allowNotifications': 'Разрешить уведомления',
    'settings.testNotification': 'Отправить проверку',
    'network.connecting': 'Подключение к серверу…',
    'network.reconnecting': 'Связь потеряна · переподключение',
    'network.offline': 'Сеть недоступна',
    'network.auth': 'Нужно войти на сервер',
    'network.live': 'Сервер · live',
    'network.stale': 'Сервер · устаревшие данные',
    'network.local': 'Локально',
    'network.demo': 'Демо',
    'runtime.draft': 'Черновик · без телеметрии',
    'runtime.stale': 'Связь потеряна · показан последний подтверждённый кадр',
    'runtime.otherRevision': 'Симуляция другой ревизии',
    'runtime.paused': 'Симуляция · пауза',
    'runtime.connected': 'Симуляция · подключена',
    'runtime.draftPaused': 'Черновик · данные приостановлены',
    'runtime.installation': 'Установка',
    'runtime.noReliableLink': 'Нет достоверной связи с runtime',
    'runtime.noData': 'Нет данных',
    'runtime.lastConfirmed': 'Последние подтверждённые данные',
    'scene3d.hint': 'Объект — перетащить · фон — вращать · колесо/щипок — масштаб · F — вписать',
    'scene3d.hintTouch': 'Объект — перетащить · фон — вращать · щипок — масштаб',
    'scene3d.preview': 'Предпросмотр · телеметрия не подключена',
    'scene3d.noData': 'Нет данных',
    'scene3d.moreAlarms': 'Ещё тревог',
    'project.none': 'Нет проектов',
    'project.createFromExample': 'Создайте проект из примера.',
    'menu.project': 'Проект',
    'menu.newProject': 'Новый проект',
    'menu.openFile': 'Открыть файл…',
    'menu.openServer': 'Открыть с сервера…',
    'menu.duplicate': 'Дублировать',
    'menu.allProjects': 'Все проекты',
    'menu.export': 'Экспорт',
    'menu.downloadSource': 'Скачать исходник',
    'menu.copyLink': 'Скопировать ссылку',
    'menu.downloadHtml': 'Скачать HTML',
    'menu.application': 'Приложение',
    'menu.installSaturn': 'Установить Saturn',
    'files.title': 'Проект',
    'files.search': 'Файл или путь…',
    'files.showChanged': 'Только изменённые файлы',
    'canvas.fit': 'Вписать',
    'canvas.pauseDemo': 'Приостановить демонстрацию',
    'table.object': 'Объект',
    'table.parameter': 'Параметр',
    'table.value': 'Значение',
    'table.source': 'Источник',
    'projects.title': 'Проекты',
    'dialog.projectCreate': 'Создать проект',
    'dialog.name': 'Название',
    'dialog.base': 'Основа',
    'dialog.server': 'Установка Saturn',
    'dialog.serverLogin': 'Войти на сервер ↗',
    'dialog.serverConnect': 'Подключить установку',
    'dialog.commit': 'Сохранить ревизию',
    'dialog.comment': 'Комментарий',
    'dialog.save': 'Сохранить',
  },
  en: {
    'hero.subtitle': 'Diagram and TypeScript in one project.',
    'common.install': 'Install',
    'common.createProject': 'Create project',
    'common.commands': 'Commands…',
    'common.add': 'Add',
    'common.connect': 'Connect',
    'common.scene': 'Scene',
    'common.code': 'Code',
    'common.properties': 'Properties',
    'common.signals': 'Signals',
    'common.controls': 'Controls',
    'common.alarms': 'Alarms',
    'common.settings': 'Settings',
    'common.help': 'Help',
    'common.fullscreen': 'Enter fullscreen',
    'common.backToLanding': 'Back to landing',
    'common.system': 'System',
    'settings.title': 'Settings',
    'settings.appearance': 'Appearance',
    'settings.theme': 'Application theme',
    'settings.themeSystem': 'System',
    'settings.themeLight': 'Light',
    'settings.themeDark': 'Dark',
    'settings.language': 'Language',
    'settings.languageSystem': 'System',
    'settings.languageRussian': 'Русский',
    'settings.languageEnglish': 'English',
    'settings.application': 'Application',
    'settings.network': 'Network',
    'settings.offline': 'Offline access',
    'settings.updates': 'Updates',
    'settings.notifications': 'Notifications',
    'settings.checkUpdates': 'Check for updates',
    'settings.updateApp': 'Update application',
    'settings.allowNotifications': 'Allow notifications',
    'settings.testNotification': 'Send test',
    'network.connecting': 'Connecting to server…',
    'network.reconnecting': 'Connection lost · reconnecting',
    'network.offline': 'Network unavailable',
    'network.auth': 'Sign in to the server',
    'network.live': 'Server · live',
    'network.stale': 'Server · stale data',
    'network.local': 'Local',
    'network.demo': 'Demo',
    'runtime.draft': 'Draft · telemetry disconnected',
    'runtime.stale': 'Connection lost · showing the last confirmed frame',
    'runtime.otherRevision': 'Simulation is on another revision',
    'runtime.paused': 'Simulation · paused',
    'runtime.connected': 'Simulation · connected',
    'runtime.draftPaused': 'Draft · telemetry paused',
    'runtime.installation': 'Installation',
    'runtime.noReliableLink': 'No reliable runtime connection',
    'runtime.noData': 'No data',
    'runtime.lastConfirmed': 'Last confirmed data',
    'scene3d.hint': 'Drag object · orbit background · wheel/pinch to zoom · F to fit',
    'scene3d.hintTouch': 'Drag object · orbit background · pinch to zoom',
    'scene3d.preview': 'Preview · telemetry disconnected',
    'scene3d.noData': 'No data',
    'scene3d.moreAlarms': 'More alarms',
    'project.none': 'No projects',
    'project.createFromExample': 'Create a project from an example.',
    'menu.project': 'Project',
    'menu.newProject': 'New project',
    'menu.openFile': 'Open file…',
    'menu.openServer': 'Open from server…',
    'menu.duplicate': 'Duplicate',
    'menu.allProjects': 'All projects',
    'menu.export': 'Export',
    'menu.downloadSource': 'Download source',
    'menu.copyLink': 'Copy link',
    'menu.downloadHtml': 'Download HTML',
    'menu.application': 'Application',
    'menu.installSaturn': 'Install Saturn',
    'files.title': 'Project',
    'files.search': 'File or path…',
    'files.showChanged': 'Changed files only',
    'canvas.fit': 'Fit',
    'canvas.pauseDemo': 'Pause demo',
    'table.object': 'Object',
    'table.parameter': 'Parameter',
    'table.value': 'Value',
    'table.source': 'Source',
    'projects.title': 'Projects',
    'dialog.projectCreate': 'Create project',
    'dialog.name': 'Name',
    'dialog.base': 'Base',
    'dialog.server': 'Saturn installation',
    'dialog.serverLogin': 'Sign in to server ↗',
    'dialog.serverConnect': 'Connect installation',
    'dialog.commit': 'Save revision',
    'dialog.comment': 'Comment',
    'dialog.save': 'Save',
  },
} as const;

export type MessageKey = keyof typeof messages.ru;

export function readAppLanguage(): AppLanguage {
  try {
    const value = localStorage.getItem(LANGUAGE_KEY);
    if (value === 'ru' || value === 'en') return value;
  } catch { /* Preferences are optional. */ }
  return 'system';
}

export function resolveLanguage(preference: AppLanguage = readAppLanguage()): ResolvedLanguage {
  if (preference !== 'system') return preference;
  const language = navigator.languages?.[0] ?? navigator.language ?? 'en';
  return language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function languageTag(language: ResolvedLanguage = resolveLanguage()): string {
  return language === 'ru' ? 'ru-RU' : 'en-US';
}

export function t(key: MessageKey, language: ResolvedLanguage = resolveLanguage()): string {
  return messages[language][key];
}

const textBindings: [string, MessageKey][] = [
  ['.hero p', 'hero.subtitle'],
  ['.site-header [data-install-studio]', 'common.install'],
  ['#project-create', 'common.createProject'],
  ['#command-launcher span', 'common.commands'],
  ['#equipment-toggle span', 'common.add'],
  ['#signals-panel .content-heading h2', 'common.signals'],
  ['#controls-panel .content-heading h2', 'common.controls'],
  ['#alarms-panel .content-heading h2', 'common.alarms'],
  ['.export-options .menu-group:nth-of-type(1)', 'menu.project'],
  ['.export-options [data-new-project]', 'menu.newProject'],
  ['#studio-import', 'menu.openFile'],
  ['#server-open', 'menu.openServer'],
  ['#project-duplicate', 'menu.duplicate'],
  ['.export-options [data-shell-view="projects"]', 'menu.allProjects'],
  ['.export-options .menu-group:nth-of-type(2)', 'menu.export'],
  ['#studio-download', 'menu.downloadSource'],
  ['#studio-share', 'menu.copyLink'],
  ['#studio-html', 'menu.downloadHtml'],
  ['.export-options .menu-group:nth-of-type(3)', 'menu.application'],
  ['.export-options [data-open-help]', 'common.help'],
  ['.export-options [data-install-studio]', 'menu.installSaturn'],
  ['.navigator-heading>span', 'files.title'],
  ['#signals-panel thead th:nth-child(1)', 'table.object'],
  ['#signals-panel thead th:nth-child(2)', 'table.parameter'],
  ['#signals-panel thead th:nth-child(3)', 'table.value'],
  ['#signals-panel thead th:nth-child(4)', 'table.source'],
  ['#projects-panel .content-heading h2', 'projects.title'],
  ['#project-dialog-title', 'dialog.projectCreate'],
  ['label[for="project-name"]', 'dialog.name'],
  ['label[for="project-base"]', 'dialog.base'],
  ['#server-dialog-title', 'dialog.server'],
  ['#server-dialog .server-dialog-actions a', 'dialog.serverLogin'],
  ['#server-load', 'dialog.serverConnect'],
  ['#server-commit-title', 'dialog.commit'],
  ['label[for="server-commit-message"]', 'dialog.comment'],
  ['#server-commit-form button[type="submit"]', 'dialog.save'],
];

const attrBindings: [string, string, MessageKey][] = [
  ['#mobile-scene', 'aria-label', 'common.scene'],
  ['#mobile-scene', 'title', 'common.scene'],
  ['#studio-code', 'aria-label', 'common.code'],
  ['#studio-code', 'title', 'common.code'],
  ['#inspector-toggle', 'aria-label', 'common.properties'],
  ['#inspector-toggle', 'title', 'common.properties'],
  ['[data-shell-view="signals"]', 'aria-label', 'common.signals'],
  ['[data-shell-view="signals"]', 'title', 'common.signals'],
  ['#runtime-controls', 'aria-label', 'common.controls'],
  ['#runtime-controls', 'title', 'common.controls'],
  ['#runtime-alarms', 'aria-label', 'common.alarms'],
  ['#runtime-alarms', 'title', 'common.alarms'],
  ['#shell-settings', 'aria-label', 'common.settings'],
  ['#shell-settings', 'title', 'common.settings'],
  ['#shell-help', 'aria-label', 'common.help'],
  ['#shell-help', 'title', 'common.help'],
  ['#file-search', 'placeholder', 'files.search'],
  ['#files-changed', 'aria-label', 'files.showChanged'],
  ['#studio-fit', 'aria-label', 'canvas.fit'],
  ['#studio-fit', 'title', 'canvas.fit'],
  ['#studio-play', 'aria-label', 'canvas.pauseDemo'],
  ['#studio-play', 'title', 'canvas.pauseDemo'],
];

export function applyStaticLanguage(): void {
  const language = resolveLanguage();
  document.documentElement.lang = language;
  document.documentElement.dataset.language = language;
  for (const [selector, key] of textBindings) {
    document.querySelectorAll<HTMLElement>(selector).forEach(node => { node.textContent = t(key, language); });
  }
  for (const [selector, attribute, key] of attrBindings) {
    document.querySelectorAll<HTMLElement>(selector).forEach(node => node.setAttribute(attribute, t(key, language)));
  }
}

export function setAppLanguage(language: AppLanguage): void {
  try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* Keep the in-session choice. */ }
  document.documentElement.dataset.languagePreference = language;
  applyStaticLanguage();
  window.dispatchEvent(new CustomEvent('saturn-language-change', { detail: { language: resolveLanguage(language), preference: language } }));
}

document.documentElement.dataset.languagePreference = readAppLanguage();
applyStaticLanguage();

if ('language' in navigator) {
  window.addEventListener('languagechange', () => {
    if (readAppLanguage() === 'system') {
      applyStaticLanguage();
      window.dispatchEvent(new CustomEvent('saturn-language-change', { detail: { language: resolveLanguage(), preference: 'system' } }));
    }
  });
}
