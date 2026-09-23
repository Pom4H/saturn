# Focused landing demo

The root landing mounts `mountLandingDemo`, not the full workspace controller.
It uses the production `compile`, `patchFields`, `SceneView`, equipment glyphs
and CodeMirror. There is no second scene format or screenshot imitation.

The initial experience is the pump example in 2D with TypeScript beside it.
Only undo, reset, pause and fit remain on the canvas. Small screens switch
between source and scene. Invalid code keeps the last valid scene and shows
an actionable diagnostic. Moving equipment previews connected pipe routes
and commits one undoable source change on drop.

The demo neither reads nor writes workspace/layout storage, mounts server
connections, nor registers workspace commands. Demo edits are disposable.
“Open IDE” navigates to `?mode=ide#workspace`; the full IDE restores its own
saved project. Existing `#workspace`, `#studio`, `#code=…`, `?project=…` and
standalone-PWA entry points continue to mount the complete workspace. Server
and standalone bundles call `buildSite(outdir, 'ide')`; their HTML explicitly
marks the host as an IDE, so authenticated operator/viewer roots are unchanged.
Pages packaging reuses these assets and changes only the root HTML mode to demo.
An explicit `?mode=demo` also opens the disposable view in a server build; the
release gate uses it to exercise both surfaces without a second bundle.

Regression coverage lives in `scripts/site-landing-check.mjs` and runs inside
the existing `node scripts/site-release-check.mjs` CI gate. Full-workspace
browser tests explicitly use `?mode=ide`. Published-root verification expects
the focused 2D demo rather than a WebGL canvas.

Local checks: `npm run site:check` and `node scripts/site-build.mjs`.
