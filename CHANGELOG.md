# Changelog

Saturn follows semantic versioning for public releases.

## 0.1.0 — 2026-09-21

First public release candidate of the unified Saturn engineering IDE and runtime.

### Engineering model

- typed `@saturn/core` TypeScript DSL as the authored project source;
- source-preserving visual editing with two-way source/canvas updates;
- project tree, equipment catalog, properties, signals and diagnostics;
- 2D and 3D engineering views over the same model;
- typed signals, units, ports, wiring, controls and controller targets.

### Runtime and operation

- Bun runtime with SQLite persistence;
- live telemetry, quality and stale/offline semantics;
- alarms, acknowledgements and fail-closed commands;
- historian, replay and report execution;
- content-addressed BuildArtifact deployment with distinct source, published and applied identities;
- viewer, operator and engineer roles;
- Saturn-to-Saturn live environment connection boundary.

### HMI and reports

- one canonical Presentation IR for web/operator views, reports and PLC-target projection;
- operator HMI runtime;
- Saturn PLC 320×240 presentation projection;
- tables, charts, KPI summaries and printable A4 reports;
- manual and scheduled report jobs.

### Application surfaces

- installable browser/PWA workspace with offline support;
- standalone Saturn for Windows x64, Linux x64/arm64 and macOS x64/arm64;
- operator/kiosk runtime mode;
- native VS Code host using normal TypeScript editor, SCM, Problems and Saturn views;
- project-owned copy-based registry for equipment, reports and templates;
- signed application-update protocol.

### Extensibility

- `saturn add` copies typed registry source into the project, where Git owns its history;
- normal package dependencies remain available for intentionally external shared libraries;
- runtime executes validated BuildArtifacts rather than installing project extension state.

PLC compile/deploy/flash remains behind a target-provider boundary so controller-specific toolchains do not fork the IDE.

### Distribution

GitHub release packaging builds portable binaries for the five primary desktop/server targets and emits SHA-256 checksums. GitHub Pages publishes the same Saturn landing/workspace used by the product build.

### Known follow-ups

- finish the physical Firmverse HMI interaction target: keys, navigation and animated 320×240 scenes;
- record the final two-way-binding demo from the released UI;
- package the VS Code host as a distributable VSIX;
- decide whether `@saturn/core` becomes a public npm package or remains source-distributed for the first release;
- add optional OS/container package channels without changing the Saturn project format.
