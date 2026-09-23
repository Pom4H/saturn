# Original SVG and DSL hover restoration

The visual reference is the original Saturn pump and reservoir, still implemented
in `src/view.ts` at `e97d1d966e5f9fde488920d45a2d8b98d092ccf1`. Replacing it with the
small second drawings in `plant/equipment.ts` lost the equipment detail. The first
local repair was also rejected: fitting the originals into 150×118 boxes made them
miniatures and required decorative connector elbows around the actual nozzles.

## Representation

`src/equipment-svg.ts` contains the original tank, pump and valve builders extracted
from that renderer. Both scene and canonical project renderers use them, with no
per-symbol scaling, mirroring, newly drawn body or connector adapter. Native frames
are 170×230, 220×170 and 160×164. `src/equipment-geometry.ts` owns these coordinates;
legacy metadata and canonical terminals use the same geometry. The pump outlet is
at the top of its casing. Pipes join the actual flanges. Existing TypeScript signal
IDs and named port references are preserved; explicit route waypoints on existing
projects may need review because the schematic footprints have intentionally changed.

The existing rounded multilayer process pipe renderer is shared by both paths.
Flow marks consume the observed source terminal's flow and quality, not arbitrary
animation values or a geometry-derived solver. Unknown/stale flow does not animate;
measured zero is retained. Routes also leave room for labels. The landing uses a
small two-device pump loop so the original equipment stays readable. The normal
IDE retains cables, other devices and projects. This is an illustrative local Kernel,
not a validated hydraulic calculation or a physical installation.

## Hover

`src/editor-hover.ts` is shared by the landing, full IDE and workbench.
`scripts/dsl-library.mjs` emits declarations from the actual SDK. The lazy TypeScript
language service resolves functions, aliases, signal/port types and cross-file
user JSDoc. Localized descriptions come from the existing DSL documentation after
symbol resolution. Comments, string contents and shadowing do not borrow unrelated
documentation. Rendering uses textContent; signatures are bounded and scrollable.
Generated SDK assets participate in the existing offline cache. No dependency added.

## Regression checks

`tests/fixtures/process-svg-original.json` was captured from the original renderer
at the revision above, using a real Chromium DOM. It is not a newly designed symbol.
The browser gate compares all original vector/material attributes of pump and tank,
normalizing only generated IDs, diagnostic attributes and live rotor angle. It also
checks anatomy without miniature adapters, real model pause, pipe movement during
drag, undo, native JSDoc hover, and light/dark/mobile layouts. Node tests cover native
terminal geometry and good/zero/stale/missing observations. Existing authenticated
publication, role and operator screenshot checks remain enabled.

The required usegit context command returned `Unknown command: context` on GitHub;
no lease or work queue was changed. Local source/type/architecture and offline-browser
checks passed. Normal local browser navigation is blocked by the execution environment
(ERR_BLOCKED_BY_ADMINISTRATOR); the unmodified release browser gate must pass on CI.
See the PR for exact commit, CI result and generated full-page/product screenshots.
