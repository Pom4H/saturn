# Saturn roadmap

This roadmap describes product maturity, not a promise of release dates.

## MVP — 0.1

The MVP is complete enough when an engineer can:

1. clone Saturn and start a local installation with one command;
2. author a multi-file project in the bounded TypeScript DSL;
3. define systems, equipment, signals, controls, alarms and reports;
4. inspect the same equipment in 2D and 3D;
5. get a useful HMI automatically from topology without duplicating screens;
6. override HMI with explicit screens/navigation/widgets when needed;
7. edit HMI/report source and visual projection side by side;
8. run a deterministic local model and inspect history/replay;
9. execute manual and scheduled reports;
10. commit, publish and rollback project revisions;
11. run the browser-only PWA demo without a server;
12. run the authenticated Node runtime with durable SQLite/Git storage.

The current codebase implements all of these paths, but the release still needs packaging, documentation cleanup and public usability testing before tagging 0.1.

## Before 0.1 tag

- remove remaining prototype/legacy terminology from primary UI and docs;
- make the example project industrially neutral and small enough to understand quickly;
- publish screenshots of the real report/HMI visual studio;
- document the model/equipment extension API;
- document backup/restore and upgrade procedure;
- define a stable public project schema compatibility policy;
- add a clean install test from an empty checkout;
- audit third-party licenses in distributed PWA/server artifacts;
- measure a representative large project: compile, HMI derive, frame update, route layout and historian write rates.

## 0.2 — real data adapters

The runtime should gain an explicit adapter contract for real telemetry/control without making vendor protocols part of the kernel.

Candidates:

- OPC UA;
- Modbus TCP;
- MQTT;
- HTTP/SSE adapters;
- vendor-specific PLC bridges as installed packages.

A real adapter must carry timestamp, quality and source identity. Loss of communication must become bad/stale quality, never a fabricated zero.

## 0.3 — engineering workflow

- reusable equipment/model packages;
- project templates;
- visual connection editing for larger installations;
- HMI layout hints and responsive target profiles;
- report template library;
- import/export tooling for common tag lists;
- project diff focused on engineering semantics.

## Later

- high-availability runtime design;
- external identity providers and site/user administration;
- larger historian/storage backends;
- distributed report workers;
- more PLC targets;
- richer CAD/P&ID interoperability.

These items must not weaken the source-first rule or turn runtime telemetry into authored project state.
