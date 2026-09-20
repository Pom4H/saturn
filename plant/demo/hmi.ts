import {
  back, bind, button, confirm, equipmentView, group, hmi, navigate, operate, readout, screen, text,
} from '@scada/hmi';

const plc = screen('plc', {
  title: 'Saturn PLC · стенд',
  route: '/plc',
  body: [
    group('plcHeader', [
      button('plcBack', '← Обзор', back(), { className: 'hmi-back' }),
      text('plcTitle', 'SATURN-1', { as: 'h1' }),
      text('plcSubtitle', 'AI1 → FBD runtime → DO1 → реле → лампа', { as: 'p' }),
    ], { className: 'hmi-page-head' }),
    group('plcProcess', [
      equipmentView('plcFront', 'SATURN-1', {
        renderer: 'saturn-plc',
        props: {
          input: bind('SATURN-1.AI1'),
          output: bind('SATURN-1.DO1'),
          healthy: bind('SATURN-1.healthy'),
        },
      }),
      equipmentView('plcLamp', 'LAMP-1', {
        renderer: 'lamp',
        props: { brightness: bind('LAMP-1.brightness') },
      }),
    ], { className: 'hmi-process' }),
    group('plcValues', [
      group('levelValue', [
        text('levelLabel', 'Тестовый уровень', { as: 'label' }),
        readout('levelReadout', bind('BENCH-LEVEL.value'), { unit: 'V', digits: 1 }),
      ], { className: 'hmi-value-card' }),
      group('aiValue', [
        text('aiLabel', 'AI1', { as: 'label' }),
        readout('aiReadout', bind('SATURN-1.AI1'), { digits: 0 }),
      ], { className: 'hmi-value-card' }),
      group('doValue', [
        text('doLabel', 'DO1', { as: 'label' }),
        readout('doReadout', bind('SATURN-1.DO1'), { digits: 0 }),
      ], { className: 'hmi-value-card' }),
    ], { className: 'hmi-values' }),
    group('plcCommands', [
      button('level3', '3 V · реле выкл.', operate('BENCH-LEVEL', 3), { className: 'hmi-command' }),
      button('level7', '7 V · включить реле', confirm('Подать тестовый уровень 7 V на вход стенда?', operate('BENCH-LEVEL', 7)), { className: 'hmi-command hmi-command-primary' }),
    ], { className: 'hmi-command-row' }),
    text('plcNote', 'Команда меняет уставку тестового источника. DO1 вычисляет тот же FBD runtime, который исполняется в Firmverse.', { as: 'p', className: 'hmi-note' }),
  ],
});

const overview = screen('overview', {
  title: 'Пульт оператора',
  route: '/',
  body: [
    group('overviewHeader', [
      text('overviewEyebrow', 'SATURN SCADA · HMI AS CODE', { as: 'p', className: 'hmi-eyebrow' }),
      text('overviewTitle', 'Стенд Saturn PLC', { as: 'h1' }),
      text('overviewSubtitle', 'Один TypeScript-проект описывает экран, сигналы, навигацию и управление.', { as: 'p' }),
    ], { className: 'hmi-page-head' }),
    group('overviewProcess', [
      equipmentView('overviewPlc', 'SATURN-1', {
        renderer: 'saturn-plc',
        props: {
          input: bind('SATURN-1.AI1'),
          output: bind('SATURN-1.DO1'),
          healthy: bind('SATURN-1.healthy'),
        },
      }),
      equipmentView('overviewLamp', 'LAMP-1', {
        renderer: 'lamp',
        props: { brightness: bind('LAMP-1.brightness') },
      }),
    ], { className: 'hmi-process' }),
    group('overviewStatus', [
      group('overviewLevel', [
        text('overviewLevelLabel', 'Источник', { as: 'label' }),
        readout('overviewLevelValue', bind('BENCH-LEVEL.value'), { unit: 'V', digits: 1 }),
      ], { className: 'hmi-value-card' }),
      group('overviewOutput', [
        text('overviewOutputLabel', 'Выход PLC', { as: 'label' }),
        readout('overviewOutputValue', bind('SATURN-1.DO1'), { digits: 0 }),
      ], { className: 'hmi-value-card' }),
      button('openPlc', 'Открыть SATURN-1 →', navigate(plc), { className: 'hmi-open' }),
    ], { className: 'hmi-values' }),
  ],
});

export const operatorHmi = hmi('commissioning', {
  initial: overview,
  screens: [overview, plc],
});
