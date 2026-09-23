# Landing evidence

The landing sells a workflow: engineer a project, publish a checked build, then operate the same installation in a separate authenticated role. The first interaction remains the focused real code/diagram editor. There is no marketing renderer, invented telemetry or cloned operator interface.

## Screenshots are generated evidence

`npm run site:test:release` reuses the existing release browser. `scripts/landing-proof.mjs` starts the real Saturn server in a disposable directory with random credentials, publishes an engineering change, closes the engineering context and opens a separate operator context. It checks the applied revision and role boundaries, then sends a real operator speed command to the small `examples/operator-pump` project. It observes the resulting model flow, waits for the declared low-flow warning, acknowledges it while the condition remains active, and restores the setpoint until the warning clears. Commands must not change the applied project revision. Both roles are then captured in both system themes.

The browser server runs this ordinary project source; there is no dependency on the old `plant/demo` source directory or the large training installation. The same source is packaged as downloadable `operator-pump.json` for the IDE import command, and the gate checks byte-for-byte source equality. This accommodates the examples migration in PR #73 without reinstating legacy paths. The model is explicitly illustrative, not a physical hydraulic solver.

The four PNGs and `landing-proof.json` are written into the built site and `test-results/release-shell/product`. The offline cache is recalculated after evidence is added. The existing Pages job copies these same tested assets; there is no new workflow or external screenshot service.

The browser loads images only when the manifest is available and its revision matches the page. Normal local builds provide a textual explanation and server instructions, without broken images or stock substitutes. A screenshot is explicitly identified as a server simulation, not a real hardware deployment. Images open at full size and the role switch uses native keyboard-accessible radio inputs.

## Authoring document boundary

The authenticated capture exposed a pre-existing mismatch: the current compiler executes trusted TypeScript at build time, but the server supplied the runtime's no-JavaScript-evaluation CSP to the engineer as well. The workspace therefore could not open.

The HTTP workspace host now serves `/plant/ide/` only to authenticated engineers and only when a workspace exists and the host is in IDE mode. This no-store document permits JavaScript evaluation for the existing trusted-project builder. Root/operator documents, APIs, reports and static assets keep their existing strict policies. The root shell checks its authenticated role before moving an engineer to that entry; operators are refused by the server, not merely by a hidden button. Cookie scope is unchanged. The public service worker does not cache this authenticated route.

This is a permission boundary, **not a sandbox for hostile source code**. Authored TypeScript must be trusted before building it. A separate engineering host/origin is appropriate when untrusted projects or stronger operational isolation are required. The native runtime consumes checked artifacts and does not evaluate authored TypeScript. The landing must not describe these boundaries as industrial certification or proof of system-wide security.

The browser gate checks anonymous rejection, operator rejection, no-store authoring responses, preserved strict runtime CSP and a real engineer save/deploy through the authorized document. It does not bypass CSP, use a browser flag, remove a response header or inject an authentication shortcut to obtain screenshots.

## Acceptance

Keep the existing two-way editing, pipe preview, undo/reset, invalid-source, storage isolation and full-IDE checks. New checks cover real authenticated publication and operation, current-build image provenance, light/dark images, keyboard switching, mobile overflow and working internal links. Inspect `landing-light.png`, `landing-dark.png`, `landing-mobile.png` and the individual product captures from `shell-evidence` before accepting the experiment.

These checks establish reproducible behavior of the demonstrated software. They do not establish physical equipment compatibility, industrial certification, uptime, conversion uplift or customer adoption.
