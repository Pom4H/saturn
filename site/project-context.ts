import { bankExample } from './typescript-example';

/** Portable project context, shared by review, editors and automation. */
export function projectContext(count: number) {
  const { files } = bankExample(count);
  return `# Проект Saturn · насосная группа

## Назначение

Учебная группа из ${count} насосов с общей инерцией 1.6.
Пульт показывает сумму их потоков в относительных единицах.
Это симуляция независимых насосов, не подключение физического оборудования.

## Структура

- plant.ts — состав проекта, система loop и подключение экрана.
- equipment.ts — группа моделей PUMP-1 … PUMP-${count}.
- views.ts — сумма сигналов flow и экран оператора.
- README.md — импорт и проверка проекта.

## Контракт

DSL использует декларативное подмножество TypeScript: const, литералы,
локальные именованные импорты, массивы и функции Saturn из '@saturn/core'.
Произвольные JS-функции, циклы и сетевые импорты не исполняются.

bank('PUMP-', 'pump', options) разворачивает модели с устойчивыми ID.
options: count, system, at: { x, y }, columns, pitch: { x, y }, parameters.
У pump выходы flow, rpm, power; входы voltage, resistance;
параметры inertia, nominalFlow.
aggregate(pumps, 'flow', 'sum') суммирует поток группы.

Полный SDK и доступные модели описаны в plant/dsl.ts и plant/models.ts
репозитория Saturn. Имена сигналов и параметры нужно сверять с этой версией SDK.

## Проверка и выпуск

Сначала экспортируйте текущий проект: импорт JSON заменяет черновик.
Импортируйте исходники ниже в разделе «Проект» и выполните проверку Saturn.
Исправьте диагностику, изучите изменения и поведение симуляции.
Сохранение ревизии и публикация на сервере — отдельные действия инженера.
Проверка структуры не подтверждает корректность физической установки.

## Исходники

\`\`\`json
${JSON.stringify(files, null, 2)}
\`\`\`

Документация: https://github.com/Pom4H/saturn/blob/main/docs/plant/dsl.md
`;
}
