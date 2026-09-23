# Physical connections, Saturn PLC and engineering readiness

This is a runnable, isolated commissioning workbench. The existing historical
reactor-themed diagram has not become an operational NPP control design.

## One source, distinct engineering relations

`system()` groups the same canvas with nested backplates. A `signal()` or model
input expression means a data dependency. `pipe()` and `cable()` describe explicit
physical endpoints. These are different relations; drawing a data dependency does
not invent a pipe or a safe electrical circuit.

Every installed connection port has a name, 2D anchor, 3D height/normal, medium,
family, direction and occupancy limit. The SVG terminal circle, procedural 3D
connector and routed line use the same metadata. Saturn anchors come from the
original reference front-panel drawing. The router leaves that anchor in its
normal direction, avoids padded equipment footprints and changes elevation only
outside the body. Invalid routes are visible as errors rather than falsely shown
as collision-free. There is no routing computation on ordinary telemetry updates.

Four media are present: `pipe`, `power`, `control`, `bus`. Checks reject unknown
ports, opposite polarities/families, reversed drivers, duplicate connection IDs
and occupied inputs. A multi-drop source must explicitly allow fanout; joining two
wires visually never implicitly connects them. RS-485 A/B are separate conductors.

**Limits:** this is a connection drawing with selected signal propagation, not a
Kirchhoff solver, wire-sizing/protection calculation, pressure-loss network solver
or calibrated two-phase thermohydraulics. The existing generic power models use
normalized drive signals; the isolated commissioning bench explicitly uses a
12–24 V DC convention. Polarity/family checks do not constitute electrical approval.
There is no automatic conversion between unlabelled physical units. The declared
`scale` on a control wire is an explicit engineering-to-runtime conversion.

## Working DSL

See `plant/demo/commissioning.ts`, an imported module of the same project:

```ts
import {system, simulation, control, plc, pin, gt, port, cable} from '@saturn/core';

export const bench = system('commissioning', 'PLC · клеммы', 'site');
export const level = control('BENCH-LEVEL', {
  title: 'Датчик уровня · тестовый сигнал', system: 'commissioning',
  min: 0, max: 10, initial: 3, rate: 1, unit: 'V',
});
export const sensor = simulation('LEVEL-TX', 'transmitter', {
  system: 'commissioning', at: {x: 480, y: 3480},
  inputs: {value: level.value},
});
export const controller = plc('SATURN-1', {
  system: 'commissioning', at: {x: 760, y: 3100},
  outputs: {DO1: gt(pin('AI1'), 500)},
  hmi: {title: 'Commissioning bench', rows: [
    {label: 'AI1 x100', pin: 'AI1'}, {label: 'Relay DO1', pin: 'DO1'},
  ]},
});
export const levelWire = cable('level-input',
  port(sensor, 'value'), port(controller, 'AI1'),
  {medium: 'control', scale: 100});
```

The full demo supplies DC+, DC− and the common, a relay, lamp and virtual module.
Commands affect the test source; its value reaches the PLC through the declared
wire. The compiled program drives the relay and the relay supplies the lamp.
Removing supply/common or required input marks the PLC unhealthy, blanks its
HMI and deenergizes the test relay. The virtual module requires matching power
and both bus conductors (including declared daisy chains); unconnected AI channels are unknown, not good zeros.

Click a PLC in 2D or 3D for its original SVG front panel, actual input/output
values and the display emitted by its runtime. Click two compatible terminals
(or use their inspector buttons) to append a declaration to `wiring.ts:userWires`.
Removing a connection edits its explicit literal call. These operations are
**draft edits**: commit and publish remain explicit and runtime observations never
rewrite authored source. Visual editing refuses computed/non-local declarations
it cannot safely patch; the code editor remains available.

`expansion(module, controller, slot)` assigns a virtual AI4 module. The UI can
create such a module and its file. A module cannot occupy two slots/controllers.
It is deliberately labelled **virtual-io4**, not a counterfeit hardware part.
Its analog signals can feed SCADA expressions. The current Saturn target does
**not** map virtual expansion signals into physical expansion FBD addresses.
Physical Saturn module protocols, channel maps and board revisions need their
own verified target profile; guessing addresses would make the build unsafe.

## What actually gets built

The installed `saturn-fbd/combinational-v1` compiler generates a CRC-valid
`.fbdbin` using the reused Saturn builder. The very same bytes execute in the
pinned upstream WASM runtime on Node and in the browser. HMI is part of that
artifact and returns 320×240 draw commands rendered inside the 2D face and on the
3D display texture. Program and build manifest have separate download buttons.

Supported PLC expressions: int32 constants, base DI1–DI10 / AI1–AI2 references,
comparisons, binary AND, NOT, MIN/MAX; base DO1–DO11 / AO1–AO2 outputs. Unknown pins,
fractional/out-of-range constants, unsupported operations, timers and RTC reject
at compilation. At most four controllers per project and 256 blocks per program.
The checkpoint also pins the controller runtime ABI/hash and rejects mismatches.
The stateless subset is intentional: there is no undocumented timer/latch state
that would be lost by restoring a browser checkpoint. Stateful blocks require a
versioned runtime-state serialization ABI before adding them.

The scan uses a previous-step input image, executes the program, then publishes
an output image. Integer inputs, bounded explicit steps and stable compilation
are covered by Node/browser parity tests. A redraw may regenerate screen commands
from the same input image; accepted programs are combinational, so this does not
advance hidden timer state. Model update order does not depend on rendering.

**`.fbdbin` is application-program data for an already installed FBD environment,
not a complete board firmware image.** No bootloader, HAL, linker/startup files,
transport to a physical PLC, flash writer or firmware signing infrastructure was
fabricated. Every build manifest says `hardwareVerified: false`, records its
revision and runtime hash, and lists target limitations. No real hardware was
programmed or tested. Repeatable software behavior alone does not establish
hardware compatibility or safe plant control.

## Expressiveness assessment

| Concern | Executable today | Remaining boundary |
|---|---|---|
| Decomposition | Modules/imports, systems, banks, shared signals | No plant-specific completeness specification |
| Layout | One canvas, nested plates, shared 2D/3D port anchors | Schematic coordinates, no surveyed CAD model |
| Connectivity | Typed media/families, named contacts, routes, slots | No certified electrical/hydraulic network analysis |
| Behavior | Installed fixed-step models, signal expressions and controls | Not a general-purpose solver or unrestricted TS runtime |
| PLC | Actual target builder and WASM, bounded integer expressions | Timers/stateful blocks and real expansion maps not exported |
| HMI | Same values in desktop 2D/3D and compiled local 320×240 screen | No automatic conversion of arbitrary 3D scenes to the PLC LCD |
| Operations | Historian, alarm lifecycle, reports, Git publication | Not an NPP-qualified protection/monitoring system |

The design now expresses **what is installed, how it is connected, which signals
it consumes, what it computes and how it is shown** without writing a new UI per
instrument. It does not yet express every aspect of a real engineered plant.
`pin('AI1')` names a controller-local program input; `signal('LEVEL-TX.value')`
names an installation observation; `port(...)` names a physical connector. Keeping
these concepts distinct is necessary rather than DSL verbosity for its own sake.

## Completeness audit: not a full NPP equipment inventory

The updated example has 47 devices (46 model instances and one PLC), 18 groups,
30 installed generic model types, 7 controls and 23 explicit physical routes.
It adds a DC source, transmitter, relay, lamp and virtual I/O module. A generic
junction is also installed and tested, though it is not instantiated in the demo.
Counting rendered objects is not a completeness test against a real station.

| Engineering area | Current representation | Unverified or absent |
|---|---|---|
| Primary/reactor systems | Historical-themed normalized teaching blocks | Validated reactor physics, as-built component list and geometry |
| Water/steam/heat removal | Pumps, vessels, valves, exchanger, cooler symbols/models | Full P&IDs, pipe ratings, branches, conservation/phase-change model |
| Electrical power | Generic generator/transformer/drive/UPS symbols and low-voltage bench | Rated distribution network, protection coordination, redundancy qualification |
| Instrumentation/control | Signal graph, PLC bench, virtual I/O, HMI | Verified field I/O lists, cable schedules, redundant safety I&C, real module maps |
| Ancillary/support systems | Limited fan/filter/auxiliary examples | Complete ventilation, fire protection, water treatment and building-services scope |
| Fuel/radiological systems | Not modelled | Fuel handling/storage, radiological monitoring and waste-system inventory |
| Assurance | Executable software tests and documented scope | Site-specific requirements, component provenance/calibration, commissioning evidence |

A project-specific equipment register, P&IDs, cable/I/O lists, rated profiles and
acceptance criteria must be provided to assert that nothing required is missing.
This audit intentionally returns **not complete**; no cosmetic placeholder was
counted as a functioning safety system. Relevant public design/commissioning
context: IAEA SSR-2/1 (Rev.1), SSG-34 and the IAEA commissioning overview. These
references do not certify this implementation:

- https://www.iaea.org/publications/10885/safety-of-nuclear-power-plants-design
- https://www.iaea.org/publications/10688/design-of-electrical-power-systems-for-nuclear-power-plants
- https://www.iaea.org/topics/construction-and-commissioning-of-nuclear-power-plants
- https://saturn-plc.ru/ (manufacturer catalogue; real expansion products are not the virtual AI4)

## Verify

```sh
npm ci
npm run plant:check
xvfb-run -a npm run plant:test:browser
npm run check
```

Run sequentially because builds share `dist/`. Use the same application in Node
or as a static PWA. Existing user projects are preserved: import the updated
`scada-demo-project.json`, commit and publish to view the new bench. Changes to
routing waypoints/layout preserve a compatible run; changing electrical bindings
or the compiled controller program is a new configuration.
