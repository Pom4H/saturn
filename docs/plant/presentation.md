# Shared presentation DSL: web HMI, immutable reports, PLC LCD

`plant/presentation.ts` owns one bounded, serializable widget tree. A template
contains named value slots, not direct access to a database, DOM or runtime.
Each `view()` binds those slots to expressions. Project TS is still parsed by
the restricted project compiler; it is not evaluated as arbitrary JavaScript.

```ts
import { panel, label, readout, view, signal } from '@scada/plant';
export const panelBody = panel([
  label('Station overview'),
  readout('Temperature', 'temperature', 'C', 0),
]);
export const screen = view('overview', {
  title: 'Station overview', body: panelBody,
  bindings: { temperature: signal('TEMP.value') },
});
```

Add a view to `project.views` and select it in the **Интерфейсы** tab. Telemetry
updates values without replacing action buttons or stealing keyboard focus.
`commandButton()` declares an existing operator-control target and a value;
it goes through the same role, revision, range, interlock and audit checks as
the standard operator panel. It does not create a separate privileged command API.

A report may reference the same tree as `report(..., {view: screen, ...})`.
Report values come only from its declared signals in its pinned data capsule,
cut off at the run's `to` timestamp. Tables and charts use the SQL result rows.
Bad-quality observations are gaps/unknown, never substituted by a live value.
The shared HTML/SVG renderer escapes text. Report actions are disabled and
cannot dispatch commands. Existing table/chart reports also use this renderer.

A controller may use `hmi: {title, rows: [], view: localView}` with the same
`body`, while `localView.bindings` refers to controller-local `pin()` expressions.
`plant/presentation-hmi.ts` lays out group/text/integer readout nodes into the
existing 320x240 target screen records. Unsupported widgets and overflow are
compile errors, not silently omitted widgets. Tables, charts and action buttons
remain web/report capabilities; they are not pretended to work on this LCD.

`plant/demo/views.ts` declares a single `benchPanel` actually reused by the
web view, the `bench-state` report and the compiled Saturn program. A second
web panel adds audited operator buttons. All source remains editable through
the existing multi-file DSL editor and Git commit/publish lifecycle.

## Boundaries

128 nodes, 8 nesting levels, 64 bindings and 2,000 table rows are explicit limits.
No raw HTML, arbitrary code, external templates or shell commands are accepted.
This implements a flow layout, not a full desktop publishing/page-break editor.
It does not convert arbitrary 3D station geometry to a PLC display. 3D continues
to use the display commands produced by the same controller program.
