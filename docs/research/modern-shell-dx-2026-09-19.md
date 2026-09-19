# Saturn Shell — UX, TypeScript/DX, PWA · 2026-09-19

Пользователь запросил доработку устаревшей оболочки, изучение Codex, справку,
уведомления PWA и привлечение экспертов. Три отдельных агента разобрали UX,
команды/доступность и PWA. Это экспертный разбор, не пользовательское исследование.

## Решения

У прежних app toolbar, canvas toolbar и document tabs был одинаковый визуальный
вес. Теперь общий chrome занимает одну строку 46 px; инструменты принадлежат
холсту, вкладки 32 px — документу. Нейтральная палитра отделяет интерфейс от схемы.
Дерево остаётся опциональным. На телефоне управление рабочей областью занимает
отдельную строку; узкий холст адаптируется через container queries.

Вместо дополнительного framework сохранены TypeScript, CodeMirror 6 и существующая
модель документов. Типизированный command registry маршрутизирует действия в
владельцев состояния. Один EditorView, индивидуальные EditorState/history каждого
документа, динамический импорт plant compiler и одна сцена продолжают работать.
Палитра/справка используют native dialog, фокус возвращается вызывающему элементу.

Codex изучен как ориентир по доступности настроек, сочетаний клавиш и темы.
Из официальной документации использованы общие модели взаимодействия; буквальное
копирование интерфейса не требовалось. Поиск команд — проверенный IDE-паттерн
VS Code. Новые зависимости ради внешнего сходства не добавлены.

PWA permission — только явный жест. Тестовое локальное уведомление отдельно от
server push, который в новом Shell пока не подключён. Waiting worker активируется
явно с veto от workspace при несохранённом серверном черновике/ошибке localStorage.
Публичный cache не содержит API, серверные исходники или авторизационные данные.

## Проверка

TypeScript и существующие compiler/workspace checks. Browser checks: неизменный
экземпляр IDE при fullscreen, экспорт/импорт, история файлов, реальные авторизованные
Git-revision/files от изолированного Node server, offline reload, WebGL fallback,
команды/диалоги/темы, уведомления с замоканным browser API, mobile390. Проверка
настоящего системного уведомления и установки на реальном устройстве не проводилась.

## Первичные источники

- [OpenAI: Settings](https://learn.chatgpt.com/docs/reference/settings): appearance,
  keyboard shortcuts, notifications; актуальный redirect официальной страницы Codex.
- [VS Code: User interface / Command Palette](https://code.visualstudio.com/docs/getstarted/userinterface).
- [WAI-ARIA: Modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
- [MDN: Notification.requestPermission](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static).
- [MDN: ServiceWorkerRegistration.showNotification](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification).
- [MDN: BeforeInstallPromptEvent](https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent).
- [web.dev: Service worker lifecycle](https://web.dev/articles/service-worker-lifecycle).

CodeMirror API также сверялся с установленными официальными пакетами; web reference
в окружении эксперта вернул 403. Действующие API взяты из локальных types, не угаданы.
