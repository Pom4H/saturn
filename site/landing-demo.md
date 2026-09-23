# Focused landing demo

The public landing and local IDE examples use ordinary `@saturn/core` projects.
Physical topology is authored with `pipe(id, from, to)` and
`cable(id, from, to, { medium })`. Signal expressions are not physical wiring.

`site/project-source.ts` delegates compilation to `plant/compiler.ts`, rendering
to `sceneFor`, source ranges to `sourceObjects`, and local preview to `Kernel`.
It only patches explicit source spans or project membership. It does not define
another evaluator, rename `connect`, or serialize a second authored scene.
The `Scene` type is an internal disposable renderer projection, not the public DSL.

Moving equipment recomputes both pipe and cable routes from a temporary project
projection. Drop changes only literal `at.x/at.y` spans, as one undoable edit.
Invalid code or incompatible ports keep the last valid scene and show canonical
`SATURN_*` diagnostics. Aliased constructor imports retain their source ranges.
Catalogue insertion emits canonical simulation declarations; physical attachment
chooses pipe/cable from the actual typed terminals, then validates the result.

Only undo, reset, pause and fit are on the landing canvas. On a phone, source and
scene are tabs. Local example simulation is explicitly labelled and does not read
or command an industrial server. Workspace and layout storage are untouched.
“Open IDE” uses `?mode=ide#workspace`; saved projects are restored there. Old saved
source is not silently converted, discarded or sent to a fallback legacy compiler.

Server, standalone and PWA entry points keep the complete workspace. Server builds
mark their root as IDE; Pages changes only the HTML marker to demo, using the same
assets. Existing shared-source and workspace entry points stay full-featured.

`site:check` runs `scripts/canonical-source-check.mjs`. The existing release gate
runs `scripts/site-landing-check.mjs` and full-shell checks. The production bundler
rejects transitive imports of the retired scene DSL compiler/completion module.
No new recurring workflow is needed.
