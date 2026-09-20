import { panel, label, readout, view, signal, commandButton } from '@saturn/core';
// This very same tree is used by the web view, a frozen report and the compiled PLC HMI.
export const benchPanel = panel([
    label('Стенд управления'),
    readout('Вход AI1 x100', 'input', '', 0),
    readout('Реле DO1', 'output', '', 0),
]);
export const benchView = view('bench-hmi', {
    title: 'PLC · вход и выход', body: benchPanel,
    bindings: { input: signal('SATURN-1.AI1'), output: signal('SATURN-1.DO1') },
});
export const operatorView = view('bench-operator', {
    title: 'Операторская панель', bindings: benchView.bindings,
    body: panel([benchPanel,panel([
        commandButton('Тестовый уровень 3 V', 'BENCH-LEVEL', 3),
        commandButton('Тестовый уровень 7 V', 'BENCH-LEVEL', 7),
    ],'row')]),
});
export const views = [benchView, operatorView];
