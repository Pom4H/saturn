import { panel, label, readout, view, signal, commandButton, screen, navigate, animate } from '@scada/plant';

// This core panel is shared with the physical Saturn LCD compiler.
export const benchPanel = panel([
    label('Стенд управления'),
    panel([
        readout('Вход AI1 x100', 'input', '', 0),
        readout('Реле DO1', 'output', '', 0),
    ], 'row', 'Состояние PLC'),
]);

export const benchView = view('bench-hmi', {
    title: 'PLC · вход и выход',
    body: benchPanel,
    bindings: { input: signal('SATURN-1.AI1'), output: signal('SATURN-1.DO1') },
});

const mainScreen = screen('main', 'Главная', panel([
    label('Пульт стенда · HMI'),
    panel([
        readout('Тестовый уровень', 'demand', 'V', 2),
        readout('Вход контроллера', 'input', '', 0),
        animate(readout('Выход реле', 'output', '', 0), 'output', 'pulse', { min: 0, max: 1, from: 0, to: 1 }),
    ], 'row', 'Основные параметры'),
    panel([
        commandButton('Уровень 3 V', 'BENCH-LEVEL', 3),
        commandButton('Уровень 7 V', 'BENCH-LEVEL', 7),
        navigate('Диагностика →', 'diagnostics'),
    ], 'row', 'Команды'),
]));

const diagnosticsScreen = screen('diagnostics', 'Диагностика', panel([
    label('Диагностика PLC'),
    panel([
        readout('AI1', 'input', '', 0),
        readout('DO1', 'output', '', 0),
        readout('Задание', 'demand', 'V', 2),
    ], 'row', 'Каналы'),
    panel([
        navigate('← Главная', 'main'),
        commandButton('Тест 3 V', 'BENCH-LEVEL', 3),
    ], 'row'),
]));

export const operatorView = view('bench-operator', {
    title: 'Операторская панель',
    bindings: {
        input: signal('SATURN-1.AI1'),
        output: signal('SATURN-1.DO1'),
        demand: signal('BENCH-LEVEL.value'),
    },
    body: mainScreen.body,
    screens: [mainScreen, diagnosticsScreen],
    initial: 'main',
});

export const views = [benchView, operatorView];
