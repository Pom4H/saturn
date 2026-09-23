# Landing evidence

The landing sells a workflow: engineer a project, publish a checked build, then operate the same installation in a separate authenticated role. The first interaction remains the focused real code/diagram editor. There is no marketing renderer, invented telemetry or cloned operator interface.

## Screenshots are generated evidence

`npm run site:test:release` reuses the existing release browser. `scripts/landing-proof.mjs` starts the real Saturn server in a disposable directory with random credentials, publishes an engineering change, closes the engineering context and opens a separate operator context. It checks the applied revision, role boundaries, runtime pause/resume and access to alarms before capturing both roles in both system themes.

The four PNGs and `landing-proof.json` are written into the built site and `test-results/release-shell/product`. The offline cache is recalculated after evidence is added. The existing Pages job copies these same tested assets; there is no new workflow or external screenshot service.

The browser loads images only when the manifest is available and its revision matches the page. Normal local builds provide a textual explanation and server instructions, without broken images or stock substitutes. A screenshot is explicitly identified as a server simulation, not a real hardware deployment. Images open at full size and the role switch uses native keyboard-accessible radio inputs.

## Acceptance

Keep the existing two-way editing, pipe preview, undo/reset, invalid-source, storage isolation and full-IDE checks. New checks cover real authenticated publication and operation, current-build image provenance, light/dark images, keyboard switching, mobile overflow and working internal links. Inspect `landing-light.png`, `landing-dark.png`, `landing-mobile.png` and the individual product captures from `shell-evidence` before accepting the experiment.

These checks establish reproducible behavior of the demonstrated software. They do not establish physical equipment compatibility, industrial certification, uptime, conversion uplift or customer adoption.
