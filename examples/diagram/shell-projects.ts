/** Local projects use the same source document as the landing preview. */
export const examples = {
  pump: {
    title: 'Насосная станция', subtitle: 'Подача воды · 5 объектов',
    source: `import { tank, pump, valve, flowmeter, outlet, connect } from "@scada/core";

// Первый проект начинается с работающего примера.
const reservoir = tank("TK-01", { x: 40, y: 180, level: 68 });
const motor = pump("P-01", { x: 330, y: 268, rpm: 1850 });
const meter = flowmeter("FT-01", { x: 655, y: 160 });
const gate = valve("V-01", { x: 865, y: 96, opening: 80 });
const system = outlet("OUT-01", { x: 1150, y: 178 });

connect(reservoir.outlet, motor.inlet);
connect(motor.outlet, meter.inlet);
connect(meter.outlet, gate.inlet);
connect(gate.outlet, system.inlet);
`,
  },
  thermal: {
    title: 'Тепловой контур', subtitle: 'Передача тепла · 6 объектов',
    source: `import { tank, pump, valve, exchanger, outlet, temperature, connect, tap } from "@scada/core";

const reservoir = tank("TK-02", { x: 40, y: 240, level: 82 });
const motor = pump("P-02", { x: 330, y: 328, rpm: 1450 });
const gate = valve("V-02", { x: 650, y: 180, opening: 65 });
const heater = exchanger("HX-01", { x: 925, y: 197, temperature: 72 });
const system = outlet("OUT-02", { x: 1260, y: 262 });
connect(reservoir.outlet, motor.inlet);
connect(motor.outlet, gate.inlet);
connect(gate.outlet, heater.inlet);
const supply = connect(heater.outlet, system.inlet);
tap(supply, temperature("TT-01", { value: 72, at: 0.5, offset: 110 }));
`,
  },
} as const;
export type ExampleId = keyof typeof examples;
export const emptySource = `import { tank, pump, valve, flowmeter, exchanger, outlet, connect } from "@scada/core";

// Добавьте оборудование из каталога или опишите установку здесь.
`;
