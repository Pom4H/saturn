import { benchView } from './views';
import { report } from '@scada/plant';
/** UTC cron and typed manual inputs. SQL sees only the declared signal data capsule. */
export const thermalReport = report('thermal-balance', {
    title: 'Тепловое состояние и полнота данных',
    on: {
        workflow_dispatch: { inputs: { scale: { type: 'number', default: 1, min: 0.1, max: 10 } } },
        schedule: [{ cron: '0 * * * *' }],
    },
    signals: ['CORE.power', 'core.temperature', 'core.void', 'core.damage', 'PUMP-A.flow', 'PUMP-B.flow'],
    window: 3600000,
    sql: `SELECT signal,
    SUM(CASE WHEN quality = 'good' THEN value * (end-start) END)
      / NULLIF(SUM(CASE WHEN quality = 'good' THEN end-start END), 0) * :scale AS average,
    MAX(CASE WHEN quality = 'good' THEN value END) AS maximum,
    100.0 * SUM(CASE WHEN quality = 'good' THEN end-start ELSE 0 END)
      / MAX(1, :to-:from) AS coverage
    FROM segments GROUP BY signal`,
    columns: [
        { key: 'signal', title: 'Сигнал' },
        { key: 'average', title: 'Средневзвешенное по времени' },
        { key: 'maximum', title: 'Максимум' },
        { key: 'coverage', title: 'Полнота', unit: '%' },
    ],
});
export const transientReport = report('transient', {
    title: 'Переходный процесс · температура каналов',
    description: 'Изменение температуры за выбранный интервал с явными разрывами недостоверных данных.',
    on: { workflow_dispatch: {} },
    signals: ['core.temperature'], window: 600000,
    sql: `SELECT time, CASE WHEN quality='good' THEN value ELSE NULL END AS temperature
    FROM samples WHERE signal='core.temperature' ORDER BY time`,
    columns: [{ key: 'time', title: 'Модельное время, UTC ms' }, { key: 'temperature', title: 'Температура', unit: 'отн.' }],
    summary: [
        { key: 'temperature', label: 'Максимум', aggregate: 'max', unit: 'отн.', digits: 2, emphasis: 'primary' },
        { key: 'temperature', label: 'Среднее по точкам', aggregate: 'avg', unit: 'отн.', digits: 2 },
        { key: 'temperature', label: 'Последнее значение', aggregate: 'last', unit: 'отн.', digits: 2 },
    ],
    chart: { x: 'time', y: 'temperature', title: 'Температура и разрывы качества', type: 'line', unit: 'отн.' },
});
export const hourlyFlowReport = report('pump-a-hourly-flow', {
    title: 'Суточный профиль расхода · PUMP-A',
    description: 'Интеграл расхода и среднее значение по каждому часу. Недостоверные интервалы исключаются из расчёта, а не подменяются нулём.',
    on: {
        workflow_dispatch: {},
        schedule: [{ cron: '5 0 * * *' }],
    },
    signals: ['PUMP-A.flow'],
    window: 24 * 3600000,
    sql: `SELECT
      CAST((start-:from)/3600000 AS INTEGER) AS hour,
      SUM(CASE WHEN quality='good' THEN value*(end-start)/3600000.0 END) AS volume,
      SUM(CASE WHEN quality='good' THEN value*(end-start) END)
        / NULLIF(SUM(CASE WHEN quality='good' THEN end-start END),0) AS average,
      100.0 * SUM(CASE WHEN quality='good' THEN end-start ELSE 0 END) / 3600000.0 AS coverage
      FROM segments
      WHERE signal='PUMP-A.flow'
      GROUP BY hour
      ORDER BY hour`,
    columns: [
        { key: 'hour', title: 'Час UTC' },
        { key: 'volume', title: 'Интеграл', unit: 'отн.·ч' },
        { key: 'average', title: 'Среднее', unit: 'отн.' },
        { key: 'coverage', title: 'Полнота', unit: '%' },
    ],
    summary: [
        { key: 'volume', label: 'За сутки', aggregate: 'sum', unit: 'отн.·ч', digits: 1, emphasis: 'primary' },
        { key: 'average', label: 'Средний расход', aggregate: 'avg', unit: 'отн.', digits: 2 },
        { key: 'average', label: 'Пиковый час', aggregate: 'max', unit: 'отн.', digits: 2 },
    ],
    chart: { x: 'hour', y: 'volume', title: 'Расход по часам', type: 'bar', unit: 'отн.·ч' },
});

export const benchReport = report('bench-state', {
    title: 'Снимок PLC · общая панель HMI', on: {workflow_dispatch:{}},
    signals: ['SATURN-1.AI1','SATURN-1.DO1'], window:60000,
    sql: 'SELECT signal,time,value,quality FROM samples ORDER BY time',
    columns: [{key:'signal',title:'Сигнал'},{key:'value',title:'Значение'}],
    view: benchView,
});
export const reports = [thermalReport, transientReport, hourlyFlowReport, benchReport];
