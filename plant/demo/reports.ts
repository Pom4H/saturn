import { benchView } from './views';
import { controller } from './commissioning';
import { reactor, temperature, voidFraction, damage } from './core';
import { pumpA, pumpB } from './cooling';
import { report, reportField, numberField, reportSchema, reportColumn, excelColumn, excelSheet, workbook, asc } from '@saturn/core';
/** UTC cron and typed manual inputs. SQL sees only the declared signal data capsule. */
export const thermalReport = report('thermal-balance', {
    title: 'Тепловое состояние и полнота данных',
    on: {
        workflow_dispatch: { inputs: { scale: { type: 'number', default: 1, min: 0.1, max: 10 } } },
        schedule: [{ cron: '0 * * * *' }],
    },
    signals: [reactor.power, temperature.value, voidFraction.value, damage.value, pumpA.flow, pumpB.flow],
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
const transientRows = reportSchema({
    time: numberField('ms'),
    temperature: reportField(temperature.value),
});
export const transientReport = report('transient', {
    title: 'Переходный процесс · температура каналов',
    on: { workflow_dispatch: {} },
    signals: [temperature.value], window: 600000,
    sql: `SELECT time, CASE WHEN quality='good' THEN value ELSE NULL END AS temperature
    FROM samples WHERE signal='core.temperature' ORDER BY time`,
    schema: transientRows,
    columns: [
        reportColumn('Модельное время, UTC ms', transientRows.time),
        reportColumn('Температура', transientRows.temperature),
    ],
    chart: { x: 'time', y: 'temperature', title: 'Температура и разрывы качества' },
    excel: workbook([
        excelSheet('Температура', transientRows, {
            columns: [
                excelColumn('Время', transientRows.time, { format: '0' }),
                excelColumn('Температура', transientRows.temperature, { format: '0.000' }),
            ],
            sort: [asc(transientRows.time)],
            freezeRows: 1,
            autoFilter: true,
        }),
    ]),
});
export const benchReport = report('bench-state', {
    title: 'Снимок PLC · общая панель HMI', on: {workflow_dispatch:{}},
    signals: [controller.inputs.AI1, controller.DO1], window:60000,
    sql: 'SELECT signal,time,value,quality FROM samples ORDER BY time',
    columns: [{key:'signal',title:'Сигнал'},{key:'value',title:'Значение'}],
    view: benchView,
});
export const reports = [thermalReport, transientReport, benchReport];
