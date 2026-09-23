export const booster = `import {
  tank, pump, valve, flowmeter, exchanger,
  outlet, pipe, tap, pressure, temperature
} from "@saturn/core";

// Координаты меняются здесь при перетаскивании.
const reservoir = tank("T-101", {
  x: 40, y: 250, level: 64
});
const motor = pump("P-101", {
  x: 325, y: 338, rpm: 1500
});
const meter = flowmeter("F-101", {
  x: 650, y: 206
});
const gate = valve("V-101", {
  x: 815, y: 142, opening: 76
});
const heater = exchanger("HX-101", {
  x: 1065, y: 159, temperature: 72
});
const system = outlet("OUT", {
  x: 1350, y: 224
});

// Связи привязаны к портам, не к пикселям.
pipe("PIPE-101", reservoir.outlet, motor.inlet);
const discharge = pipe("PIPE-102", motor.outlet, meter.inlet);
pipe("PIPE-103", meter.outlet, gate.inlet);
pipe("PIPE-104", gate.outlet, heater.inlet);
const delivery = pipe("PIPE-105", heater.outlet, system.inlet);

// Приборы следуют за своими линиями.
tap(discharge, pressure("PT-101", {
  value: 5.8, at: 0.7, offset: 110
}));
tap(delivery, temperature("TT-101", {
  value: 72, at: 0.5, offset: 110
}));
`;
export const twin = `import { tank, pump, valve, outlet, pipe } from "@saturn/core";

// Два независимых контура: закрытие V-101 не влияет на V-102.
const tankA = tank("T-101", { x: 40, y: 150, level: 72 });
const pumpA = pump("P-101", { x: 330, y: 238, rpm: 1500 });
const valveA = valve("V-101", { x: 680, y: 50, opening: 100 });
const outA = outlet("OUT-A", { x: 1000, y: 132 });
pipe("PIPE-A1", tankA.outlet, pumpA.inlet);
pipe("PIPE-A2", pumpA.outlet, valveA.inlet);
pipe("PIPE-A3", valveA.outlet, outA.inlet);

const tankB = tank("T-102", { x: 40, y: 560, level: 48 });
const pumpB = pump("P-102", { x: 330, y: 648, rpm: -1000 });
const valveB = valve("V-102", { x: 680, y: 460, opening: 50 });
const outB = outlet("OUT-B", { x: 1000, y: 542 });
pipe("PIPE-B1", tankB.outlet, pumpB.inlet);
pipe("PIPE-B2", pumpB.outlet, valveB.inlet);
pipe("PIPE-B3", valveB.outlet, outB.inlet);
`;
export const empty = `import { tank, pump, valve, outlet, pipe } from "@saturn/core";

// Добавьте оборудование кнопкой «+ Элемент» или напишите DSL.
// Для соединения нажмите выходной порт, затем входной.
`;
export const serverDemo = `import { runtime, tank, pump, valve, flowmeter, outlet, pipe, tap, pressure } from "@saturn/core";

// Только декларация. Подключение выполняется кнопкой, токен вводится отдельно.
runtime({ server: "http://127.0.0.1:4175", project: "pump-demo" });

// Синтетическая последовательная установка; не расчёт гидравлики.
const source = tank("T-101", { x: 40, y: 160, level: 75 });
const motor = pump("P-101", {
  x: 340, y: 248, rpm: 1500, nominalFlow: 12,
  degradationRate: 0.02, startDelay: 1, maintenanceSeconds: 3
});
const meter = flowmeter("F-101", { x: 675, y: 236 });
const gate = valve("V-101", { x: 955, y: 160, opening: 85 });
const outlet1 = outlet("OUT", { x: 1265, y: 242 });
pipe("PIPE-101", source.outlet, motor.inlet);
const discharge = pipe("PIPE-102", motor.outlet, meter.inlet);
pipe("PIPE-103", meter.outlet, gate.inlet);
pipe("PIPE-104", gate.outlet, outlet1.inlet);
tap(discharge, pressure("PT-101", { at: 0.5, offset: 110 }));
`;
export const examples: Record<string, { name: string; source: string }> = {
  booster: { name: 'Насосная линия', source: booster },
  server: { name: 'Сервер · деградация насоса', source: serverDemo },
  twin: { name: 'Два контура', source: twin },
  empty: { name: 'Пустой проект', source: empty },
};
