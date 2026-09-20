# Installation DSL

The project is a map of UTF-8 source files with `plant.ts` as its entry. It is a bounded declarative TypeScript subset, interpreted through the TypeScript AST. No project code is evaluated as JavaScript. Named imports, const declarations, explicit values, ordinary scalar arithmetic, arrays/spreads and installed DSL functions are supported. Relative imports resolve only inside the immutable supplied project. Functions, loops, getters, arbitrary calls and imports from the network/filesystem are rejected.

For a normal TypeScript-aware IDE, the same functions are available through the public `./plant` package export. The workbench's metadata validator remains authoritative at runtime.

## Decomposition

```ts
import { system, simulation, bank, aggregate, derived, signal } from '@saturn/core';

export const cooling = system('cooling', 'Circulation', 'unit');
export const supply = simulation('GRID', 'supply', {
  system: 'cooling', at: { x: 20, y: 40 },
  parameters: { voltage: 1 },
});
export const pumps = bank('PUMP-', 'pump', {
  count: 4, columns: 2, pitch: { x: 240, y: 180 },
  system: 'cooling', at: { x: 260, y: 40 },
  inputs: { voltage: supply.voltage, resistance: signal('loop.resistance') },
  parameters: { inertia: 6 },
});
export const totalFlow = derived('loop.flow', aggregate(pumps, 'flow', 'sum'), 'отн.');
```

A bank is expanded to ordinary nodes with stable IDs before execution. It is not a special kernel construct. A new module can declare a subsystem, repeated equipment, and exported aggregate signals; the root project imports the public exports. The current limits are 128 files/2 MB, 256 simulated components, 512 devices/signals/systems, 32 reports, 128 instances per bank, and bounded expression nesting/evaluation. Large assemblies are represented as explicit aggregate models, not automatically converted from engineering drawings.

Model output keys, input names and parameter names are inferred from literal metadata. An invalid output like `supply.nonexistent` or a misspelled pump parameter fails the standalone TypeScript test. Signals can be wired across modules and hierarchy levels. The hierarchy owns navigation and naming; it does not execute a separate duplicated simulation per view.

## Signals and equipment

`simulation()` declares a trusted installed stateful model. Its outputs are signal expressions. `signal('stable.id.output')` references a signal by ID; `derived()` defines an algebraic output. `add`, `sub`, `mul`, `div`, `min`, `max`, and `aggregate` compose values. Algebraic cycles fail validation. Feedback through stateful components is allowed and executes against the complete previous step, independent of declaration order.

`equipment()` binds arbitrary signal expressions to an installed visual type. When omitted from the project, devices are derived from simulation metadata. A visual consumes observations and never advances a model. A device may use a derived value or the output of a model in another subsystem. The current live source is simulation; real PLC/network adapters are **not implemented by this change**.

```ts
import { equipment, signal } from '@saturn/core';
export const gauge = equipment('FLOW-GAUGE', 'sensor', {
  system: 'cooling', at: { x: 50, y: 250 },
  signals: { value: signal('loop.flow') },
});
```

Measurements remain outside source files. Operator simulation commands write the run's overrides and journal rather than rewriting the project. Persistent parameter changes are authored, committed and published explicitly. Installation metadata/models are trusted source shipped with the app. Model registration and `ModelCatalog` module augmentation are the extension points; importing an arbitrary user model file into the runtime is deliberately not supported.

## Historian policy

```ts
const measured = derived('loop.measured-flow', signal('loop.flow'), 'отн.', {
  deadband: 0.01,
  maxInterval: 10000,
  retention: 86400000,
});
```

The same policy can be set for a model output using `history: { flow: { ... } }` in `simulation()`. Project defaults apply otherwise. All durations are milliseconds. Deadband affects storage, not alarm evaluation. Quality changes are always archived. A stable simulated signal is periodically confirmed because the model actually executed; an idle UI connection is never used as evidence of a fresh physical measurement.

## Alarms

```ts
import { alarm, signal } from '@saturn/core';
const highTemperature = alarm('temperature-high', {
  title: 'High temperature', signal: signal('loop.temperature'),
  above: 1.6, clearBelow: 1.5, delay: 1000,
  priority: 'critical', notify: true,
});
```

Alarm activation, acknowledgement, return to normal and measurement quality are separate state. The threshold values here are only an example for normalized simulation units, not plant setpoints. Model protection is distinct from an operator notification.

## Reports

```ts
import { report } from '@saturn/core';
export const flow = report('flow-hour', {
  title: 'Flow history',
  on: {
    workflow_dispatch: {
      inputs: { scale: { type: 'number', default: 1, min: 0.1, max: 10 } },
    },
    schedule: [{ cron: '0 * * * *' }],
  },
  signals: ['loop.flow'],
  window: 3600000,
  sql: `SELECT signal,
    SUM(CASE WHEN quality='good' THEN value*(end-start) END)
      / NULLIF(SUM(CASE WHEN quality='good' THEN end-start END),0)
      * :scale AS average,
    100.0 * SUM(CASE WHEN quality='good' THEN end-start ELSE 0 END)
      / MAX(1,:to-:from) AS coverage
    FROM segments GROUP BY signal`,
  columns: [
    { key: 'signal', title: 'Signal' },
    { key: 'average', title: 'Time-weighted mean' },
    { key: 'coverage', title: 'Coverage', unit: '%' },
  ],
  notify: true,
});
```

`window`, alarm delay, and archive intervals use milliseconds; cron uses UTC wall clock. The report interval uses the run's model clock. A paused run therefore generates a report over unchanged model time, not invented measurements. A report cannot override its `from`/`to` boundaries through manual parameters.

Read-only tables in the report capsule:

```sql
samples(signal TEXT, time INTEGER, value REAL, quality TEXT)
segments(signal TEXT, start INTEGER, end INTEGER, value REAL, quality TEXT)
```

For volume from a flow rate in m³/h, integrate good segments with `SUM(value*(end-start)/3600000.0)` and expose coverage. Such units are not implicitly assumed for normalized model signals. Counter resets/rollovers are not automatically corrected by this generic query API.

For a chart, return an x column and a numeric-or-null y column and specify `chart: {x, y, title}`. Null/unknown points split the SVG line. Templates are deliberately limited to an escaped table and optional SVG plot, rather than unrestricted HTML/JS execution. Import of third-party report formats belongs in external migration adapters, not the core. Adding a new report needs no HTTP route or rendering component.

## Root

The default export is `project(id, {...})` with systems, simulations, derived signals, alarms and reports. `overview` optionally names the dashboard metrics; no Chernobyl-specific signal IDs are hard-coded in the UI. See executable multi-file examples under `plant/demo/` and the public typed consumer test in `plant/tests/sdk-types.ts`.

## Operator input signals

`control()` declares bounded, rate-limited operator input with separate requested/actual/blocked signals, optional continuously checked `enableWhen`, fail-closed `safeValue` and `blockedReason`. Include the references in `project({ controls: [...] })`. These live commands never edit the authored project. See the [full operator-control example](operator-controls.md).
