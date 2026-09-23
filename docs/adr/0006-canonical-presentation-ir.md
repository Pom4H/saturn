# ADR-0006: Presentation is the canonical HMI IR

- **Status:** Accepted
- **Date:** 2026-09-21
- **Depends on:** ADR-0001, ADR-0004, ADR-0005

## Context

Saturn needs operator HMI on web/PWA and on constrained physical displays such as the Saturn PLC 320×240 panel. Reports reuse many of the same semantic widgets.

A tempting implementation is to create a second HMI language for React or for the controller display. That would split one engineering project into parallel signal namespaces, navigation models, actions and validation rules. It would also make coding agents and visual editors choose which representation is authoritative.

Saturn already has a serializable `Presentation` tree in the project DSL and already compiles a controller presentation into the Saturn/Firmverse screen path. The missing piece is to make this boundary explicit.

## Decision

`Presentation` is the only authored HMI/report UI model.

```text
@saturn/core project
        |
        v
canonical Presentation IR
        |
        +----------------------+-----------------------+
        |                      |                       |
        v                      v                       v
Web / React projection     Saturn PLC 320x240     Reports / export
operator HMI              Firmverse target        HTML / PDF / Excel
```

Targets are projections. They may choose different layouts and visual fidelity, but they do not own another project model.

### Authoring boundary

The canonical IR owns semantic intent:

- grouping and hierarchy;
- labels and readouts;
- signal bindings;
- operator actions;
- tables and charts where applicable;
- stable presentation identity.

Target-specific pixels, draw commands, React callbacks, browser state and firmware structs are not project source.

### Physical HMI

The physical target path is:

```text
Presentation
    |
    v
saturn-plc-320 target adapter
    |
    v
HmiScreenModel (target schema)
    |
    v
Firmverse / Saturn compiler
    |
    v
.fbdbin
    |
    v
Firmverse runtime / physical controller
```

`HmiScreenModel` is therefore a target artifact, not a second authoring IR.

Unsupported semantics fail explicitly. For example, a table or chart may be valid for web/report and rejected for the 320×240 target. The target must not silently drop nodes.

### Web / React

Web renderers receive the same `Presentation` and runtime observations. React may be used as a renderer, but React component callbacks are never serialized into the project.

### Layout differences are allowed

Targets do not have to look identical. A pump detail may be a large animated composition with history on the web and a compact glyph plus RPM/flow on the physical panel. Both remain projections of the same equipment IDs, signals and actions.

## Architecture invariant

Core source may not introduce parallel authoring types named `HmiApplication`, `HmiScreen`, `HmiDialog`, `HmiNode` or `HmiAction`.

Vendor/target schemas remain allowed under `plant/vendor/**` because they are compilation artifacts, not authored project APIs.

## Consequences

- one project model and one signal namespace;
- Web, VS Code, reports and physical HMI can share semantic validation;
- Firmverse remains a target/runtime implementation detail;
- coding agents edit the same TypeScript artifact humans edit;
- adding a new HMI target means implementing a projection, not inventing another DSL.
