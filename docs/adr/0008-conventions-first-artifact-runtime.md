# ADR-0008: Conventions-first projects and artifact runtime

- **Status:** Accepted
- **Date:** 2026-09-22
- **Supersedes:** ADR-0001 runtime Git/release ownership; ADR-0002 installed extension lifecycle
- **Experiment:** EXP-0001 / UG-0001

## Context

Saturn had converged on one typed engineering model, but repository history still described two competing ownership models:

1. production runtime tracked Git refs and compiled/validated source itself;
2. standalone Saturn installed executable extension packages into hidden application state.

The current implementation has simpler boundaries. Keeping the old descriptions active makes agents reconstruct the wrong architecture and encourages compatibility adapters that the product no longer needs.

## Decision

### Project contract

A Saturn project is an ordinary directory:

~~~text
project/
├── package.json
├── src/
│   └── plant.ts
├── tests/
├── targets/
└── assets/
~~~

`package.json` supplies identity and ordinary dependencies. `src/plant.ts` is the conventional engineering entrypoint. There is no Saturn-specific project database or `scada.project.json`.

The TypeScript project is authored source. At a trusted engineering/build boundary Saturn executes project TypeScript to construct and validate the canonical serializable engineering IR.

### One deployment unit

Runtime consumes an immutable content-addressed `saturn.build@1` BuildArtifact.

~~~text
working tree
    │
    ├── Git SHA (when available)
    ▼
saturn build
    ▼
BuildArtifact sha256:...
    │
    ├── published
    ▼
  applied
    ▼
 runtime authority
~~~

Source SHA, BuildArtifact hash, published artifact and applied artifact are distinct identities.

Git belongs to the engineering workspace and CI/deployment tooling. Production runtime does not need a Git checkout, TypeScript compiler or package manager to execute an already-built installation.

A GitOps system may watch source externally, build an artifact, validate it and deploy it. That does not make Git transport part of the runtime API.

### Runtime authority

One runtime authority owns live observations, quality, commands, alarms, acknowledgements, historian data, report jobs, checkpoints, run identity and the applied artifact.

Operational state is stored separately from project source. Browser project source uses ProjectFs/OPFS; runtime persistence uses SQLite. A runtime-only/kiosk host does not expose source files.

A candidate artifact is validated before application. Publishing/applying uses compare-and-swap semantics, and failure preserves the last-good applied artifact.

### Extension model

The default extension mechanism is project-owned source, analogous to shadcn:

~~~sh
saturn registry list
saturn add pump --project ./pump-station
saturn add hourly-water-report --project ./pump-station
~~~

Registry items copy ordinary TypeScript/assets/tests into the project. After copying there is no activation lifecycle, hidden extension store or uninstall database; the project owns the files and Git owns their history.

Use a normal npm/Bun dependency only when the project intentionally wants an external shared library. Native/server build hosts may resolve such packages. Offline PWA builds are limited to self-contained projects and copied registry items.

Application-level capabilities that truly require trusted host code may be introduced later, but they must not recreate a second project model or implicit installation state.

### One model, many projections

Diagram, HMI, reports, historian bindings, PLC targets and deployment are projections/consumers of the same canonical project model and Presentation IR. A surface must not invent a second equipment, signal, topology or HMI authoring model.

## Invariants

Current architecture must satisfy all of these:

1. one project contract: `package.json` + `src/plant.ts`;
2. one canonical typed engineering model and Presentation IR;
3. one deployment unit: immutable BuildArtifact;
4. one runtime authority for operational state;
5. source/Git state is separate from runtime SQLite state;
6. runtime does not fetch Git refs as its deployment mechanism;
7. default extensibility is project-owned registry source, not an installed extension database;
8. source, build, published and applied identities remain visible and distinct.

`npm run architecture:check` guards these invariants where they can be checked statically.

## Rejected / superseded alternatives

### Runtime-owned Git tracking

Rejected because it couples source transport to runtime availability, requires Git/package/build tooling in production, and obscures the BuildArtifact deployment boundary.

### Proprietary project manifest/database

Rejected because the directory, `package.json` and conventional TypeScript entrypoint are sufficient. A second project format creates synchronization work without adding domain meaning.

### Hidden installed extension lifecycle

Rejected as the default because source-owned registry items are inspectable, editable, typed and naturally versioned with the project. External packages remain available when independent distribution is actually required.

### Parallel projection-specific models

Rejected because they break source-preserving editing, type inference, agent comprehension and provenance.

## Consequences

- engineering hosts remain rich; runtime hosts become smaller;
- deployment provenance is exact and content-addressed;
- rollback can re-apply a retained artifact without fabricating Git history;
- PWA/native/VS Code surfaces share the same project contract;
- extension changes appear as normal source diffs;
- old ADR-0001 and ADR-0002 remain in history as negative knowledge rather than silently disappearing.
