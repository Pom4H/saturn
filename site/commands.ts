/** Shell actions stay in their owning feature; this registry only routes intent. */
export interface ShellCommand {
  id: string;
  label: string;
  keywords: readonly string[];
  shortcut?: string;
  when: () => boolean;
  run: () => void;
}

type HelpArticle = { id: string; title: string; keywords: string; paragraphs: readonly string[] };
const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

function target(selector: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(selector)].find(node =>
    !node.closest('[hidden]') && !node.matches(':disabled,[aria-disabled="true"]')) ?? null;
}
function action(id: string, label: string, selector: string, keywords: string[], shortcut?: string): ShellCommand {
  return { id, label, keywords, shortcut, when: () => !!target(selector), run: () => target(selector)?.click() };
}

export const shellCommands: readonly ShellCommand[] = [
  action('files.toggle', 'Показать / скрыть файлы', '#files-toggle', ['дерево', 'explorer', 'files'], `${mod} B`),
  { id: 'files.find', label: 'Найти файл', keywords: ['открыть', 'путь', 'search', 'file'], shortcut: `${mod} P`,
    when: () => !!target('#files-toggle'), run: () => {
      const button = target('#files-toggle');
      if (button?.getAttribute('aria-expanded') !== 'true' || document.getElementById('studio-shell')?.dataset.view !== 'scene') button?.click();
      document.querySelector<HTMLInputElement>('#file-search')?.focus();
    } },
  action('project.new', 'Новый проект', '[data-new-project]', ['создать', 'new']),
  action('project.create', 'Создать проект из примера', '#project-create', ['копия', 'сохранить', 'example']),
  action('project.duplicate', 'Дублировать проект', '#project-duplicate', ['копия', 'duplicate']),
  action('project.open', 'Открыть файл с устройства', '#studio-import', ['импорт', 'import', 'ts', 'json']),
  action('project.server', 'Открыть проект с сервера', '#server-open', ['git', 'server', 'загрузить']),
  action('project.list', 'Открыть проекты', '[data-shell-view="projects"]', ['переключить', 'projects']),
  action('project.download', 'Скачать исходники', '#studio-download', ['export', 'экспорт', 'сохранить', 'ts', 'json'], `${mod} S`),
  action('project.share', 'Скопировать ссылку на проект', '#studio-share', ['поделиться', 'share', 'ссылка']),
  action('project.html', 'Скачать автономный HTML', '#studio-html', ['export', 'экспорт', 'offline']),
  action('editor.undo', 'Отменить изменение', '#studio-undo', ['undo', 'назад'], `${mod} Z`),
  action('editor.redo', 'Повторить изменение', '#studio-redo', ['redo', 'вперёд'], `${mod} ⇧ Z`),
  action('editor.code', 'Показать / скрыть код', '#studio-code', ['source', 'typescript', 'исходник']),
  action('editor.properties', 'Показать / скрыть свойства', '#inspector-toggle', ['inspector', 'параметры']),
  action('editor.source', 'Перейти к исходнику объекта', '#object-source', ['объявление', 'definition']),
  action('scene.catalog', 'Открыть каталог оборудования', '#equipment-toggle', ['элемент', 'насос', 'клапан', 'добавить']),
  action('scene.connect', 'Соединить порты', '#studio-connect', ['связь', 'труба', 'connect']),
  action('scene.2d', 'Переключить на 2D', '#studio-2d', ['схема', 'плоский']),
  action('scene.3d', 'Переключить на 3D', '#studio-3d', ['пространство', 'объём']),
  action('scene.fit', 'Вписать схему', '#studio-fit', ['масштаб', 'fit', 'камера'], 'F'),
  action('scene.play', 'Запуск / пауза модели', '#studio-play', ['run', 'pause', 'симуляция']),
  action('scene.signals', 'Открыть сигналы', '[data-shell-view="signals"]', ['данные', 'signals', 'таблица']),
  action('runtime.controls', 'Открыть управление', '#runtime-controls', ['оператор', 'controls', 'уставки']),
  action('runtime.alarms', 'Открыть алармы', '#runtime-alarms', ['alarm', 'тревоги', 'ack']),
  action('server.save', 'Сохранить Git-ревизию', '#server-save', ['commit', 'ревизия', 'git']),
  action('server.publish', 'Опубликовать ревизию', '#server-publish', ['publish', 'release', 'применить']),
  action('shell.expand', 'Развернуть / свернуть редактор', '#shell-fullscreen', ['fullscreen', 'экран']),
  action('app.settings', 'Настройки приложения', '[data-app-settings]', ['уведомления', 'тема', 'settings', 'pwa']),
  action('app.install', 'Установить Saturn', '[data-install-studio]', ['pwa', 'приложение', 'install']),
  { id: 'help.open', label: 'Справка', keywords: ['help', 'документация', 'клавиши'], shortcut: 'F1', when: () => true, run: () => openHelp() },
];

const helpArticles: readonly HelpArticle[] = [
  { id: 'start', title: 'Начало работы', keywords: 'пример проект сохранить начать', paragraphs: [
    'Выберите пример в списке проектов. Измените схему или TypeScript, затем нажмите «Создать проект»: копия сохранится отдельно от примера.',
    'Разворот открывает тот же редактор на весь экран. Выбранный объект, исходник и история изменений сохраняются. Вид 2D/3D переключается только вручную.',
    'Локальные проекты сохраняются в этом браузере. Скачайте исходники, чтобы перенести проект или сохранить копию вне браузера.',
  ] },
  { id: 'files', title: 'Файлы и вкладки', keywords: 'дерево импорт экспорт json ts поиск исходники', paragraphs: [
    '«Файлы» открывает дерево проекта. Поиск фильтрует полные пути. Один клик открывает предварительную вкладку; двойной клик или правка закрепляет её.',
    'У каждого документа своя история изменений и положение курсора. Закрытие вкладки не удаляет файл. Изменённые вкладки остаются закреплёнными.',
    'Проект «Многофайловая установка» содержит plant.ts, systems/pumping.ts, views.ts и README.md. Формат JSON переносит всю карту файлов; TS — однофайловый проект.',
  ] },
  { id: 'editing', title: 'Схема и код', keywords: '2d 3d соединить параметры ошибки оборудование undo свойства', paragraphs: [
    'Схема и редактор изменяют один исходник. Выберите объект для настройки параметров; «В исходник» открывает его объявление.',
    'В 2D можно перемещать оборудование, добавлять элементы из каталога и соединять выходной и входной порты. «Вписать» возвращает всю схему в рабочую область.',
    'Ошибка в коде сохраняет последнюю корректную схему и блокирует визуальные правки до исправления. Вычисляемые выражения не заменяются числами через инспектор.',
  ] },
  { id: 'server', title: 'Проект с сервера', keywords: 'git ревизия авторизация обновление черновик публикация', paragraphs: [
    'После входа Saturn открывает одну рабочую среду. Engineer получает исходники и Git-ревизии; operator — живую схему и разрешённые команды; viewer — read-only мониторинг.',
    'Engineer загружает файлы одной Git-ревизии. Обновление не перезаписывает изменённый черновик: сначала отмените изменения или сохраните отдельную копию, затем примените новую ревизию.',
    '«Сохранить ревизию» создаёт commit в серверном Git, но не меняет работающую установку. «Опубликовать» отдельно переводит runtime на выбранную чистую ревизию.',
    'Operator и viewer не получают исходники через API. Телеметрия, алармы и управление работают только при совпадении исполняемой ревизии и отображаемой runtime-модели.',
  ] },
  { id: 'pwa', title: 'Приложение и уведомления', keywords: 'pwa установка offline офлайн без сети разрешение push', paragraphs: [
    '«Установить» открывает доступный в браузере способ установки. На iPhone используйте Safari → «Поделиться» → «На экран Домой». Для установки нужен HTTPS или localhost.',
    'После загрузки офлайн-ресурсов редактор и локальные проекты работают без сети. Серверные API и телеметрия не кэшируются.',
    'Установка приложения не включает уведомления автоматически. Разрешение браузера запрашивается отдельно по вашему действию. Если доступ запрещён, изменить его можно в настройках сайта браузера.',
  ] },
  { id: 'shortcuts', title: 'Горячие клавиши', keywords: 'keyboard shortcuts команды палитра undo redo', paragraphs: [
    `${mod} K или ${mod} Shift P — команды. ${mod} P — найти файл. ${mod} B — показать или скрыть дерево. F1 — справка.`,
    `${mod} Z — отменить, ${mod} Shift Z — повторить. ${mod} S — скачать исходники. В палитре: ↑/↓ выбирают команду, Enter выполняет, Escape закрывает.`,
    'На схеме: F — вписать, Delete — удалить выбранный объект, стрелки — переместить, Shift + стрелки — точное перемещение. В поле ввода эти клавиши редактируют текст.',
    'Escape отменяет соединение, закрывает открытую панель или снимает выделение. В окне справки и палитре закрывается только текущее окно.',
  ] },
  { id: 'limits', title: 'Что подключено сейчас', keywords: 'ограничения демо runtime телеметрия контроллер', paragraphs: [
    'Насосный и тепловой примеры используют учебную модель. Их показания не поступают с оборудования. Данные серверной симуляции применяются к чистой исполняемой ревизии. В черновике или при потере связи значения показаны как неизвестные.',
    'Shell поддерживает исходники, многофайловую компиляцию, 2D/3D, Git commit/publish, операторские уставки и подтверждение алармов. Серверная симуляция передаёт значения и тревоги через SSE только для соответствующей исполняемой ревизии.',
    'Без WebGL остаётся 2D-редактор. Копирование ссылки зависит от доступа браузера к буферу обмена. Данные браузера могут быть очищены: исходники стоит скачивать.',
  ] },
];

let palette: HTMLDialogElement | undefined;
let help: HTMLDialogElement | undefined;
let commandSearch: HTMLInputElement;
let results: HTMLElement;
let resultStatus: HTMLElement;
let helpSearch: HTMLInputElement;
let helpNavigation: HTMLElement;
let helpContent: HTMLElement;
let matches: readonly ShellCommand[] = [];
let activeIndex = 0;
let currentArticle = 'start';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function normalize(value: string): string { return value.toLocaleLowerCase('ru').replace(/ё/g, 'е'); }
function matchesQuery(value: string, query: string): boolean {
  const normalized = normalize(value);
  return normalize(query).trim().split(/\s+/).every(word => normalized.includes(word));
}
function modal(id: string, title: string): HTMLDialogElement {
  const dialog = el('dialog', 'shell-modal'); dialog.id = id; dialog.setAttribute('aria-label', title);
  let opener: HTMLElement | null = null;
  dialog.addEventListener('close', () => {
    if (!document.querySelector('dialog[open]') && (document.activeElement === document.body || dialog.contains(document.activeElement))) opener?.focus();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  dialog.addEventListener('pointerdown', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('saturn-before-open', () => { opener = document.activeElement instanceof HTMLElement ? document.activeElement : null; });
  document.body.append(dialog); return dialog;
}
function closeButton(dialog: HTMLDialogElement): HTMLButtonElement {
  const button = el('button', 'shell-modal-close', '×'); button.type = 'button'; button.setAttribute('aria-label', 'Закрыть'); button.onclick = () => dialog.close(); return button;
}
function searchInput(label: string): HTMLInputElement {
  const input = el('input', 'shell-modal-search'); input.type = 'search'; input.placeholder = label; input.setAttribute('aria-label', label); input.autocomplete = 'off'; input.spellcheck = false; return input;
}
function present(dialog: HTMLDialogElement, focus: HTMLElement): void {
  if (dialog.open) { focus.focus(); return; }
  const other = document.querySelector<HTMLDialogElement>('dialog[open]');
  if (other && other !== palette && other !== help) return;
  other?.close(); dialog.dispatchEvent(new Event('saturn-before-open')); dialog.showModal(); focus.focus();
}

function highlightCommand(): void {
  const items = results.querySelectorAll<HTMLElement>('[role="option"]');
  items.forEach((item, index) => item.setAttribute('aria-selected', String(index === activeIndex)));
  const active = items[activeIndex];
  if (active) { commandSearch.setAttribute('aria-activedescendant', active.id); active.scrollIntoView({ block: 'nearest' }); }
  else commandSearch.removeAttribute('aria-activedescendant');
}
function execute(command: ShellCommand): void {
  if (!command.when()) { renderCommands(); return; }
  palette?.close(); command.run();
}
function renderCommands(): void {
  matches = shellCommands.filter(command => command.when() && matchesQuery(`${command.label} ${command.keywords.join(' ')}`, commandSearch.value.replace(/^>\s*/, '')));
  activeIndex = 0; results.replaceChildren();
  for (const command of matches) {
    const item = el('div', 'shell-command'); item.id = `command-${command.id}`; item.setAttribute('role', 'option');
    item.append(el('span', 'shell-command-label', command.label));
    if (command.shortcut) item.append(el('kbd', 'shell-key', command.shortcut));
    item.addEventListener('pointerdown', event => event.preventDefault());
    item.addEventListener('click', () => execute(command));
    item.addEventListener('pointermove', () => { activeIndex = matches.indexOf(command); highlightCommand(); });
    results.append(item);
  }
  if (!matches.length) results.append(el('p', 'shell-modal-empty', 'Команды не найдены'));
  resultStatus.textContent = matches.length ? `Найдено команд: ${matches.length}` : 'Команды не найдены';
  highlightCommand();
}
function renderHelp(): void {
  const articles = helpArticles.filter(article => matchesQuery(`${article.title} ${article.keywords} ${article.paragraphs.join(' ')}`, helpSearch.value));
  const article = articles.find(item => item.id === currentArticle) ?? articles[0];
  helpNavigation.replaceChildren(); helpContent.replaceChildren();
  for (const item of articles) {
    const button = el('button', 'shell-help-topic', item.title); button.type = 'button';
    button.setAttribute('aria-current', item.id === article?.id ? 'page' : 'false');
    button.onclick = () => { currentArticle = item.id; renderHelp(); helpContent.focus(); };
    helpNavigation.append(button);
  }
  if (!article) { helpContent.append(el('p', 'shell-modal-empty', 'Ничего не найдено. Попробуйте другое слово.')); return; }
  currentArticle = article.id; helpContent.append(el('h3', '', article.title));
  for (const paragraph of article.paragraphs) helpContent.append(el('p', '', paragraph));
  if (article.id === 'server') {
    const link = el('a', 'shell-help-link', 'Войти или сменить пользователя'); link.href = '/plant/login'; helpContent.append(link);
  }
}

/** Idempotent. Call after mounting the editor; optional data-open-commands/help buttons are delegated. */
export function mountCommands(): void {
  if (palette) return;
  palette = modal('shell-command-dialog', 'Команды');
  const paletteHeader = el('div', 'shell-modal-searchbar');
  commandSearch = searchInput('Найти команду…'); commandSearch.id = 'shell-command-search';
  commandSearch.setAttribute('role', 'combobox'); commandSearch.setAttribute('aria-autocomplete', 'list');
  commandSearch.setAttribute('aria-expanded', 'true'); commandSearch.setAttribute('aria-controls', 'shell-command-results');
  paletteHeader.append(commandSearch, closeButton(palette));
  results = el('div', 'shell-command-results'); results.id = 'shell-command-results'; results.setAttribute('role', 'listbox'); results.setAttribute('aria-label', 'Команды');
  resultStatus = el('span', 'shell-visually-hidden'); resultStatus.setAttribute('role', 'status');
  const paletteFooter = el('div', 'shell-command-footer'); paletteFooter.append(el('span', '', '↑ ↓ выбрать'), el('span', '', 'Enter выполнить'), el('kbd', 'shell-key', 'Esc'));
  palette.append(paletteHeader, results, resultStatus, paletteFooter);
  commandSearch.oninput = renderCommands;

  help = modal('shell-help-dialog', 'Справка Saturn');
  const helpHeader = el('div', 'shell-help-header'); helpHeader.append(el('h2', '', 'Справка'), closeButton(help));
  helpSearch = searchInput('Поиск в справке…'); helpSearch.id = 'shell-help-search'; helpSearch.oninput = renderHelp;
  const helpBody = el('div', 'shell-help-body'); helpNavigation = el('nav', 'shell-help-navigation'); helpNavigation.setAttribute('aria-label', 'Темы справки');
  helpContent = el('article', 'shell-help-article'); helpContent.tabIndex = -1;
  helpBody.append(helpNavigation, helpContent); help.append(helpHeader, helpSearch, helpBody);

  document.addEventListener('click', event => {
    const source = event.target instanceof Element ? event.target : null;
    if (source?.closest('[data-open-commands],#command-launcher')) openCommands();
    else if (source?.closest('[data-open-help],#shell-help')) openHelp();
  });
  // Capture avoids CodeMirror and the existing document shortcuts handling the same keystroke.
  document.addEventListener('keydown', event => {
    const owned = palette?.open ? palette : help?.open ? help : null;
    const key = event.key.toLowerCase();
    const commandShortcut = (event.metaKey || event.ctrlKey) && !event.altKey && (key === 'k' || (event.shiftKey && key === 'p'));
    if (commandShortcut || event.key === 'F1') {
      if (document.querySelector('dialog[open]') && !owned) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (commandShortcut) openCommands(); else openHelp(); return;
    }
    if (!owned) return;
    // Other Shell shortcuts must not reach the editor underneath a modal.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); owned.close(); }
    else if (owned === palette && event.target === commandSearch && !event.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); if (matches.length) activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; highlightCommand();
      } else if (event.key === 'Enter') { event.preventDefault(); if (matches[activeIndex]) execute(matches[activeIndex]); }
    }
  }, { capture: true });
}

export function openCommands(): void {
  mountCommands(); commandSearch.value = ''; renderCommands(); present(palette!, commandSearch);
}
export function openHelp(article = 'start'): void {
  mountCommands(); helpSearch.value = ''; currentArticle = article; renderHelp(); present(help!, helpSearch);
}
