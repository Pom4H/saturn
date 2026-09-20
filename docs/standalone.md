# Standalone Saturn

Standalone is the Saturn application, not a compiled copy of one plant project.

## Build Saturn once

Bun 1.4.2 or newer is required only on the build machine.

~~~sh
npm ci
npm run saturn -- pack --target windows-x64
~~~

Other targets include linux-x64, linux-arm64, darwin-x64 and darwin-arm64.

The result is the application:

~~~text
dist/standalone/saturn.exe
~~~

No customer/project source is embedded by the pack command. The built-in demonstration remains available as an application resource.

## Open projects at runtime

~~~sh
saturn open ./pump-station
saturn open ./boiler-house
~~~

A project directory contains ordinary source files and a bounded manifest:

~~~text
pump-station/
  scada.project.json
  plant.ts
  views/
  reports/
  ...
~~~

Saturn reads the project from disk. Source edits made in the IDE are written back to those ordinary files. A normal Git client can therefore diff, commit, branch, pull and push the same project.

External filesystem changes, including a Git checkout/pull, are detected by the workspace repository and hot-reloaded through the normal validation/release path.

The local SQLite revision journal provides CAS, recovery and provenance. Its workspace revision IDs are not Git commit IDs and must not be advertised as upstream history.

## Run as SCADA

~~~sh
saturn run ./pump-station
saturn run ./pump-station --kiosk
~~~

run hides engineering source controls. kiosk is the operator-oriented form of the same runtime.

The project is still source on disk; it is not recompiled into a new Saturn executable.

## Application data

By default Saturn keeps application/runtime state outside both the executable and project source.

Windows:

~~~text
%LOCALAPPDATA%\Saturn\
  workspace.json
  projects\<project-key>\
    saturn.sqlite3
~~~

macOS:

~~~text
~/Library/Application Support/Saturn/
~~~

Linux:

~~~text
$XDG_STATE_HOME/saturn/
# or ~/.local/state/saturn/
~~~

SATURN_DATA_DIR may override a project's state directory for deployments/tests.

Replacing saturn.exe does not replace project files or runtime history.

## Multiple projects

workspace.json records recent projects. One Saturn installation can open any number of independent project sessions. Each project gets its own runtime/database state.

Project sessions are intentionally isolated. Opening two projects in the same installation does not merge their source or operational state.

## Live environments

An engineering project may observe/control a different Saturn instance without copying project state peer-to-peer.

In the IDE choose **Подключить объект** and enter a named environment such as Plant-01.

The browser talks only to its local Saturn backend. That backend exchanges the remote credentials for a short-lived bearer session and keeps the bearer in RAM:

~~~text
Engineering browser
       |
Engineer Saturn
       | bearer (memory only)
       v
Operator Saturn
~~~

The local project remains the source shown by the editor. Live frames, history, events, reports and commands come from the operator runtime. Project IDs must match. Local HEAD and remote applied revision may differ and are displayed as different revisions.

Credentials are never written to project files, Git or share URLs.

## Production Git synchronization

For a production server, source/release synchronization remains Git.

A recommended remote has two branches:

~~~text
main          engineering source
production    explicitly released source
~~~

The operator Node composition can track them read-only:

~~~sh
SCADA_PROJECT_REPO=/srv/saturn/project.git \
SCADA_PROJECT_REMOTE=origin \
SCADA_PROJECT_BRANCH=main \
SCADA_PROJECT_RELEASE_BRANCH=production \
npm run plant
~~~

The bare repository must already have the configured remote and credentials through normal host Git/SSH configuration.

The runtime periodically fetches exact configured refs. main is source visibility only. production is the desired release. A candidate is validated before application and a failed candidate leaves the previous applied revision running.

This is intentionally separate from the live Saturn environment protocol.

## Revision model

Saturn exposes three different revisions:

~~~text
head -> published -> applied
~~~

- head: latest source known by the repository/workspace;
- published: requested release;
- applied: revision currently driving the runtime.

They may differ. The UI/protocol must not collapse them into one value.

## Windows CI

.github/workflows/standalone-windows.yml runs on the self-hosted Windows runner and verifies:

1. locked dependencies;
2. plant typecheck;
3. web build;
4. Bun standalone compilation;
5. actual saturn.exe process startup;
6. GET /plant/api/health;
7. SQLite creation;
8. artifact upload.

The target executable does not require Node or npm to run.

## Architecture

The normative boundaries for source, Git releases, runtime authority, instance communication, extensions, persistence and application updates are defined in [ADR-0001](adr/0001-saturn-system-architecture.md).
