import {
  bind, button, command, confirm, dialog, hmi, navigate, open, readout, screen, text,
} from '../src/hmi';

const stopPump = dialog('stopPump', {
  title: 'Остановить насос?',
  body: [
    text('stopPumpText', 'Остановить P101?'),
    button('stopPumpConfirm', 'Остановить', command('P101', 'stop')),
  ],
});

const main = screen('main', {
  title: 'Насосная станция',
  route: '/',
  body: [
    text('title', 'Насосная станция', { as: 'h1' }),
    button('openP101', 'P101', navigate('pump', { id: 'P101' })),
  ],
});

const pump = screen('pump', {
  title: 'Насос',
  route: '/pump/:id',
  body: [
    readout('current', bind('P101.current'), { unit: 'A', digits: 1 }),
    button('start', 'Пуск', command('P101', 'start')),
    button('stop', 'Стоп', confirm('Остановить P101?', open(stopPump))),
  ],
});

export const operatorHmi = hmi('operator', {
  initial: main,
  screens: [main, pump],
  dialogs: [stopPump],
});
