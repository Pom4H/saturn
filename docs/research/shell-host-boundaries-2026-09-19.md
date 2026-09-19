# Saturn: общие возможности, браузерная Shell и расширение VS Code

Дата: 19 сентября 2026. Статус: предложение архитектурных границ, проверенное по исходникам и официальным API. Реализация расширения и проверка в Extension Development Host ещё не выполнялись.

## Решение

Проектировать Saturn как общие предметные возможности с двумя host-адаптерами: browser workbench и VS Code. Dockview относится исключительно к браузерному host. Общие визуальные компоненты работают внутри обычного DOM-контейнера либо webview. Редактор текста, владение документами, undo, сохранение, команды и расположение панелей предоставляет host.

Это уточняет [исследование Shell](shell-architecture-2026-09-19.md): document session — общий контракт доступа к документам, но реализация истории изменений зависит от среды. В VS Code владельцем текста и истории является TextDocument. В браузере — наш слой документов с сохраняемым по URI состоянием CodeMirror. Не должно быть двух независимо изменяемых авторитетных копий одного исходника.

«Бесплатно» означает повторное использование компилятора, преобразований исходников и визуальных компонентов. Manifest, host adapters, сообщения webview, ресурсы, transport/auth и интеграционные проверки останутся отдельной работой. Доля переиспользования и LOC пока не измерены.

## Основания в текущем коде

Проверены рабочая ветка и `origin/feature/visual-dsl-shell` в `/Users/rom/.codex/worktrees/visual-shell-preview/saturn`.

- `plant/compiler.ts`: `compileProject(files, entry)` принимает карту исходников; локальные импорты разрешает из неё. Это уже удобная независимая граница. Компилятор реализует ограниченный интерпретатор декларативного TypeScript; подключение VS Code не расширяет допустимый язык до произвольного TS.
- `plant/studio.ts`: `widgetSource` находит диапазоны AST, `patchWidget` возвращает новую карту файлов. В новой границе эти операции возвращают точечные изменения текста с версией основы.
- `plant/connection-edit.ts`: изменения wiring сохраняют исходный текст вокруг изменяемого участка. Эта предметная логика должна оставаться общей для обоих host.
- `plant/web/main.ts`: глобальные `files`, `dirty`, `file`, CodeMirror и `document.getElementById` связывают документы, visual edits, UI и runtime. Эти связи нужно разрезать перед масштабной заменой Shell.
- `plant/web/client.ts`: уже есть интерфейс `Connection` и два транспорта, но `RemoteClient` использует `location`, browser EventSource, same-origin cookie/CSRF, а `LocalClient` создаёт Worker по URL относительно bundle. Такой клиент нельзя считать готовым адаптером extension host.
- `plant/adapters/browser-worker.ts`: жизненный цикл локальной БД связан с Web Locks и worker; есть вложенный report worker. OPFS/SQLite WASM и загрузку worker нельзя автоматически переносить в webview.
- `plant/service.ts`, `plant/kernel.ts`, `plant/store.ts`: предметная логика и интерфейс SQL уже отделены от части инфраструктуры. Начинать нужно с существующих границ, не создавать второй runtime framework.

## Пять границ

| Граница | Общая ответственность | Browser host | VS Code host |
|---|---|---|---|
| Project / authoring | DSL, компиляция, диагностика, source locations, преобразование намерения в текстовые правки | Вызывается из controller/worker | Вызывается из extension controller/worker |
| Documents / workspace | Снимки исходников, URI, версии, применение правок, события изменений | Карта документов и CodeMirror state; browser storage/repository | TextDocument, WorkspaceEdit, workspace.fs |
| Visual surfaces | Схема, HMI, 3D, отчёт, выбор объектов; `mount/update/dispose` | DOM внутри Dockview | Тот же UI bundle в webview |
| Runtime session | Типизированные операции, кадры, состояние соединения, capabilities | LocalClient либо RemoteClient через адаптер | Транспорт extension host; webview получает данные по сообщениям |
| Host UI | Регистрация команд, открытие source range/visual view, показ diagnostics/output | Dockview, CodeMirror, браузерные панели | Commands, нативный текстовый редактор, TreeDataProvider, Diagnostics, OutputChannel, custom editor |

Это логические модули в существующем репозитории. Отдельные npm-пакеты, DI-контейнер и собственный механизм плагинов для такой границы не нужны. Не нужно также воспроизводить весь VS Code API в браузере: достаточно портов для реально существующих сценариев Saturn.

## Ключевой контракт: редактирование исходника

Визуальное действие, например изменение подписи HMI, проходит такой путь:

1. Панель отправляет намерение, ID выбранного объекта и версию показанной проекции.
2. Общий authoring-модуль находит актуальный исходный диапазон и строит минимальный edit plan.
3. Host проверяет, что план соответствует текущей версии документа, и применяет правку через свой механизм редактирования.
4. Событие изменения авторитетного документа запускает обновление компиляции/проекций. Панели не отправляют повторную правку в ответ на это событие.

Минимальная форма данных, а не готовая реализация API:

```ts
type SourceUri = string;
type SourceVersion = string; // Непрозрачный token конкретного host.

interface SourceSnapshot {
  uri: SourceUri;
  version: SourceVersion;
  text: string;
}

interface TextPatch {
  from: number; // UTF-16 offsets, согласованные с TypeScript / CodeMirror.
  to: number;
  insert: string;
}

interface EditPlan {
  label: string;
  changes: Array<{
    uri: SourceUri;
    baseVersion: SourceVersion;
    patches: TextPatch[];
  }>;
}
```

Создание/удаление файлов добавлять отдельными типами операций по мере переноса существующих сценариев; не кодировать их пустыми текстовыми заменами. Диагностика и source references также используют URI/диапазоны. Относительные имена вроде `views.ts` остаются внутри карты компилятора; host отображает их в URI относительно конкретного проекта, учитывая multi-root.

Проверка версий — обязанность адаптера и протокола Saturn; публичный `WorkspaceEdit` нельзя считать универсальным compare-and-swap API. Host должен последовательно обрабатывать намерения, отсекать устаревшие результаты и синхронизироваться по фактическим событиям документа. Случай внешнего изменения одновременно с визуальной правкой входит в обязательную интеграционную проверку.

Снимок проекта строится из файлов workspace с наложенными несохранёнными TextDocument. Иначе визуализация будет показывать данные с диска, отстающие от открытого редактора. Для новой синтаксически некорректной версии можно сохранять последнюю успешную проекцию с явным статусом; редактирование по её устаревшим диапазонам блокируется до пересчёта.

## Интеграция в VS Code

Для редактируемого текстового DSL использовать `CustomTextEditorProvider`: он связывает визуальное представление с TextDocument, а сохранение и undo обслуживаются VS Code. Правки передаются через WorkspaceEdit; изменения кода, undo, redo и revert возвращаются в webview через события документов. Включать визуальное открытие как явную команду/опциональный редактор для DSL, сохраняя обычное поведение остальных `.ts` файлов. [Custom Editor API](https://code.visualstudio.com/api/extension-guides/custom-editors).

Custom text editor привязан к одному ресурсу. Общепроектная схема может открываться отдельной webview-панелью, подписываться на снимок проекта и применять правки к нескольким TextDocument. Это различие нужно сохранить, а не объявлять весь проект одним фиктивным документом.

Файлы остаются в штатном Explorer. Предметное дерево оборудования/сигналов получает TreeDataProvider. Общий handler команды регистрируется в palette, toolbar и контекстных меню через host; оформление и комбинации клавиш принадлежат среде. [Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view), [Common Capabilities](https://code.visualstudio.com/api/extension-capabilities/common-capabilities).

В VS Code три разных контекста: workbench, extension host, webview. DOM существует в webview; расширение общается с ним сериализуемыми сообщениями. Visual-компоненты получают порт, который в браузере вызывает локальный controller, а в webview отправляет сообщения. Через границу не передаются HTMLElement, функции, экземпляры классов или объекты редактора. Нужны request IDs, версии проекций, очистка подписок и повторное получение snapshot после пересоздания панели. [Webview API](https://code.visualstudio.com/api/extension-guides/webview).

Ресурсы в webview разрешаются через `asWebviewUri`, CSP и `localResourceRoots`. Тема задаётся CSS-токенами host, без общей зависимости от Dockview или VS Code. Runtime не живёт внутри конкретной визуальной панели: её закрытие освобождает рендерер и подписки, а завершение сессии runtime задаётся отдельно на уровне проекта/подключения.

Для первого вертикального прототипа достаточно offline preview через общий compiler. Подключение к работающему Saturn — следующий отдельный шаг: extension host владеет аутентификацией и transport, webview получает необходимые DTO. Текущие cookie/CSRF и EventSource не переносим предположением. Запуск Node runtime из desktop extension или перенос SQLite WASM в worker оцениваем как отдельные возможности.

## Desktop, Remote и vscode.dev

Общие модули следует делать пригодными для browser bundle: без `node:fs`, `process`, `window`, `document` и API host в domain/application. UI-модули, естественно, используют DOM; ограничение относится к общему ядру. Доступ к workspace в расширении — через URI и `workspace.fs`, к открытому тексту — через TextDocument.

Web extension использует `browser` entrypoint и работает в Web Worker. У неё нет запуска локальных процессов; сетевые подключения подчиняются ограничениям браузера. Поддержка web extension на desktop возможна, но это не делает серверные драйверы или OPFS автоматически переносимыми. `main` entrypoint нужен только при реальной необходимости Node-возможностей. [Web Extensions](https://code.visualstudio.com/api/extension-guides/web-extensions), [Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host).

Цель первой проверки — реальные общие возможности в браузере и VS Code Desktop. Совместимость `vscode.dev` и Remote заявляется после отдельной проверки ресурсов, виртуальной файловой системы и runtime transport.

## Language tooling и минимальный объём кода

Для TypeScript-исходников использовать штатный текстовый редактор и поддержку TS в VS Code. Типы нашего DSL должны корректно разрешаться в проекте; сам факт расширения этого не обеспечивает. Saturn-специфичные ошибки компиляции выводить через DiagnosticCollection из общего формата диагностики, не парсить строки ошибок в каждой панели.

LSP имеет смысл при появлении значительного собственного language tooling или других редакторов. Для начальной интеграции достаточно общего compiler API и небольшого provider-адаптера. VS Code поддерживает как прямые language providers, так и LSP. [Programmatic Language Features](https://code.visualstudio.com/api/language-extensions/programmatic-language-features).

## Проверка границ до миграции всей Shell

1. Выделить снимок документа и преобразовать одну операцию `patchWidget` в edit plan; подключить её в существующем браузерном UI.
2. Выделить одну HMI-панель с собственным DOM-root и `mount/update/dispose`. Убрать зависимости от глобальных ID, CodeMirror и layout.
3. Подключить тот же компонент и authoring-функцию к минимальному VS Code custom text editor. Открыть `views.ts` кодом и визуально рядом.
4. Проверить: визуальная правка видна в тексте; ручная правка видна в HMI; undo/redo, save/revert, закрытие/повторное открытие, две панели одного файла, устаревшее намерение и ошибка синтаксиса ведут себя согласованно.
5. Подключить остальные возможности и только затем закрепить Dockview для браузерного host.

Критерий успеха: одна реализация предметной операции и визуального компонента работает в обоих host; различаются документы, команды, ресурсы и сообщения. Импорт-проверка или изолированная сборка общего ядра должна запрещать зависимости на host API. Это полезнее большого заранее спроектированного framework.
