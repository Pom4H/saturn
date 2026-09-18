# Contributing to Saturn

Saturn is MIT-licensed and accepts focused engineering contributions. Use Node.js 24 LTS (see `.nvmrc`) and `npm ci`. Run `npm run check` and the Chromium/WebKit Playwright suite before sending a PR. The README and docs/getting-started.md document the MVP, local runtime and browser demo.

Changes to visual interactions need tests proving that the TypeScript source changes correctly, survives export/import and undo/redo, and produces the expected browser frame. Include a screenshot from the actual render for geometry or design changes. Do not use generated illustrations as evidence that the renderer works.

Keep authored project persistence source-only; server-run observations and checkpoints belong in the separate run store. AST edits must preserve unrelated source and must refuse to overwrite computed expressions. Never introduce arbitrary user-code execution into the document origin. Add range/quality handling and port geometry alongside new visual elements.

Report unsupported simulation topologies instead of guessing physics. Saturn is not a certified safety system. Unsupported physics or topology must fail explicitly rather than being guessed.

Equipment extensions must register metadata, installed behavior, 2D/3D representation and tests through the public hooks described in docs/architecture.md. New types must not add special cases to the compiler or central renderer. Runtime frames must never dispatch editor transactions. Run npm run test:runtime:e2e for end-to-end stream/replay/failure checks.

Use `scope: "layout"` for purely visual fields. Add typed SDK consumer and metadata completion tests for extensions. Project updates must validate immutable Git objects before activation, preserve drafts and run revisions, and never execute source or hooks. `npm run check` includes the review regression suite and external consumer.


For the isomorphic workbench also run `npm run plant:check` and `npm run plant:test:browser`. Keep Node/DOM/OPFS imports in the respective adapters, not the shared kernel. Store only authored files in revisions; runtime observations are not source edits. Reports execute in disposable data capsules, never the operational database. PWA caches must exclude authenticated resources. Increment installed model versions when state semantics change. Do not label normalized causal tests as historical or nuclear-safety validation. See `docs/plant/`.
