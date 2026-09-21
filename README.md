# Saturn

**Engineering systems as code.**

Saturn is an open-source engineering IDE and runtime for physical systems. Describe equipment, topology, signals, controls, HMI, history, alarms and reports as a typed TypeScript project — then use that same model in engineering, operation and deployment.

![Saturn turns one typed engineering model into HMI, signals, history, reports, PLC bindings and deployment](docs/assets/saturn-domain-model.svg)

[Open browser editor](https://pom4h.github.io/saturn/) · [DSL reference](docs/plant/dsl.md) · [Architecture](docs/adr/0001-saturn-system-architecture.md) · [Product & interface system](docs/design-system.md) · [Element packs](docs/developer/element-packs.md) · [Developer guide](docs/developer/language-tooling.md) · [Changelog](CHANGELOG.md)

## The project is the model

A traditional automation project tends to split one physical installation across PLC configuration, tag databases, HMI screens, historian setup, reports, deployment scripts and documentation.

Saturn keeps the engineering model in ordinary source files.

```ts
import {
  system,
  simulation,
  pipe,
  port,
} from '@saturn/core'

export const water = system('water', 'Water system')

export const tank = simulation('T-101', 'reservoir', {
  system: 'water',
  at: { x: 80, y: 180 },
})

export const pump = simulation('P-101', 'pump', {
  system: 'water',
  at: { x: 360, y: 180 },
})

export const suction = pipe(
  'suction',
  port(tank, 'outlet'),
  port(pump, 'inlet'),
)
```

The TypeScript source is not an export format generated after the fact. It is the authored project.

Saturn uses TypeScript for the things engineers already expect from serious software tooling: types, autocomplete, navigation, refactoring, diagnostics and source control. The Saturn compiler then adds domain rules for equipment, signals, topology, controls and deployment.

Projects are ordinary TypeScript. Saturn executes trusted project code only at the build boundary to construct a validated, serializable engineering IR; plant runtime never evaluates project TypeScript.

## One model, multiple projections

The same stable equipment IDs and bindings drive:

- **engineering views** — source, project tree, catalog, 2D/3D mnemonic and properties;
- **operator HMI** — live state, controls, alarms and navigation;
- **runtime** — signals, simulation or adapters, historian and replay;
- **reports** — project-defined queries, tables and charts over recorded data;
- **PLC and equipment integration** — controller definitions, ports, wiring and target providers;
- **delivery** — Git revisions, validation, release state and standalone deployment.

A renderer does not own another project model. A report does not invent another tag namespace. The VS Code host does not embed a second Saturn IDE. They are views over the same project and runtime contracts.

## Visual editing without a hidden project format

The canvas is another editor for the source.

```text
drag P-101
    ↓
change x / y in TypeScript
    ↓
normal Git diff
```

Source-preserving edits keep comments and unrelated code intact. Invalid source keeps the last valid view visible instead of reconstructing the project from SVG or JSON.

This also means coding agents and human engineers work on the same artifact.

## Configuration and live state are different things

Saturn deliberately separates Git from operational state.

```text
project folder
     │
     ├──── normal Git history
     │
     ▼
saturn build
     │
     ▼
immutable BuildArtifact
     │
     ├────► published ──────► applied
     │                         │
     │                         ▼
     │                    live runtime
     │               signals · history
     │               alarms · commands
     ▼
source SHA + build hash provenance
```

Git is source history for the engineering workspace. A content-addressed BuildArtifact is the deployment unit. The running Saturn instance is the authority for telemetry, history and operator commands.

An engineering Saturn can connect to an operator Saturn while keeping source, Git and package tooling local. The UI shows source SHA, build hash, published artifact and applied artifact independently.

See [Standalone Saturn](docs/standalone.md) and [ADR-0001](docs/adr/0001-saturn-system-architecture.md).

## Use Saturn where you engineer

Saturn is one application; projects stay ordinary directories.

```sh
saturn open ./pump-station
saturn run ./pump-station
saturn run ./pump-station --kiosk
```

The standalone application is built once and opens projects at runtime. Portable Windows, Linux and macOS binaries plus SHA-256 checksums are attached to GitHub Releases; the same targets can be built locally with the pack workflow.

The same project can also be used from the browser/PWA and from the native VS Code host. VS Code keeps TypeScript in the normal editor, Git in native SCM, diagnostics in Problems, project/catalog/targets in TreeViews and the mnemonic as a separate visual view.

## Extend the domain by copying source

Saturn uses a shadcn-style registry for project-owned building blocks.

```sh
saturn add pump
saturn add hourly-water-report
```

The command copies ordinary TypeScript/assets/tests into the project. After that there is no installed-extension state: the project owns the files and Git owns their history.

Use a normal package dependency only when the code is intentionally external and shared. The native host resolves packages; the offline PWA does not implement an npm client.

## Reports belong to the engineering model too

Reports are declared alongside signals and history policy rather than implemented as one-off application pages.

```ts
export const flowHour = report('flow-hour', {
  title: 'Flow history',
  signals: ['P-101.flow'],
  window: 3_600_000,
  sql: `SELECT signal, AVG(value) AS average
        FROM samples
        WHERE quality = 'good'
        GROUP BY signal`,
  columns: [
    { key: 'signal', title: 'Signal' },
    { key: 'average', title: 'Average' },
  ],
})
```

The runtime exposes bounded read-only history tables to report capsules. Reports can produce tables and SVG charts and can run manually or on a schedule.

See [report DSL](docs/plant/dsl.md#reports).

## What is implemented

The current codebase includes the typed `@saturn/core` DSL, source-preserving visual edits, CodeMirror engineering shell, 2D/3D views, equipment catalog metadata, alarms, controls, historian, replay/comparison, project-defined reports, content-addressed build/deploy artifacts, standalone packaging, a copy-based registry, a signed update protocol and a native VS Code host.

The repository also contains simulation models used for development and demonstrations. They are intentionally bounded engineering models, not validated process solvers.

## Safety and scope

Saturn is engineering software under active development. The included demonstration models are not safety models, certified control logic or substitutes for equipment-specific engineering calculations.

Real equipment control must pass through explicit adapters/providers with authentication, validation and capability boundaries. A visualization, simulator or report must never silently become a safety authority.

## Develop Saturn

Node.js 24 is used for the repository toolchain. Bun is used for standalone packaging.

```sh
npm ci
npm run check
npm run dev
```

Run the installation workbench:

```sh
npm run plant
```

Build a standalone application:

```sh
npm run saturn -- pack --target windows-x64
```

Useful documentation:

- [Saturn system architecture](docs/adr/0001-saturn-system-architecture.md)
- [Package and DSL names](docs/adr/0004-package-and-dsl-names.md)
- [TypeScript DSL and language tooling](docs/developer/language-tooling.md)
- [Standalone application](docs/standalone.md)
- [Installation, historian and report DSL](docs/plant/dsl.md)
- [VS Code host](docs/adr/0005-vscode-host.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## License

MIT © Roman Popov.
