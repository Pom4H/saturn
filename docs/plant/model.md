# Chernobyl-inspired coupled-process demonstration

## What this is — and is not

This is a **deterministic, normalized, phenomenological process model** for exercising SCADA composition, signal quality, persistence, alarms, reports and causal counterfactuals. It uses a Chernobyl Unit 4-inspired hierarchy and equipment vocabulary. It is **not a full emergent simulation of the historical Chernobyl accident**, a calibrated RBMK reactor model, a safety-analysis tool, or an operator-training simulator. That part of the original ambition is not completed by this workbench.

The source does not contain an accident timestamp, an `explode()` command, or a branch testing the scenario name. Equipment models receive only their state, parameters, input signals and time step. A fault propagates through those connections. Structural damage depends on calculated process state, not a cut-scene or timer.

The authoritative historical reference is [IAEA INSAG-7, The Chernobyl Accident: Updating of INSAG-1](https://www-pub.iaea.org/MTCD/publications/PDF/Pub913e_web.pdf), especially the discussion of reactor characteristics and reactivity effects. It is used to identify the gap between this engineering-software demo and an actual reconstruction. **Its quantitative reactor data have not been used to calibrate these coefficients.**

Missing physical mechanisms include spatial neutronics, delayed neutron groups, iodine/xenon evolution, actual control-rod geometry and displacement effects, pressure-dependent coolant properties, two-phase flow networks, channel-to-channel power distributions, radiological source terms and transport, graphite chemistry, and validated structural fracture. The current protection model inserts a monotonically suppressive input; it therefore does **not** reproduce the historically important positive insertion effect discussed in INSAG-7. Reducing an arbitrary simulated supply voltage is not presented as a reconstruction of the historical turbine rundown experiment.

## Actual decomposition

The original ten navigation systems contained 23 simulated components: one normalized feedback heat source, two banks of six lumped channels, two circulating pumps, two drum/separator aggregates, one turbine, one heat exchanger, one supply, one sensor, one protective actuator and one building aggregate. The grouping is site → unit → functional subsystems → repeated banks. The auxiliary extension adds three systems and six coupled instances, for 13 navigation systems and 29 components. Four operator controls act on that fictional auxiliary loop. See [operator controls](operator-controls.md). Only a teaching representation of the studied unit is present; the other historical reactors and complete site infrastructure are not modeled.

`core.ts`, `cooling.ts`, `steam.ts` and `safety.ts` export component lists and public signals. `plant.ts` composes them. `reports.ts` adds workflows. `bank()` and `aggregate()` demonstrate repeated-component decomposition without copy-pasted model code. No special equipment IDs occur inside the kernel, historian or report runner.

| Model | State and coupling | Scope limitation |
|---|---|---|
| supply | Declared normalized voltage | No electrical network solution |
| pump | Inertial speed, flow divided by resistance, cubic power indicator | No pump head curve, cavitation or hydraulic solver |
| feedback-source | Heat output reacts to void, temperature and absorber input | Not neutron kinetics; bounded normalized response |
| channel | Explicit energy balance, temperature, delayed void, accumulated damage, resistance | Lumped thermal model; no two-phase mass/momentum conservation |
| separator | Pressure-like storage from incoming heat and outgoing demand | Level is an algebraic indicator, not water inventory |
| turbine | Inertia, output and exhaust indicators | No thermodynamic expansion model |
| heat-exchanger | Stored temperature and rejected heat | No detailed condenser/vacuum model |
| sensor | Lag and bias | No instrument noise, calibration or hardware protocol |
| protection | Latched trip, lagged insertion signal | Deliberately monotonic response, not actual RBMK rods |
| structure | Pressure-like input accumulator and irreversible damage | No geometry, stress field or validated failure pressure |

Only the local channel energy residual is checked as a conservation diagnostic. It does not establish whole-installation mass/energy conservation. Normalized variables marked `отн.` cannot be relabeled MW, kelvin, bar or m³/h. RPM and percentage labels are illustrative output scales, not calibration evidence. Saturation guards bound the numerical demonstration and have no claim of physical validity outside the tested range.

## Causal experiment and results

The test starts from the identical initial project with a 100 ms model step. Four 300-second runs differ only in model parameter interventions:

| Variant | Peak normalized channel temperature | Final channel damage | Final structure damage |
|---|---:|---:|---:|
| Unperturbed baseline | 1.042616 | 0 | 0 |
| Degraded supply/cooling in the model | 8.565096 | 1 | 1 |
| Same disturbance, void feedback disabled | 1.529882 | 0 | 0 |
| Same disturbance, faster modeled protection | 1.915338 | 0 | 0 |

The tests verify that cooling disturbance alone does not select a scripted scenario branch, that removing the feedback path changes the outcome, and that changing protection response changes the outcome. Damage onset in the tested disturbed model is about 15.8 **model seconds**, not a prediction about a real reactor. Halving the numerical step preserves the outcome with a peak difference below 5% in the tested scenario. These checks are falsification attempts for the implementation, not validation of historical accuracy.

The browser and Node tests produced identical reported values for these four runs; their local energy residual was at most approximately `4.3e-14`. Equal implementations can share the same modeling error. The evidence establishes portability and causal wiring, not physical correctness.

## Reproduce without a server

Open `/plant/demo/`. The starting installation is stable. Select the electrical subsystem and its supply model. Changing its normalized voltage to `0.4` creates the tested cooling disturbance. The inspector explicitly labels these as model parameters, not real equipment controls. Watch circulation, channel temperature and void-related heat feedback; then inspect alarms, acknowledge an episode, and run the thermal report. Start a new run to compare another parameter intervention. The executable counterfactual test is the reproducible specification, with no dependency on mouse timing.

The UI draws **signal dependencies**, not physical pipes. Selecting a component reveals sources within the current view and names cross-subsystem inputs. Animations consume measured model outputs; they do not cause the process. Model errors or lost server transport render values unknown rather than substituting local synthetic values.

## What a credible historical reconstruction still needs

It requires separately validated installed physics modules and appropriate reference data, numerical convergence and conservation tests, calibration/held-out validation, explicit initial-condition uncertainty, and documented historical control actions as inputs rather than preset outcomes. Those modules should reuse the existing signal/runtime/report infrastructure. Their physics cannot be inferred merely from passing application or browser tests.
