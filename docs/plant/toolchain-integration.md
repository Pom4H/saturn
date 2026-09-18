# Firmverse compiler and deterministic controller state

The binary serializer and execution host are no longer independent SCADA
implementations. `plant/vendor/firmverse` is a pinned, licensed snapshot of
Firmverse's `packages/saturn` portable package. `builder.ts` is a thin adapter
from the existing HMI/program model to `firmverse/saturn-control-ir@1`; the
shared Rust compiler (WASM) owns `.fbdbin`. Original Saturn SVG geometry and
target HMI screen encoding remain in the view/profile layer.

Each PLC has an isolated WASM instance. A scan captures the input image,
executes exactly once, then caches outputs, screen commands and state. Reading
`Kernel.frame()` is pure: no scan, timer advancement or runtime mutation.
Snapshot/restore pins the runtime ABI and exact program. Native C and portable
WASM expose the same explicit state format; raw native pointers are never copied.
A changed runtime/program rejects an old snapshot instead of pretending replay
is compatible. Power loss resets this educational target cold; no hardware
RETAIN behavior is invented. Rejected snapshots do not mutate the live instance.

The DSL now supports shared named block instances:

```ts
blocks: {
  delay: functionBlock('TON', [pin('DI1'), 500]),
},
outputs: { DO1: block('delay') }
```

A block referenced by several outputs is compiled once. Named combinational
cycles, wrong arities, invalid constants and missing inputs are rejected.
TON, TP, RSTRG, DTRG, COUNTER, PID, SUM/SUMM, LIM, EQ, OR and XOR are available
through this target binding. This is not a claim that every PLC language,
peripheral or uploaded binary is supported. Communication, RTC/random/event
blocks require explicit reproducible environment adapters and remain rejected
by the portable executable subset. Upstream block semantics are preserved,
including TON's required low-input initialization sequence.

## Existing browser projects

The new state ABI intentionally does not accept old combinational-runtime
checkpoints. Export important source/history before upgrading an existing
demo installation; start a new run with the updated project. No automatic
opaque-state migration or silent history deletion is implemented. Keep old
runtime/revision artifacts when replaying old runs.

## Verification

Run sequentially (build directories are shared):

```sh
npm ci
npm run plant:check
npm run check
xvfb-run -a npm run plant:test:browser
```

Tests cover pure frame reads, shared blocks, timer continuation through restore,
wrong-program rejection, shared panel compilation/rendering, report cutoff and
bad quality, action validation, unsupported LCD nodes, and browser/offline HMI.
No physical PLC, bootloader/HAL image or controller deployment was exercised.
The anonymous example is still an uncalibrated teaching station, not a validated
nuclear plant twin. This change does not add a reactor operating procedure.
