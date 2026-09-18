import { panel, label, readout, dataTable, trend, view, signal, report } from '@scada/plant';
import { benchPanel } from './views';

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
    on: { workflow_dispatch: {} },
    signals: ['core.temperature'], window: 600000,
    sql: `SELECT time, CASE WHEN quality='good' THEN value ELSE NULL END AS temperature
    FROM samples WHERE signal='core.temperature' ORDER BY time`,
    columns: [{ key: 'time', title: 'Модельное время, UTC ms' }, { key: 'temperature', title: 'Температура', unit: 'отн.' }],
    chart: { x: 'time', y: 'temperature', title: 'Температура и разрывы качества' },
});

// Report and live HMI use the same presentation primitives; only the data capsule differs.
export const benchReportView = view('bench-report-view', {
    title: 'Отчёт · состояние стенда',
    bindings: {
        input: signal('SATURN-1.AI1'),
        output: signal('SATURN-1.DO1'),
        demand: signal('BENCH-LEVEL.value'),
    },
    body: panel([
        label('Состояние стенда'),
        benchPanel,
        readout('Тестовый уровень', 'demand', 'V', 2),
        trend('Изменения за минуту', 'time', 'value'),
        dataTable([
            { key: 'time', title: 'Время' },
            { key: 'signal', title: 'Сигнал' },
            { key: 'value', title: 'Значение' },
            { key: 'quality', title: 'Качество' },
        ]),
    ]),
});

export const benchReport = report('bench-state', {
    title: 'Состояние стенда · HMI и журнал',
    on: { workflow_dispatch: {} },
    signals: ['SATURN-1.AI1', 'SATURN-1.DO1', 'BENCH-LEVEL.value'],
    window: 60000,
    sql: 'SELECT signal,time,value,quality FROM samples ORDER BY time',
    columns: [
        { key: 'time', title: 'Время' },
        { key: 'signal', title: 'Сигнал' },
        { key: 'value', title: 'Значение' },
        { key: 'quality', title: 'Качество' },
    ],
    view: benchReportView,
});

export const reports = [thermalReport, transientReport, benchReport];
