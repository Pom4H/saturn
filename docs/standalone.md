# Standalone packaging

Saturn can be packed as one executable with the Bun runtime, the web UI, the selected engineering project and the standalone adapters embedded in the file.

## Build

Bun 1.4.2 or newer is required only on the build machine.

```sh
npm ci
npm run saturn -- pack
```

The default target follows the build host. Explicit targets are available for Windows, Linux and macOS:

```sh
npm run saturn -- pack --target windows-x64
npm run saturn -- pack --target windows-x64-baseline
npm run saturn -- pack --target linux-x64
npm run saturn -- pack --target linux-arm64
npm run saturn -- pack --target darwin-arm64
```

A custom project directory must contain `scada.project.json` version 1 with `entry: "plant.ts"` and an explicit list of project files:

```sh
npm run saturn -- pack --project ./my-plant --target windows-x64 --outfile ./dist/my-plant.exe
```

The source files are embedded as the initial immutable seed. After first start, engineering changes are stored as local revisions in the installation database.

## Run

```sh
./saturn
```

Windows:

```powershell
.\saturn.exe
```

By default the executable listens on `127.0.0.1:4176`, serves the engineering UI at `/plant/app/`, creates a random initial engineer password and writes runtime data beside the executable:

```text
saturn.exe
saturn-data/
  saturn.sqlite3
  saturn.sqlite3-wal
  saturn.sqlite3-shm
```

The binary is replaceable. Runtime state is not stored inside it.

Environment variables:

| Variable | Purpose |
|---|---|
| `HOST`, `PORT` | HTTP bind address and port |
| `SATURN_DATA_DIR` | writable installation data directory |
| `SCADA_PUBLIC_URL` | public HTTPS origin when running behind a proxy |
| `SCADA_USER`, `SCADA_PASSWORD` | initial account credentials |
| `SCADA_PUSH_SUBJECT` | optional Web Push configuration |

## Standalone architecture

The regular Node installation keeps the native Git-backed project repository and `node:sqlite` adapter.

The packed executable uses:

- `bun:sqlite` for the durable installation database;
- Saturn's existing `LocalRepository` revision model stored in that database, so no system `git.exe` is required;
- the same compiler, process model, alarms, historian, reports, authentication, HTTP API and PWA UI;
- embedded web assets and the selected project source.

This separation keeps the domain/runtime code shared while moving operating-system dependencies to composition roots.

Standalone reports use the same bounded data capsule and SQL validator, but execute with the in-process Bun SQLite adapter. The Node deployment keeps process-isolated report workers. This is an explicit current difference.

## CI verification

`.github/workflows/standalone-windows.yml` runs on the self-hosted Windows runner. It:

1. installs the locked npm dependencies and Bun 1.4.2;
2. type-checks and builds the plant workbench;
3. packs `saturn.exe`;
4. starts the executable with an isolated data directory;
5. waits for `/plant/api/health` to return `status: ok`;
6. verifies that the SQLite database was created;
7. uploads the executable and logs as a workflow artifact.

This verifies that the artifact is runnable without Node, npm or Git being invoked by the target process.
