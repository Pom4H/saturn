# ADR-0001: Saturn system architecture

- **Status:** Superseded by [ADR-0008](0008-conventions-first-artifact-runtime.md)
- **Date:** 2026-09-20
- **Decision owners:** Saturn maintainers
- **Scope:** application, projects, Git/release flow, runtime authority, instance-to-instance communication, persistence, extensions and updates

## Supersession

ADR-0008 replaces the runtime-owned Git/release tracking and installed-extension assumptions below with a conventions-first project, immutable BuildArtifact deployment boundary, and project-owned registry. This document remains as negative knowledge: do not reintroduce these discarded ownership boundaries without new evidence.

## Context

Saturn started as a source-first SCADA editor and grew into an engineering IDE, runtime, historian, HMI, report engine and PLC toolchain. Treating those as separate products would duplicate project models, rendering, authentication and deployment logic. Treating every running Saturn as a peer that synchronizes files and state directly would create a distributed filesystem and make operational authority ambiguous.

The system needs to support all of these cases with one application:

- an engineer works on several projects;
- an operator runs one project continuously as SCADA/HMI;
- an engineer opens the same source project while observing the live installation;
- projects are versioned and reviewed in Git;
- a release is explicit and can lag behind engineering HEAD;
- runtime commands, alarms and history remain operational data rather than Git changes;
- a standalone application runs without Node/npm;
- a production server can use a normal Git remote and external deployment controls;
- application updates and extension updates do not rewrite projects or runtime history.

## Decision

Saturn is one application with multiple modes. Projects, application binaries, extensions and runtime data have independent lifecycles.

~~~text
                           Git remote
                      configuration authority
                             |
                source       |       release
                branch       |       branch
                             |
           +-----------------+-----------------+
           |                                   |
   Engineer Saturn                       Operator Saturn
   IDE / workspace                       runtime authority
           |                                   |
   local project source                       applied revision
   local drafts                               SQLite history
   Git client                                 alarms / commands
           |                                   |
           +---- Saturn live environment ------+
                    telemetry / history
                    commands / events
                              |
                       PLC / OPC / Modbus
~~~

### 1. One Saturn application

The distributable unit is Saturn itself, not a compiled plant project.

Primary modes:

~~~sh
saturn open ./project
saturn run ./project
saturn run ./project --kiosk
~~~

- **open**: engineering IDE. Source editing and project/revision tools are available.
- **run**: SCADA runtime. Engineering source controls are hidden; runtime remains active.
- **kiosk**: operator-oriented runtime/HMI mode.
- no project path: built-in demo/start context and recent-project information.

A project is chosen at runtime. Building Saturn never embeds a customer or plant project.

A single Saturn installation may open many project sessions. Project sessions are isolated; they do not share runtime state merely because the same application installation opened them. Multiple windows/processes are an implementation detail, not a different product.

### 2. Four independent state layers

~~~text
Application
  saturn.exe / saturn
  version + signed update

Workspace
  recent projects
  local UI preferences
  environment endpoints
  never committed by default

Project
  TypeScript source
  screens / reports / device declarations
  extension requirements
  Git history

Runtime
  applied revision
  observations
  commands
  alarms
  acknowledgements
  historian
  report artifacts
  checkpoints
~~~

Replacing or updating one layer must not silently mutate another.

### 3. Git is configuration authority

Git synchronizes authored project configuration. Saturn does not invent a second distributed source synchronization system.

A production project normally has at least two Git refs:

~~~text
main              engineering source
production        explicitly released source
~~~

Names are configurable.

The operator installation tracks both refs but only the release ref is eligible to become desired runtime configuration.

~~~text
HEAD / source  ------> published / desired ------> applied
       edit/review           release                  runtime
~~~

These three revisions are intentionally distinct:

- **head**: latest source revision visible to that project repository;
- **published**: revision selected for deployment;
- **applied**: revision currently driving the runtime.

An invalid published revision does not replace the last good applied revision.

Saturn must never interpret a new commit on main as a request to change the running plant.

### 4. Git synchronization is not peer-to-peer Saturn synchronization

Engineer and operator instances do not merge project files with each other.

Typical flow:

~~~text
Engineer
  edit
  save
  git commit
  git push main
       |
       +-- review / CI
       |
       +-- advance production
                    |
Operator Saturn     |
  git fetch <-------+
  validate production revision
  apply or retain last-good
~~~

The production Node composition supports read-only tracking of a configured remote source branch and release branch. Credentials are supplied by host Git/SSH configuration, not project files.

Standalone engineering workspaces keep files as ordinary files on disk. External Git checkout/pull changes are detected and hot-reloaded. Saturn source edits write the project files so ordinary Git clients can diff, commit and push them. The local SQLite revision journal is for CAS, undo/recovery and runtime provenance; it is not advertised as a replacement for Git history.

### 5. Operator Saturn is runtime authority

Exactly one runtime instance is authoritative for a particular running installation at a time.

The runtime authority owns:

- current observations and quality;
- current run ID and sequence;
- command acceptance;
- alarms and acknowledgements;
- historian data;
- report jobs and artifacts;
- checkpoints;
- the applied project revision.

A browser pause, engineering IDE disconnect or Git operation does not pause the operator runtime.

### 6. Operational actions are not source edits

These are runtime actions:

~~~text
start / stop
setpoint change
valve position
alarm acknowledge
mode change
maintenance command
~~~

They are recorded in the operational journal/historian and are never turned into Git commits.

Engineering changes are source changes:

~~~text
device declaration
signal mapping
HMI layout
alarm definition
report definition
extension requirement
~~~

They follow project revision and release rules.

If an operator is later allowed to perform engineering edits, those edits must create reviewable project changes. They must not silently mutate the production source branch.

### 7. Saturn live environment protocol

Git provides source/release synchronization. A Saturn-to-Saturn connection provides live runtime access.

The remote runtime exposes a stable installation identity:

~~~ts
{
  protocol: 1,
  instanceId,
  authority: "runtime",
  projectId,
  head,
  published,
  applied,
  runId,
  healthy
}
~~~

The engineering IDE may combine:

~~~text
local project source
        +
remote runtime frame
~~~

Only when the project IDs match.

The local source revision and remote applied revision may differ. Saturn displays that difference; it does not pretend they are synchronized.

Live protocol responsibilities:

- complete status snapshot;
- ordered live frames over SSE;
- history;
- events;
- alarms;
- reports;
- idempotent commands;
- runtime identity and revision information.

Project source transfer and Git merge are deliberately not responsibilities of this protocol.

### 8. Environment credentials stay out of projects

An engineer connects to a named environment such as Local, Simulator, Test bench, Plant-01 or Plant-02.

Environment URLs are workspace/deployment metadata. Credentials are not stored in project TypeScript, Git commits or share URLs.

For browser IDE use, the local Saturn backend is the environment broker:

~~~text
browser
  | same-origin session
  v
Engineer Saturn backend
  | short-lived bearer held in RAM
  v
Operator Saturn
~~~

The browser sends remote credentials only to its own Saturn backend. The backend exchanges them for a short-lived bearer session and keeps that bearer only in process memory.

Bearer login requires HTTPS outside loopback.

### 9. Command safety contract

Every command sent to a runtime is bound to:

- a unique command ID;
- the expected applied project revision;
- for run-scoped operations, the expected run ID;
- an authenticated actor.

Reusing a command ID with different payload is rejected. Commands for an old revision or old run are rejected.

A lost connection makes values unknown/offline. The engineering client must not replace a disconnected live environment with simulation data.

### 10. Runtime persistence

Operational state uses SQLite adapters behind one database contract.

The database contains runtime data such as checkpoints, measurements, events, command receipts, alarms, report jobs/artifacts and authentication state.

Project source remains a separate lifecycle.

For standalone projects, application data is stored under the platform application-data directory in a project-specific state directory derived from the project path. Updating the application binary therefore does not replace project source or runtime history.

### 11. Project identity and provenance

Every runtime frame and durable run is pinned to the exact applied revision.

A run keeps enough provenance to answer:

- which project revision produced it;
- which model/runtime versions were installed;
- which commands occurred;
- what observations were recorded.

A new source revision does not retroactively reinterpret old history.

### 12. Extensions

Saturn extensions are trusted installed code, separate from declarative project source.

Two scopes are expected:

- **installation/user scope** — available to the engineer or server;
- **project scope** — declared/pinned by the project.

A project may declare required extension names/versions, but installation credentials and package-registry credentials remain outside the project.

Extensions may contribute elements/renderers, protocols, data sources, equipment behavior, reports/workflows, IDE panels and commands.

The project compiler never executes arbitrary package code supplied by a browser upload. Installed extensions are loaded by the trusted application composition root.

### 13. Application updates

Application updates are a separate lifecycle from project releases.

Target model:

~~~text
download signed update
verify signature + digest
stage
restart
health check
commit update
or rollback binary
~~~

Projects, workspace metadata, extensions and runtime databases survive an application update.

Update channels may include stable, preview and nightly. Production/operator installations default to stable.

This ADR defines the boundary; the updater implementation may evolve independently.

### 14. Standalone and server compositions

Saturn keeps portable domain/runtime code behind adapters.

**Standalone**

- Bun compiled executable;
- embedded web assets;
- Bun SQLite;
- filesystem workspace projects;
- local revision journal;
- no Node/npm runtime dependency.

**Production Node/server**

- Node runtime;
- native SQLite;
- Git object/ref adapter;
- optional tracked Git remote branches;
- process-isolated report worker.

The same compiler, project model, runtime kernel, API semantics and UI are shared.

### 15. Security boundaries

- browser-authenticated application sessions use HttpOnly/SameSite cookies and CSRF;
- Saturn-to-Saturn sessions use short-lived bearer tokens;
- bearer credentials are memory-only in the environment broker;
- credentials never enter project files or share links;
- project DSL remains bounded and non-arbitrary;
- Git hooks and arbitrary project scripts are not executed by production project loading;
- live telemetry never edits source;
- a configuration revision is validated before application;
- last-good runtime remains active when a candidate release fails validation.

## Consequences

### Positive

- engineers use normal Git workflows instead of a proprietary project database;
- operator runtime authority is unambiguous;
- live debugging does not require copying project state from the plant;
- one Saturn executable covers IDE, SCADA server and HMI use;
- application updates can be independent of plant releases;
- source/runtime revision mismatches are visible rather than hidden;
- the architecture works both online and inside isolated industrial networks with an internal Git remote.

### Costs

- Git deployment and live runtime communication are two protocols by design;
- engineers must understand that local HEAD and remote applied revision can differ;
- simultaneous engineering edits are resolved by Git, not by the runtime protocol;
- production Git tracking needs an available Git implementation/transport on the server composition;
- standalone workspace revisions are recovery/provenance records and must not be confused with upstream Git commit IDs.

## Rejected alternatives

### Peer-to-peer project synchronization between Saturn instances

Rejected because it duplicates Git merge semantics, creates split-brain ownership and couples source synchronization to runtime availability.

### Automatically run the latest main branch

Rejected because source integration is not the same event as production release.

### Store live state in Git

Rejected because observations, acknowledgements, commands and historian samples are operational event/state data, not authored configuration.

### Compile every project into its own executable

Rejected as the default deployment model because it couples application updates to project releases and prevents one engineering installation from working with multiple projects. Project-specific appliance bundles may be added later as an optional distribution format.

### Let the browser connect directly to arbitrary plant endpoints

Rejected as the primary architecture because it complicates CORS, exposes remote bearer credentials to browser code and weakens the boundary between workspace and runtime connections.

## Implementation map

| Concern | Code |
|---|---|
| bounded project compiler | plant/compiler.ts |
| runtime kernel/service | plant/kernel.ts, plant/service.ts |
| source/release repository contract | plant/types.ts |
| Git refs and tracking | plant/adapters/git.ts |
| SQLite runtime state | plant/store.ts |
| HTTP/auth/live stream | plant/http-server.ts |
| instance environment bridge | plant/environment.ts |
| browser local/remote/linked clients | plant/web/client.ts |
| standalone project loading | standalone/project-loader.ts |
| standalone workspace source | standalone/workspace-repository.ts |
| recent-project workspace metadata | standalone/workspace.ts |
| standalone composition | standalone/entry.ts |
| packaging | scripts/standalone-pack.ts |

## Follow-up ADRs

Create separate ADRs when these decisions become concrete enough to deserve independent trade-off records:

1. extension package and trust model;
2. signed application update protocol;
3. historian retention/partitioning;
4. multi-user identity federation and authorization;
5. high-availability runtime authority/failover;
6. industrial protocol driver isolation;
7. distributed report/automation workers.
