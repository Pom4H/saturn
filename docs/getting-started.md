# Getting started with Saturn

Saturn has two execution modes built from the same project model:

1. **Node runtime** — authenticated server, durable SQLite history, native Git releases, persistent report jobs and Web Push.
2. **PWA demo** — browser Worker, SQLite WASM/OPFS and local revision history. It is useful for evaluation and demos, but it does not keep running after the browser is suspended.

## Install

```sh
git clone https://github.com/Pom4H/scada.git
cd scada
npm ci
npm run plant
```

The server listens on loopback by default. Open:

```text
http://127.0.0.1:4176/plant/app/
```

The first start creates an engineer account and prints its generated password once.

The browser-only demo is:

```text
http://127.0.0.1:4176/plant/demo/
```

## Project files

The entry file is `plant.ts`. A project can import other local `.ts` modules. The compiler accepts only the declarative Saturn DSL subset.

A typical project is decomposed by engineering responsibility:

```text
plant.ts
systems.ts
process/
  cooling.ts
  power.ts
signals.ts
controls.ts
alarms.ts
reports.ts
views.ts          # optional overrides; Auto HMI does not require this
```

Keep measurements and runtime events out of these files. Source describes the desired installation and behavior; observations belong to the historian.

## Authoring lifecycle

Saturn deliberately separates four states:

```text
draft -> commit -> publish -> runtime
```

- **Draft** is the engineer's working file map.
- **Commit** creates an immutable project revision.
- **Publish** moves the desired runtime revision using compare-and-swap.
- **Rollback** publishes a new revision pointing back to known source. Operational history is never deleted by rollback.

In the PWA the same lifecycle is emulated locally. On the Node server it uses a dedicated Git repository.

## HMI

Open **HMI** in the shell. The default entry is **Auto**.

Auto HMI is calculated from the project hierarchy:

- each system becomes a screen;
- parent/child systems become navigation;
- installed devices become equipment groups;
- published signals become readouts;
- controls become audited actions.

A specialized screen can be authored with the same DSL:

```ts
const main = screen('main', 'Main', panel([
  readout('Flow', 'flow', 'm3/h', 1),
  commandButton('Start', 'PUMP-A', 1),
  navigate('Diagnostics', 'diag'),
]));

const diag = screen('diag', 'Diagnostics', panel([
  animate(readout('RPM', 'rpm', 'rpm', 0), 'rpm', 'rotate', {
    min: 0, max: 3000, from: 0, to: 180,
  }),
  navigate('Back', 'main'),
]));
```

The visual editor and code editor edit one project. A generated widget carries provenance back to the topology declaration it came from.

## Reports

Reports combine:

- declared signal inputs;
- a bounded SQL query over an isolated `samples`/`segments` capsule;
- optional presentation widgets;
- manual and/or UTC cron triggers.

They do not execute arbitrary JavaScript or shell commands.

Run a report manually from **Reports**. Production scheduling belongs to the Node runtime; the PWA schedules only while it is executing.

## Verification

Before opening a pull request:

```sh
npm run plant:check
npm run check
```

For browser/PWA changes:

```sh
npx playwright install --with-deps chromium-headless-shell
xvfb-run -a npm run plant:test:browser
```

Visual changes should include screenshots captured from the actual application, not design mockups.

## Deployment

Saturn does not auto-deploy on merge.

For a persistent installation:

1. run behind HTTPS;
2. keep the SQLite database and project Git repository on durable storage;
3. configure backup of both;
4. set `SCADA_PUBLIC_URL` to the exact browser origin;
5. provide stable credentials through deployment secrets;
6. configure Web Push only if required.

See [plant runtime](plant/README.md) for environment variables and operational limits.

## Safety boundary

Saturn MVP is not safety-certified. It can model controls, alarms and interlocks for engineering/simulation purposes, but independent safety systems must not depend solely on Saturn.
