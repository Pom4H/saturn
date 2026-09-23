# Operator signals and shared 2D/3D equipment

This extension is a normalized educational workbench, not a calibrated digital twin of a nuclear power station. No actual nuclear operating procedures, deliberate-accident control sequence, or validated reactor protection settings are supplied. The added control exercise operates a fictional auxiliary water and ventilation loop. Original heat-source/channel equations have not been upgraded to reactor physics.

## Authored model versus operating state

`control()` declares a named input channel. An operator sets its **requested** value; the runtime changes its **actual** value at the declared maximum rate. The declaration is versioned in Git; live commands and checkpoints are stored in SQLite. Changing a demand does not edit the project or override a model coefficient.

```ts
import { control, simulation, signal, gt } from '@saturn/core';

const demand = control('DRAW', {
  title: 'Water demand',
  system: 'services',
  min: 0, max: 1, initial: 0.5,
  rate: 0.1, // units per model second
  step: 0.01,
  enableWhen: gt(signal('BUFFER.level'), 10),
  safeValue: 0,
  blockedReason: 'Restore the buffer inventory before requesting flow.',
});

const valve = simulation('V', 'motor-valve', {
  system: 'services', at: { x: 200, y: 100 },
  inputs: { demand: demand.value },
});
```

Declare `BUFFER` and the `services` system elsewhere in the project and include `controls: [demand]` in `project()`. Existing `signal`, `derive`, alarm and report declarations can read `DRAW.value`, `DRAW.requested` and `DRAW.blocked`. Types infer these members; a raw JavaScript expression string is not an interlock.

`rate` is a positive finite slew limit. `step` is only the input-widget increment. The model and the interlock consume the previous fixed-step snapshot; the actuator retains its own dynamics. A closed gate forces the control signal to `safeValue` but does not teleport the physical actuator to a new state. Unknown gate inputs block the command. Gates are checked both on acceptance and every simulation step. A trip clears the old requested value: recovery never automatically resumes the previous demand. Pausing model time pauses the ramp.

The client sends an idempotency ID, project revision and run ID. Server/Worker authorization, range and gate checks are mandatory regardless of UI state. The checkpoint, accepted command and audit record share one SQLite transaction. The receipt means `accepted`, not that the actuator has reached its target. Rejected control commands do not modify the checkpoint. The UI shows actual value, requested value and block reason independently.

The older engineer-only model-parameter editor remains for testing model assumptions. It is not relabeled as an operator panel and is not a historical reactor-control interface.

## Auxiliary model

`examples/plant/auxiliary.ts` contributes three systems and six instances:

| Instance | Model | Coupling |
|---|---|---|
| AUX-TANK | reservoir | Inventory changes with actual makeup and delivered demand; empty supply limits flow; overflow is explicit. |
| AUX-VALVE | motor-valve | Opening follows the demand signal with a lag; flow depends on opening and a normalized head input. |
| AUX-UPS | ups | Stored energy is charged or drained according to external supply and load; zero energy removes reserve output. |
| AUX-FEEDER | switchgear | A latched overload condition removes feeder voltage. |
| AUX-FAN | fan | Airflow and electrical load follow a lagged speed driven by voltage and demanded output. |
| AUX-COOLER | heat-exchanger | Heat load and actual auxiliary airflow/water flow change stored temperature. |

Four operator controls adjust makeup, demand, ventilation and auxiliary heat load. Alarms observe calculated low inventory/interlocking, inadequate cooling and feeder trip. These are not additional reactor controls. All auxiliary coefficients remain illustrative. The reservoir balance is checked locally; the complete installation is not claimed to conserve all mass and energy or reproduce real electrical/hydraulic networks.

The assembled project has **29 instances, 13 navigation systems, 15 installed model/visual types and four operator controls**. The inventory tab lists modeled equipment, searches by instance/model/system and focuses the matching subsystem. This inventory is not a bill of materials for a real power station.

## Consistent 2D and 3D

The existing SVG host and `SceneView3D` host remain in use. New equipment shares their brushed-metal, dark casing, teal process and copper accents. Every installed visual now has separate schematic multipart 3D anatomy rather than a generic cylinder/box placeholder. Existing 2D equipment designs are retained; five corresponding 2D symbols are added.

Both views consume the same equipment IDs, frame, selected object, quality and alarm facts. Rotors, valve indicators, reservoir fill, battery charge and instrument needles read runtime observations; renderers never advance a simulation. Unknown measurements hide indicators rather than display a fabricated zero. 3D is lazily loaded and its public assets are included in the demo's offline cache. WebGL failure leaves 2D available with an explicit message.

Dashed curves denote **signal dependencies**, not fluid pipes or surveyed coordinates. Component geometry is schematic, not CAD or RBMK construction data. Repeated blades, plates and rod-shaped illustrative details use instancing. Disposal releases owned geometry, instance buffers and materials without disposing host-shared materials.

## Verification and limits

Run `npm run plant:check`, `npm run check`, then `npm run plant:test:browser`. On a headless Linux host without a display, software WebGL may require `xvfb-run -a npm run plant:test:browser`. `PWA_CHROMIUM` can select an already installed isolated Playwright browser. Browser tests have bounded timeouts; no production settings or browser policy files are modified.

Native tests cover control declarations and types, ramp/pause, gate failures, idempotency, permissions, stale runs, persistence, rejected commands, reservoir balance, bounded UPS state and actual 3D geometry/disposal. A deterministic auxiliary command trace runs in both Node and the browser and compares control values, interlocking, reservoir and actuator outputs. Browser scenarios cover the real operator panel, inventory navigation, actual WebGL, offline lazy loading, mobile overflow and authenticated Node/SSE commands. Screenshots are actual render output.

These tests establish implementation behavior, not nuclear-plant or historical accuracy. External push delivery to a physical phone, measured graphics performance on end-user devices, physical calibration, a complete plant equipment inventory, multi-year operational retention and production qualification remain unverified or out of scope. No public deployment is implied by a local test.
