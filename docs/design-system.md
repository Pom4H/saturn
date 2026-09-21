# Saturn product and interface system

Saturn is a source-first engineering environment. The interface must make the product model visible instead of hiding it behind generic IDE chrome.

## Product invariant

One typed project is the authored source of truth.

```text
TypeScript project
      |
      +--> engineering diagram / source
      +--> runtime / telemetry / alarms / history
      +--> operator HMI
      +--> reports
      +--> PLC / target providers
      +--> release / deployment
```

A new UI surface should project this model. It must not create a parallel tag namespace, document format or hidden project model.

## Persistent contexts

Every Saturn application surface answers three questions without opening a dialog.

### Project

What installation or project am I looking at?

Project identity is persistent application chrome. File navigation, source, diagrams and reports are views inside that project.

### Surface

What kind of work am I doing?

Primary engineering surfaces are stable navigation, not unrelated toolbar icons. Contextual tools stay inside the surface they affect.

Examples:

- Diagram owns Add, Connect, 2D/3D, Fit and selection tools.
- Source owns editor/file tools.
- Signals owns signal inspection.
- Runtime owns controls and alarms.

### Environment

What runtime authority am I observing or controlling?

Local/demo/server/runtime state must be visible before an engineer can mistake simulated data for plant data. Connection quality changes the environment indicator; stale data stays visibly stale and commands remain fail-closed.

## Revision UX

Saturn does not collapse configuration and operational state into one "current version".

```text
source -> published -> applied
```

The shell shows all three when a server environment exists. Drift is a first-class state. Publishing is a named, deliberate action, not an unlabeled icon.

## Visual language

The marketing page, engineering shell, reports and tooling share semantic tokens.

Core surfaces:

- `--bg`
- `--panel`
- `--shell-raised`
- `--line`
- `--text`
- `--muted`
- `--accent`

Operational semantics:

- `--status-live`
- `--status-warning`
- `--status-danger`

Canvas overlays use named canvas/overlay tokens rather than local hex values.

New components should consume semantic tokens. A new isolated palette requires an explicit reason.

## Hierarchy

Persistent chrome is quiet. Operational state has more importance than application decoration.

Priority:

1. safety/runtime state and environment;
2. current project and revision state;
3. current work surface;
4. surface tools;
5. application preferences.

Fullscreen, notifications and preferences must not visually compete with environment or release state.

## Landing

The landing is a runnable Saturn surface, not a separate marketing design system.

The first product demonstration should expose source and diagram together on desktop because source-preserving visual editing is a defining interaction.

The narrative order is:

1. one authored project;
2. multiple projections from that project;
3. source -> published -> applied;
4. extension and target-provider boundaries;
5. distribution forms.

Deployment formats are consequences of the architecture, not the product thesis.

## Extension UX

Extensions extend domain knowledge rather than fork the IDE.

Current capability vocabulary stays literal across documentation and UI:

- `elements`
- `protocol`
- `datasource`
- `panel`
- `report`
- `command`

PLC compile/deploy/flash stays behind the target-provider boundary.

## Review checklist

For each new feature ask:

1. Where does it live in the typed project or runtime model?
2. Which surface edits or observes it?
3. How does an operator see it?
4. How is it versioned or persisted?
5. How does an agent discover and edit it?
6. Does its UI reuse Saturn tokens, hierarchy and interaction patterns?

If those answers require another hidden model, another visual language or another source of truth, the feature is not integrated yet.
