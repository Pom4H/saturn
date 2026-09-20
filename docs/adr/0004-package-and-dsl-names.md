# ADR-0004: Saturn package names and project DSL

- **Status:** Accepted
- **Date:** 2026-09-20
- **Depends on:** ADR-0001, ADR-0002

## Decision

The product and application are named **Saturn**.

Canonical package names:

~~~text
@saturn/scada          application / distribution
@saturn/core           authored project DSL and portable contracts
@saturn/my-extension   extension-package naming pattern
~~~

The bounded project compiler treats `@saturn/core` as the canonical authored DSL module. `@scada/plant` remains a compatibility alias during migration; new examples and documentation must use `@saturn/core`.

Extensions are ordinary npm-compatible packages with a Saturn manifest. They may use any registry scope that an operator controls, but Saturn's own examples and first-party packages use the `@saturn/*` namespace.

## DSL boundary

One authored project compiles to one Project IR. Renderer, server, standalone, PLC tooling and HMI must consume that IR rather than inventing parallel project models.

The DSL is grouped by domain rather than by renderer:

- project structure: `project`, `system`;
- models: `simulation`, `equipment`, `bank`;
- signals: `signal`, `derived`, expression operators and `aggregate`;
- topology: `port`, `pipe`, `cable`, `expansion`;
- runtime inputs: `control`;
- PLC: `plc`, `pin`, `block`, `functionBlock`;
- presentation/report definitions: `view`, presentation nodes, `alarm`, `report`.

### Physical topology

`pipe()` is the preferred process-topology abstraction. A project declares that two typed ports are connected by a pipe; routing geometry, 2D/3D rendering and runtime topology consume the resulting `Connection`.

~~~ts
const suction = pipe(
  'suction',
  port(tank, 'outlet'),
  port(pump, 'inlet'),
)
~~~

`cable()` represents explicit electrical, control and bus media. A generic untyped `connect()` must not become the canonical installation API.

### Signals

A model output, `signal()`, `derived()`, alarm expression, control condition and UI binding should share the same expression/reference contract. Renderer-specific APIs must not introduce a second semantic signal identity.

## Interactive reference

The engineering shell includes a **DSL** section generated from the canonical Saturn vocabulary. It provides searchable entities, signatures, examples and cross-links between related concepts. The reference is a product surface, not a replacement for compiler/type validation.

## Consequences

- Saturn is the visible product name across the shell and PWA metadata.
- New authored examples use `@saturn/core`.
- Package/application identity no longer depends on the historical `@scada/*` namespace.
- Existing projects keep opening while the compatibility alias exists.
- New topology work should prefer `pipe()` / `cable()` over the legacy scene-level `connect()`.
