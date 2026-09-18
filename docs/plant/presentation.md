# HMI and report presentation model

Saturn uses one bounded presentation model for live HMI and immutable report artifacts. Layout is not a database-side object and does not become a second source of truth.

## Computed HMI first

Most projects do **not** need to hand-author every screen.

`deriveHmi(project)` deterministically projects the compiled topology:

- system hierarchy → screens and parent/child navigation;
- equipment → groups;
- published signals → readouts;
- controls → audited command buttons;
- source identity → links back to the originating project declaration.

The shell caches the derived screen graph until the compiled Project changes. New telemetry updates bound values and motion without rebuilding topology.

Manual screens are an override for specialized operator workflows.

## Presentation DSL

```ts
import {
  panel, label, readout, trend, dataTable,
  commandButton, screen, navigate, animate, view, signal
} from '@scada/plant';

const main = screen('main', 'Main', panel([
  label('Cooling'),
  readout('Flow', 'flow', 'm3/h', 1),
  animate(
    readout('Pump', 'running', '', 0),
    'running', 'pulse',
    { min: 0, max: 1, from: 0, to: 1 },
  ),
  commandButton('Start', 'PUMP-A', 1),
  navigate('Diagnostics →', 'diagnostics'),
]));

const diagnostics = screen('diagnostics', 'Diagnostics', panel([
  trend('Flow', 'time', 'flow'),
  navigate('← Main', 'main'),
]));

export const coolingHmi = view('cooling-hmi', {
  title: 'Cooling',
  bindings: {
    flow: signal('cooling.flow'),
    running: signal('PUMP-A.running'),
  },
  body: main.body,
  screens: [main, diagnostics],
  initial: 'main',
});
```

Supported web nodes:

- `panel()`
- `label()`
- `readout()`
- `trend()`
- `dataTable()`
- `commandButton()`
- `navigate()`
- `animate()`

Signal-driven motion supports bounded `opacity`, `scale`, `rotate` and `pulse`. Motion is recomputed from signal values; it does not introduce hidden simulation state.

## Visual Studio

The HMI and report tabs use the same authoring rule:

```text
TypeScript source | visual projection | selected-node properties
```

A widget carries source provenance. Selecting it highlights the corresponding TS range. Supported visual property edits patch that exact draft and recompile preview. Nothing reaches the active runtime until the project is committed and published.

Computed HMI nodes link back to the topology declaration that produced them rather than to synthetic generated source.

## Commands

`commandButton()` references an existing declared control. It does not create a new command API.

A live action passes through the normal authorization, revision, range/interlock and command-journal path. Report rendering always disables actions.

All screens are validated, not only the initial screen.

## Reports

A report can reuse presentation nodes but has a different data boundary.

```ts
const reportView = view('flow-report-view', {
  title: 'Flow report',
  bindings: { flow: signal('cooling.flow') },
  body: panel([
    readout('Flow', 'flow', 'm3/h', 1),
    trend('Last hour', 'time', 'flow'),
    dataTable([
      { key: 'time', title: 'Time' },
      { key: 'value', title: 'Flow', unit: 'm3/h' },
    ]),
  ]),
});
```

A live HMI reads the current frame. A report receives only its declared, pinned data capsule and SQL result rows. Samples beyond the report cutoff are not visible to the renderer.

## Target capabilities

Presentation capability is target-specific.

The web target supports multi-screen navigation, tables, trends, actions and motion. A PLC LCD target compiles only widgets its actual screen runtime supports. Unsupported widgets, screen count or layout overflow are compile errors.

Saturn does not silently drop unsupported UI elements.

## Budgets

Web and PLC budgets are intentionally separate. Large web projects may have many subsystem screens, while a constrained controller display stays tightly bounded.

Current limits are implementation safeguards, not a product promise; changing a limit must keep validation and browser/runtime tests together.
