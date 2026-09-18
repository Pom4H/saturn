# Saturn

**Saturn is an open-source, source-first SCADA for building industrial monitoring and control projects as code.**  
MIT licensed. The authored project is a bounded TypeScript DSL; the visual shell, HMI, reports, alarms, historian and deployment metadata are projections of the same project model.

> Status: **MVP in active development.** Saturn is an engineering/runtime platform, not a certified safety system. Do not use it as the sole protection layer for hazardous equipment.

## Why Saturn

Traditional SCADA projects often split configuration across proprietary editors, report designers, PLC tools, databases and deployment archives. Saturn keeps the authored intent in reviewable source files and derives the operator experience from it.

- **Project as code.** Systems, equipment, signals, controls, alarms, reports and PLC bindings live in a declarative TypeScript subset.
- **Computed HMI.** The system hierarchy becomes screens and navigation; equipment/signals become widgets; controls become commands. Manual HMI DSL is an override, not a second model.
- **Visual + code editing.** Report/HMI editors show TypeScript beside the visual projection. Selecting a widget jumps to the source declaration; supported property edits patch the same TS draft.
- **2D and 3D from one identity graph.** Equipment IDs, terminals, routes, signals and selection are shared.
- **Historian and reports.** SQLite-backed history, alarm lifecycle, manual/cron report jobs, shared HMI/report presentation primitives.
- **Git-backed releases.** Draft, commit, publish and rollback are explicit operations. Runtime history is not rewritten when project source changes.
- **Isomorphic demo/runtime.** Node.js server for persistent authenticated operation; browser Worker + SQLite WASM/OPFS for an installable offline PWA demo.
- **PLC toolchain integration.** Saturn can compile and execute the supported Saturn/Firmverse FBD target in isolated WASM instances and render its HMI. Hardware flashing is not part of the MVP.

## Quick start

Requirements: Node.js 24 LTS is the primary development toolchain. The plant runtime is also tested on supported Node 22 builds.

```sh
git clone https://github.com/Pom4H/scada.git
cd scada
npm ci
npm run plant
```

Open:

- authenticated server: `http://127.0.0.1:4176/plant/app/`
- autonomous PWA demo: `http://127.0.0.1:4176/plant/demo/`

A new local server prints the initial engineer password once. Save it.

For development checks:

```sh
npm run plant:check
npm run check
npx playwright install --with-deps chromium-headless-shell
xvfb-run -a npm run plant:test:browser
```

## Project model

A Saturn project is a set of UTF-8 files with `plant.ts` as the entry point. Saturn parses a bounded declarative TypeScript subset; project source is **not** evaluated as arbitrary JavaScript.

```ts
import {
  project, system, simulation, control, alarm, report,
  signal, derived, panel, readout, trend
} from '@scada/plant';

const cooling = system('cooling', 'Cooling');

const pump = simulation('P-101', 'pump', {
  system: 'cooling',
  at: { x: 260, y: 180 },
  inputs: { voltage: signal('GRID.voltage'), resistance: 0.3 },
  parameters: { inertia: 6 },
});

const flow = derived('cooling.flow', pump.flow, 'm3/h');

const speed = control('P-101-speed', {
  title: 'Pump speed',
  system: 'cooling',
  unit: '%',
  min: 0,
  max: 100,
  initial: 60,
  rate: 10,
  step: 1,
});

const lowFlow = alarm('low-flow', {
  title: 'Low flow',
  signal: flow,
  above: -1,
  clearBelow: -2,
  delay: 1000,
  priority: 'warning',
  notify: true,
});

export default project('demo', {
  title: 'Example installation',
  systems: [cooling],
  simulations: [pump],
  controls: [speed],
  signals: [flow],
  alarms: [lowFlow],
  reports: [],
});
```

The exact available models and typed metadata are defined by the installed model catalog. Unsupported topology or invalid signal references fail validation instead of silently producing guessed values.

## HMI is a projection of topology

Saturn does not require a second hand-maintained screen model for every subsystem.

By default:

```text
systems       -> screens + navigation
devices       -> equipment groups
signals       -> values / state
controls      -> operator actions
alarms        -> alarm state
connections   -> physical topology
```

`deriveHmi(project)` creates the screen graph deterministically. The visual shell can still add explicit `screen()`, `navigate()`, `animate()`, `panel()`, `readout()` and `commandButton()` declarations when a project needs a specialized operator view.

Signal-driven motion currently supports bounded `opacity`, `scale`, `rotate` and `pulse`. Animation state is derived from telemetry, not hidden UI state.

## Reports and HMI share a presentation model

The same bounded presentation tree is used by live HMI and immutable report artifacts:

```ts
const body = panel([
  readout('Flow', 'flow', 'm3/h', 1),
  trend('Last hour', 'time', 'flow'),
]);
```

A live HMI binds it to current samples and may expose audited commands. A report binds it only to its pinned data capsule and disables commands. Target-specific backends are explicit: a small PLC LCD supports only widgets its runtime can actually encode.

## Runtime architecture

```text
Project files
    |
    v
Bounded TS compiler
    |
    v
Validated Project --------------------------+
    |                                       |
    +--> topology --> 2D / 3D / Auto HMI    |
    +--> models ----> deterministic Kernel  |
    +--> alarms ----> alarm lifecycle       |
    +--> history ---> SQLite historian      |
    +--> reports ---> isolated SQL capsule  |
    +--> PLC -------> Firmverse compiler/WASM
    |
    v
Git revision -> explicit publish -> runtime revision
```

The UI never turns runtime telemetry back into source edits. Visual authoring changes the project draft; live operator commands change runtime state and are journaled separately.

## MVP scope

Included in the current MVP:

- multi-file project DSL and validation;
- hierarchical systems and equipment;
- 2D canvas and lazy 3D view;
- typed physical terminals and routed pipe/power/control/bus connections;
- deterministic installed process models and replay checkpoints;
- bounded operator controls and interlocks;
- alarm lifecycle, acknowledgement and optional Web Push;
- SQLite historian with per-signal deadband/retention policies;
- manual and UTC-cron reports;
- shared HMI/report presentation DSL;
- computed HMI screen graph;
- visual HMI/report studio linked back to TypeScript source;
- Git-backed commit/publish/rollback;
- authenticated Node server and autonomous PWA demo;
- supported Saturn/Firmverse FBD compile/execute/HMI path.

Not claimed by the MVP:

- SIL/IEC 61508/IEC 61511 certification;
- automatic import of arbitrary vendor PLC projects;
- general-purpose IEC 61131-3 runtime;
- engineering approval of cable sizing, protection coordination or hydraulic networks;
- complete CAD/P&ID authoring;
- multi-tenant enterprise identity/ACL administration;
- hardware flashing or commissioning of physical PLCs;
- a validated digital twin of any real nuclear or process plant.

## Documentation

- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Project DSL](docs/plant/dsl.md)
- [HMI and reports](docs/plant/presentation.md)
- [Server, PWA, Git releases and reports](docs/plant/README.md)
- [PLC / Firmverse integration](docs/plant/toolchain-integration.md)
- [Roadmap to 0.1](docs/roadmap.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Older editor/runtime experiments remain in the repository because parts of the MVP still reuse their component registry, source-preserving edits and test infrastructure. They are implementation history, not the product definition.

## License

Saturn is released under the [MIT License](LICENSE).

Third-party code and generated target assets retain their own licenses and provenance; see the vendor directories before redistributing derived binaries.

© 2026 Roman Popov
