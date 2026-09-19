# Shell для Saturn: выбор архитектуры и библиотеки

Исследование от 19 сентября 2026. Рекомендация: компактный browser workbench на существующем TypeScript/DOM, с `dockview@8.3.1` как движком расположения панелей. Lumino — основной альтернативный кандидат, если готовые команды, меню и палитра важнее простоты внедрения docking. Это архитектурный выбор по документации и исходникам, а не результат законченной миграции.

Уточнение для будущего расширения VS Code: Dockview остаётся внутри browser host; общие visual-компоненты, authoring и runtime отделяются от документов и UI конкретной среды. Контракты и порядок проверки описаны в [границах browser / VS Code](shell-host-boundaries-2026-09-19.md).

## Что уже есть в Saturn

Проверены текущая ветка `codex/fix-product-tour-git` (`c7790bd`) и отдельная рабочая копия `origin/feature/visual-dsl-shell` (`3bab2ad`). Вторая содержит разработанные редакторы HMI/отчётов и является базой сравнения.

- TypeScript, обычные DOM/SVG-элементы, сборка esbuild 0.28.2. React/Vue/Angular отсутствуют.
- CodeMirror 6 создаётся через `new EditorView({parent, state})`.
- SVG-схема и Three.js уже имеют собственные рендереры; 3D наблюдает размер контейнера через ResizeObserver.
- LocalClient и RemoteClient отделяют браузерную симуляцию/SQLite WASM от серверного runtime.
- PWA собирает локальные JS/CSS/WASM и precache manifest. Новая оболочка должна работать без CDN и дополнительного сервера.
- `plant/web/main.ts` связывает доменную логику с глобальными DOM ID и одной переменной `tab`. Новая библиотека не устранит эту связность сама.
- Источник проекта — TypeScript. Расположение окон пользователя должно храниться отдельно от исходников, публикаций, модели и истории undo документа.

Исходники: [package.json](../../package.json), [текущий main.ts](../../plant/web/main.ts), [сборка PWA](../../scripts/plant-build.mjs). Визуальная ветка в локальной копии: `/Users/rom/.codex/worktrees/visual-shell-preview/saturn`.

## Три архитектуры

| Архитектура | Что получаем | Сколько остаётся своей работы | Применимость |
|---|---|---|---|
| Фиксированная Shell: CSS Grid + готовые splitters | Чёткие зоны, изменение ширины, переключение панелей | Мало при фиксированной раскладке; вкладки, перенос, восстановление состояния нужно добавлять отдельно | Лучший минимум, если пользователь не должен перестраивать рабочее место |
| Workbench с docking | Вкладки документов, разделение, перенос, сохранение рабочей раскладки | Доменная интеграция, команды, дерево, оформление | Рекомендуемый уровень для нашей инженерной среды |
| Полная IDE-платформа | Готовая инфраструктура расширений и сервисов IDE | Адаптация существующего приложения к платформе | Имеет смысл при отдельной цели поддерживать IDE-расширения |

В качестве UX-ориентира подходит разделение VS Code на Activity Bar, дерево/вторичную боковую панель, Editor Groups, нижнюю Panel и Status Bar. Перенимать нужно роли этих зон; внешний вид не требует переноса самого VS Code. [Официальные UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview).

## Сравнение кандидатов

| Кандидат | Подходит нашему стеку | Что уже готово | Что дописываем / меняем | Вывод |
|---|---|---|---|---|
| **Dockview 8.3.1, MIT core** | Обычный TypeScript/DOM, без React | Docking, группы вкладок, splitters, JSON layout, темы, lifecycle событий | Panel adapters, дерево проекта, команды и оформление внешней рамки | **Основной выбор** |
| **Lumino widgets 2.9.0, BSD-3-Clause** | TypeScript, собственная модель Widget | DockPanel, SplitPanel, Menu/MenuBar, CommandRegistry и CommandPalette | Обёртки Widget, theme, преобразование layout с Widget-ссылками в сохраняемые ID | **Сильная альтернатива**, особенно для насыщенной командами оболочки |
| Golden Layout 2.6.0, MIT | TypeScript/DOM, virtual components | Docking, popouts, сохранение layout | Интеграция и собственный канал сборки свежей версии из исходников | Не выбирать первым: официальный сайт предупреждает о старых npm-пакетах |
| FlexLayout 0.11.0, MIT | Требует React/ReactDOM 18/19 | Богатые dock/tab/border layouts, сохранение состояния компонентов | React shell и мосты к существующим DOM-компонентам | Хорош для React-проекта; у нас добавит слой интеграции |
| Web Awesome 3.13.0, core MIT | Web Components, совместим с DOM | Split Panel, Tree, Tabs, Dialog и прочие UI primitives | Менеджер документов, docking и его persistence | Полезен для фиксированной Shell или будущих форм; не заменяет workbench |
| Eclipse Theia | TypeScript, полноценная платформа IDE | Application Shell и расширения, frontend/backend infrastructure | Перестройка приложения под DI, сервисы и процессы платформы | Избыточно для цели сократить код оболочки сейчас |

Основания: [Dockview](https://dockview.dev/docs/overview/introduction/), [Lumino](https://github.com/jupyterlab/lumino), [Lumino widgets API](https://lumino.readthedocs.io/en/latest/api/modules/widgets.html), [Golden Layout](https://golden-layout.github.io/golden-layout/), [FlexLayout README](https://github.com/caplin/FlexLayout/blob/master/README.md), [Web Awesome Split Panel](https://webawesome.com/docs/components/split-panel), [Theia architecture](https://theia-ide.org/docs/architecture/).

Версии и даты публикаций прочитаны напрямую из npm registry; снимок находится в [shell-registry.json](shell-registry.json). Golden Layout 2.6.0 опубликован 26.09.2022; дата изменения npm metadata не равна дате релиза. Это не доказывает отсутствие работы в Git, но означает дополнительную работу с доставкой зависимости. Web Awesome не требует React для использования custom elements; наличие React-интеграции среди его пакетов не означает обязательную миграцию приложения.

## Почему Dockview

Он совпадает с нашей текущей границей интеграции: библиотека управляет контейнерами, а внутри остаются существующие CodeMirror, SVG, HMI и Three.js. `createDockview` принимает DOM-host и фабрику компонентов. Layout уже сериализуется через `toJSON/fromJSON`, поэтому не нужен собственный алгоритм дерева split-панелей и переносов. [API-модель](https://dockview.dev/docs/core/overview/).

Рекомендую публичный vanilla-пакет **`dockview`**, как указано в документации текущей версии. Он зависит от собственного `dockview-core`; у core нет runtime dependencies. Формулировка «zero dependencies» не означает нулевого размера сборки или отсутствия собственного core-пакета.

Dockview не предоставляет весь интерфейс продукта: Project Explorer, command palette, поиск, роли, редактирование и семантика команд остаются у нас. Ожидание меньшего объёма интеграционного кода — инженерная оценка по API, а не измеренный результат портирования Saturn.

**Лицензионная граница версии 8:** обычные вкладки, docking, resizing, темы, JSON layout, floating/popout, базовые edge groups, контекстные меню и базовая доступность входят в MIT-часть. Pinned/multi-row tabs, auto-hide edge groups, layout undo/redo, advanced overflow и keyboard docking относятся к Enterprise. Для первого этапа достаточно core. Источник для выбора функций — актуальная [таблица Licensing](https://dockview.dev/docs/overview/licence/); ранняя статья о запуске Enterprise отличается от текущей таблицы в описании context menus.

Если auto-hide и полноценное перемещение панелей с клавиатуры окажутся обязательными условиями, этот выбор нужно пересмотреть до интеграции либо отдельно оценить Enterprise. Их нельзя записывать в бесплатный scope.

## Где Lumino сильнее

Lumino предоставляет согласованную систему команд, keyboard bindings, меню и command palette. Одна команда может обслуживать несколько UI-представлений, сокращая дублирование обработчиков. Это более полный набор строительных блоков оболочки. [CommandRegistry](https://lumino.readthedocs.io/en/latest/api/classes/commands.CommandRegistry-1.html).

Обратная сторона: существующие панели нужно включить в lifecycle Widget; `DockPanel.saveLayout()` возвращает конфигурацию с экземплярами Widget в tab areas, а для хранения между сессиями требуется отображение Widget ↔ стабильный ID. Это не аналог готового JSON документа Dockview. Основание: [DockPanel API](https://lumino.readthedocs.io/en/latest/api/classes/widgets.DockPanel-1.html) и установленный `@lumino/widgets/types/docklayout.d.ts` (`ITabAreaConfig.widgets: Widget[]`).

Если целью станет полноценная расширяемая инженерная платформа с большим числом меню/команд, Lumino может дать меньше собственного кода, чем Dockview плюс несколько отдельных UI-библиотек. Для текущего переноса DOM-панелей я предпочитаю Dockview.

## Локальный замер сборки

Собраны опубликованные пакеты через наш esbuild 0.28.2: ESM, browser, ES2022, minify, gzip level 9. Сохранены именованные экспорты нужных API и подключены стили; картинки темы Golden Layout встроены как data URL. CodeMirror, Three.js, наш runtime и HTML сюда не входят.

| Набор | JS minified | JS gzip | CSS gzip | JS + CSS gzip |
|---|---:|---:|---:|---:|
| Dockview `createDockview` + стандартный CSS | 340.8 KiB | 80.9 KiB | 10.1 KiB | **91.0 KiB** |
| Lumino DockPanel + Widget + default theme | 185.6 KiB | 47.3 KiB | 3.4 KiB | **50.7 KiB** |
| Lumino + SplitPanel, menus, palette, CommandRegistry | 185.7 KiB | 47.4 KiB | 3.4 KiB | **50.8 KiB** |
| Golden Layout + light theme | 125.4 KiB | 29.5 KiB | 2.2 KiB | **31.6 KiB** |

Это замер выбранных библиотечных entrypoints, не runtime benchmark и не измерение готового Saturn. Различия состава CSS/тем и tree shaking ограничивают прямое сравнение. Близкие размеры двух наборов Lumino означают, что выбранный barrel уже удержал почти весь соответствующий код, а не что каждое дополнительное UI-возможность принципиально бесплатна.

Вывод: Dockview не минимален по байтам. Его аргумент — готовое поведение панелей и простота интеграции. Нельзя смешивать минимум собственного кода, минимальный npm-граф и минимальный bundle.

Сырые данные: [shell-bundle-measurements.json](shell-bundle-measurements.json). Воспроизведение:

```sh
npm install --prefix /tmp/saturn-shell-bench --ignore-scripts --no-audit --no-fund \
  dockview@8.3.1 @lumino/widgets@2.9.0 @lumino/commands@2.3.4 \
  @lumino/default-theme@2.1.16 golden-layout@2.6.0
node docs/research/shell-benchmark.mjs /tmp/saturn-shell-bench
```

Команду запускать из корня Saturn с установленным esbuild из lockfile. Transitive dependencies в повторном запуске разрешаются по ranges; для строгого повторения их нужно сверить с JSON measurements, содержащим реально использованные версии.

## Минимальная архитектура Saturn

```text
Shell: верхняя строка + Activity Bar + Status Bar
└── Dockview workspace
    ├── Explorer / Outline
    ├── Document groups: TypeScript | схема | HMI | отчёт
    ├── Inspector: свойства выбранного объекта
    └── Tool panel: Problems | Output | журнал | алармы

Document session → существующие source edits / compiler / publish
Runtime session  → один LocalClient либо RemoteClient → подписки панелей
Workspace state → layout и открытые ID → локальные предпочтения
```

Предлагаемый код оболочки ограничить четырьмя ответственностями: `shell` (mount/layout), `panels` (фабрики и lifecycle), `commands` (ID → действие и доступность), `workspace-state` (versioned preferences). Не вводить собственную plugin-платформу или DI-контейнер для восьми встроенных панелей.

Один command descriptor обслуживает toolbar, меню и поиск команд. На первом этапе достаточно Map и native dialog; сложные chords/context expressions не реализуем сами. Если они потребуются массово, вернуться к выбору Lumino. Не комбинировать сразу Dockview, Lumino и ещё одну систему состояния.

Контракт document session предоставляет source, версии и применение правок независимо от жизненного цикла панели. Источником текста, dirty state и undo владеет host: в браузере наш слой документов, в VS Code — TextDocument. Визуальная и кодовая панели редактируют тот же документ; закрытие панели не публикует проект. Это требует выделить состояние из текущих глобальных `files/editor/dirty`, но не требует переписывать compiler.

## Нюансы интеграции, которые определяют реальную стоимость

1. **Существующий DOM и ID.** Сначала переносим singleton-панели с их DOM-узлами; клонировать разметку нельзя. Дальше выделяем `mount(host, session)` для многодокументных редакторов и локальные selectors.
2. **Видимость и ресурсная работа.** Для CodeMirror, WebGL и iframe-отчёта сначала проверить `renderer: 'always'`, чтобы сохранять DOM-состояние. Скрытие панели не останавливает её JS/анимацию автоматически: Three.js рендер приостанавливается отдельно, runtime продолжает работать. На показе CodeMirror запрашивает измерение, canvas проверяет размеры. [Dockview rendering](https://dockview.dev/docs/core/panels/rendering/).
3. **Состояние раскладки.** Сохранять версию схемы, panel IDs, типы и размеры. Не класть source/telemetry в layout JSON. Восстановление фильтрует неизвестные/недоступные панели; повреждённый layout возвращает preset. Нужна команда «Сбросить расположение».
4. **Сборка и PWA.** JS/CSS пакета включаются в локальную esbuild-сборку и precache. В текущем `plant-build.mjs` после esbuild выполняется `cp('plant/web/app.css', 'dist/plant/assets/app.css')`: простой import Dockview CSS в `main.ts` приведёт к перезаписи собранного CSS. Минимальная правка — импортировать оба CSS через entrypoint и убрать эту копию, сохранив ссылку на итоговый `assets/app.css`. SSR или сервер Dockview не нужен. Это архитектурная совместимость; offline end-to-end после интеграции ещё предстоит проверить.
5. **Узкая ширина.** Touch DnD не заменяет responsive design. При 800–900 px оставлять активный документ и вызывать explorer/inspector по запросу; не превращать три панели в три длинные секции. Desktop layout хранить отдельно от компактного режима.
6. **Доступность.** Базовые ARIA и tab navigation у Dockview есть, но end-to-end focus, hotkey conflicts с CodeMirror и screen reader нужно проверить на нашем продукте. Keyboard docking не входит в core. [Accessibility](https://dockview.dev/docs/advanced/accessibility/).

На первом этапе не включать отдельные popout-окна: они добавляют lifecycle второго document и взаимодействие с нашей моделью единственной OPFS-вкладки. Это сознательное сокращение scope, а не отсутствие возможности у библиотеки.

## UX-контракт для новой Shell

- Окно приложения занимает `100dvh`; документы и tool panels прокручиваются внутри.
- Название проекта и состояние соединения помещаются в компактные строки. Большой hero отсутствует.
- Показатели установки находятся в операторском документе; редактор отчёта не получает сверху чужие KPI.
- Inspector показывает выбранный объект; общие пояснения доступны из Help/tooltip.
- Экран HMI и его исходник открываются рядом; документы остаются открыты при выборе другого инструмента.
- В инженерном режиме доступны layout и исходники, в операторском — устойчивое рабочее представление и команды, в режиме просмотра — чтение. UI использует существующие серверные capabilities.

Выбор Dockview сам по себе не уменьшит число подписей: эти решения входят в структуру Shell и редактуру интерфейса.

## Порядок проверки перед внедрением

Короткий вертикальный прототип: настоящий CodeMirror, SVG и Inspector, затем нижний Output. Проверить resize/перенос, переключение вкладок, сохранность undo/выделения, restore после reload, закрытие dirty документа и ширину встроенного браузера. После этого подключить HMI и iframe отчёта и проверить 3D/resources. Новая Shell не должна создавать второй runtime/worker при каждом открытии панели.

Ресерч включал документацию, npm metadata, локальные исходники и воспроизводимую сборку библиотек. Интеграционный прототип и cross-browser/PWA проверка выбранной библиотеки в Saturn в этой работе не выполнялись. Сроки и точное сокращение LOC без такого прототипа не заявляются.

Дополнительно исключён `@vscode/webview-ui-toolkit`: репозиторий архивирован 06.01.2025; библиотека компонентов для webview также не является Shell. [Официальное объявление](https://github.com/microsoft/vscode-webview-ui-toolkit/issues/561).
