# Unified canvas, equipment coverage and recovery exercises

## One drawing, visual groups

Every device stays on one scene. `system()` defines membership and parentage, and `at: {x, y}` remains the authored position. The scene derives padded nested backplates from component footprints, labels and children. No second saved layout or simulated device is created for a group.

The tree, keyboard-accessible SVG headers and inventory entries focus the camera; they never remove devices or cross-system dependencies. **Вся схема** fits the full installation. 2D and 3D share rectangles, palette, selected IDs and runtime frames. Group colors are structural, not alarm indications. Signal dependencies remain dashed, not invented physical pipes. Changing layout is not a process command.

Backplate tests check containment, header clearance, sibling overlap, title bounds, unchanged model state after moving layout, and no artificial group for an empty system. Browser tests check identical DOM node identity across navigation and all device/group counts in both representations.

## Equipment added in this iteration

The example contains **41 equipment instances, 17 visual groups, 24 installed model types, and 6 operator controls**. Nine new models have explicit SVG and multipart procedural 3D anatomy:

| Model | Behavior | Visible observation |
|---|---|---|
| Electric motor | Drive lag and normalized load | Shaft speed |
| Recirculating-water cooler | Cooling response to drive and flow | Fan speed |
| Strainer | Accumulation/flushing and pressure loss | Resistance |
| Check valve | Forward-only pressure-dependent flow | Disc position |
| Expansion vessel | Bounded inventory balance and spill | Inventory level |
| Relief valve | Automatic response to differential pressure | Stem opening |
| Transformer | Voltage transfer and loss-dependent temperature | Voltage |
| Alternator | Shaft-dependent normalized electrical output | Rotor speed |
| Teaching calorimeter | Heat balance, self-heating feedback and irreversible damage | Temperature bar |

Supporting infrastructure is wired through the same signal declarations as the original example. No renderer has physics. Missing SVG anatomy now fails explicitly instead of silently drawing a generic sensor. Existing 3D contract tests iterate **all** installed types, require multipart geometry and exercise disposal. The new models reuse the established metal/dark/teal palette; amber is material coloring, while red remains an abnormal-state indication.

This is **not a complete inventory, surveyed layout, or validated digital twin of a nuclear power station**. The added items are generic teaching equipment. The original historical-themed schematic is unchanged physically. In particular, no additional neutron kinetics, real control-rod dynamics, reactor operating limits, bypasses or accident reproduction procedures are implemented.

## Isolated recovery exercise

`plant/demo/training.ts` declares a separate fictional thermal lab on the same canvas. It has no signal paths to or from the historical reactor. The user changes bounded heat demand and cooling demand. Motor inertia, cooler lag, a calorimeter and a lagging temperature measurement make those commands take effect gradually.

The calorimeter uses an explicit stored-energy balance: generated heat minus removed heat changes stored energy, which determines temperature. Normalized positive feedback depends on its local temperature. Accumulated damage depends on sustained excess temperature and does not disappear after cooling. These equations contain no incident timestamp, scenario label, scheduled failure, or difficulty switch.

The control panel shows requested and actual values plus live observations for the corresponding system, and a **На схеме** button focuses its backplate. Parameters are fictional, not nuclear operating data. The scenario is intended to test SCADA commands, state persistence, alarms and visualization—not to teach operation of an actual reactor.

### Difficulty regression budget

`plant/tests/stability-trace.ts` executes the same declared project in Node and the browser. Tests require:

- Baseline and small command errors remain stable over eight simulated minutes.
- A short disturbance causes neither an immediate alarm nor irreversible damage.
- Sustained imbalance gives a visible warning before damage.
- A coordinated response after 20 or 30 simulated seconds from the warning recovers without damage, after an actuator/thermal delay.
- Changing only heat or only cooling is insufficient under the chosen exercise load.
- A later response can cool the apparatus but must retain accumulated damage; sufficiently late response fails.
- Results remain qualitatively stable at 50/100/200 ms timesteps and ±10% calorimeter heat capacity.
- Reordering devices and restoring checkpoints preserves the trajectory. Balance residuals remain bounded.

These are selected **exercise acceptance criteria**, not measured human difficulty or physical calibration. No claim is made that the chosen seconds or coefficients apply to a nuclear installation. Subjective difficulty still needs a user trial.

## Checking and running

```sh
npm ci
npm run plant:check
# Some Linux software-rendering setups require an X display even in headless Chrome.
xvfb-run -a npm run plant:test:browser
npm run check
```

Builds share the `dist/` directory: run these commands sequentially, not concurrently. The GitHub verification workflow remains manual and runs the browser suite under Xvfb.

Existing stored projects are not overwritten by a new app build. To inspect the updated example in an existing demo database, export a backup, import the supplied `scada-demo-project.json`, save a commit, then explicitly publish it. Browser draft/publish/rollback semantics are unchanged.
