# Standalone Saturn

Standalone is the Saturn application, not a compiled copy of one plant project.

## Build Saturn once

Bun is required on the build machine:

~~~sh
npm ci
npm run saturn -- pack --target windows-x64
~~~

The result is the application binary. No customer project is embedded into it.

## Project contract

A project is an ordinary directory:

~~~text
pump-station/
├── package.json
├── src/
│   └── plant.ts
├── tests/
├── targets/
└── assets/
~~~

`package.json` is project identity/dependency metadata and `src/plant.ts` is the conventional engineering entrypoint; Saturn does not require a separate project manifest.

Create or verify a project with:

~~~sh
saturn new pump-station
saturn check ./pump-station
saturn open ./pump-station
~~~

Source edits are ordinary file edits, so Git/VS Code/CLI tools see the same project Saturn sees.

## Workspace and runtime are separate

Engineering mode owns project files and build tooling. Runtime owns operational state.

~~~text
project files / Git
       │
       ▼
  saturn build
       │
       ▼
immutable BuildArtifact
       │
       ├── published
       ▼
     applied
       │
       ▼
runtime SQLite
telemetry · history · alarms · commands
~~~

Runtime-only/kiosk mode does not expose project source. Updating the Saturn binary does not rewrite project files or runtime history.

## Run as SCADA

~~~sh
saturn run ./pump-station
saturn run ./pump-station --kiosk
~~~

`run` hides engineering controls; `--kiosk` further constrains the UI for operator use.

## Deployment and Git

Git is source control for the engineering workspace. It is not the production runtime transport.

A CI/deployment system may watch a Git branch, run `saturn check/build`, and send the resulting BuildArtifact to a runtime. The runtime itself does not need to clone/fetch a project repository or resolve npm packages to execute an already-built artifact.

The four identities remain distinct:

~~~text
source SHA -> BuildArtifact -> published -> applied
~~~

A failed candidate leaves the last-good applied artifact running. Re-applying a retained artifact is an operational recovery action and does not fabricate a Git commit.

## Project-owned registry

The default way to extend a Saturn project is to copy typed source into it:

~~~sh
saturn registry list
saturn add pump --project ./pump-station
saturn add hourly-water-report --project ./pump-station
~~~

After copying, there is no hidden installation state. The files belong to the project and are reviewed/versioned like any other source.

Use a normal package dependency only when the code is intentionally external and shared. Native/server build hosts can resolve such dependencies; the offline PWA does not implement an npm client.

## Application data

Operational/application state is outside project source.

Windows:

~~~text
%LOCALAPPDATA%\Saturn\
  workspace.json
  projects\<project-key>\
    saturn.sqlite3
~~~

macOS uses `~/Library/Application Support/Saturn/`. Linux uses `$XDG_STATE_HOME/saturn/` or `~/.local/state/saturn/`.

`SATURN_DATA_DIR` can override the runtime state directory for deployments/tests.

## Live environments

An engineering Saturn can connect to an operator/runtime Saturn while keeping source local. Live telemetry/history/commands come from the selected Environment; source and build provenance remain visible independently.

A disconnected live Environment must not silently fall back to simulation data.

## Application self-update

Application updates are independent from project releases and runtime history:

~~~sh
saturn update --check
saturn update
saturn update --channel preview
~~~

Release artifacts are verified by signed metadata and content digest before replacement; failed health verification rolls the application binary back.

## Architecture

The normative project/build/runtime/registry boundaries are [ADR-0008](adr/0008-conventions-first-artifact-runtime.md). Signed application updates remain covered by [ADR-0003](adr/0003-signed-application-updates.md).
