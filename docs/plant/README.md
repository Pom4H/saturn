# Node.js + browser SCADA

This implementation is a runnable **simulation/engineering workbench**, not an operational nuclear control system. It adds an isomorphic installation runtime to the existing editor. The old editor, its source-preserving edits, and the PR #11 recorder remain available; the new workbench reuses the component registry, SVG host, and CodeMirror rather than replacing those with a second renderer.

The same `Kernel`, `Service`, alarm evaluator, historian queries, report renderer, and project compiler run in Node.js and a browser Worker. Native SQLite and SQLite WASM are adapters. The browser repository emulates the application-level commit/publish/rollback contract, not the Git wire format.

## Run

```sh
npm ci
npm run plant
```

Open `http://127.0.0.1:4176/plant/app/` for the authenticated Node installation, or `/plant/demo/` for the browser-only version. A new database generates an initial named `engineer` account and prints its random password **once**. Save that password. There are no fixed production credentials. The CLI applies `umask(077)` before creating its database and project repository.

The implementation was exercised in the sandbox using **Node 22.16.0**, native SQLite 3.49.1, SQLite WASM 3.53.4, and isolated Playwright Chromium 153.0.8010.12. The repository's existing `.nvmrc` remains the pinned Node 24 toolchain. Use a patched Node release in either supported major for deployment; the old sandbox patch version is a test observation, not a security recommendation.

Optional environment configuration:

| Variable | Meaning |
|---|---|
| `HOST`, `PORT` | Default `127.0.0.1`, `4176` |
| `SCADA_DATABASE` | SQLite path; default `data-plant/plant.sqlite3` |
| `SCADA_PROJECT_REPO` | Dedicated Git repository; default `data-plant/project.git` |
| `SCADA_PUBLIC_URL` | Public HTTPS origin behind a reverse proxy; must match browser Origin |
| `SCADA_USER`, `SCADA_PASSWORD` | Initial named account; password at least 12 characters; existing users are not silently overwritten |
| `SCADA_PUSH_SUBJECT` | Operator contact `mailto:` or HTTPS URL; enables Web Push |

Do not expose plaintext HTTP remotely. Terminate TLS before the server and set `SCADA_PUBLIC_URL`. Authentication is server-side: HttpOnly/SameSite session cookie, CSRF token and same-origin checks, named roles, login throttling, and server-side authorization on mutations. `/plant/app/`, project sources, history, reports and SSE require authentication. Only the public demonstration and build assets are anonymous. This is single-installation authorization, not multi-tenant ACLs. User administration UI and external identity federation are not included.

## PWA and persistence

`npm run build` builds the old editor **and** `dist/plant/`. `npm run plant:build` builds only the new workbench/server. The public demo can be served by an ordinary static HTTP server, including below `/scada/plant/demo/` on Pages. It requires no application backend or CDN. Do not open it with `file://`.

The service worker precaches an explicit list of public demo HTML, JavaScript, WASM, CSS and icons. It never caches authenticated application HTML, API responses, project sources fetched from the server, report artifacts, or login responses. An installed update waits for explicit confirmation. The browser never falls back from a disconnected server to synthetic data.

SQLite WASM runs beside the simulation in a dedicated Worker. The `opfs-sahpool` VFS avoids COOP/COEP requirements; a Web Lock makes one tab the database owner. A second tab gives an explicit error, with the option to start a **separate, non-persistent in-memory session**. An OPFS error never silently replaces an existing project with an empty one. Browser quota, private-mode limitations and user-cleared site data still apply. Export important project files rather than treating browser storage as a backup.

Closing or freezing the browser pauses local execution. Restart resumes the persisted model clock; it does not fabricate the elapsed physical history. No claim of reliable browser background simulation or background cron is made. The server continues independently while the browser is closed.

Official implementation references:
- [SQLite persistence and SAH pool](https://sqlite.org/wasm/doc/trunk/persistence.md)
- [Chrome page lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
- [WebKit Home Screen Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

## Alarms and notifications

An alarm has independent active/cleared and acknowledged states, an activation delay, hysteresis, priority, quality, episode and operator identity. Acknowledgement does not remove the cause. Missing quality does not clear an active alarm. Alarm transitions and checkpoint changes are persisted together; the pending notification is created in the same transaction.

For Node, enable `SCADA_PUSH_SUBJECT`, open the authenticated app, and press **Уведомления**. Permission is requested only on user action. The server stores VAPID keys, subscriptions and an outbox in SQLite. Delivery uses the `web-push` library, encrypted messages, bounded retry, and removal of expired subscriptions. Endpoint registration allows only known push-provider HTTPS domains rather than arbitrary user-controlled destinations.

A push accepted by a provider is recorded as `accepted`, **not** as proof that a person received or read it. Payloads contain a generic notification and same-origin link, never process values, report data, passwords or project source. Opening the link still requires authentication. A subscription remains usable after cookie expiration for periodic reports; explicit logout from the registering session revokes it. The authenticated unsubscribe API also revokes a device. There is a five-device limit per user. This is an additional notification channel, not a safety interlock or guaranteed emergency delivery system.

The browser-only demo uses `ServiceWorkerRegistration.showNotification()` while its runtime is executing. It is not remote Web Push and cannot wake a closed demo to produce a report. iOS/Home Screen installation requirements are handled by an explanatory message, not a simulated success.

Verified here: local browser notification creation, alarm acknowledgement, subscription validation, outbox behavior, expiry/retry state handling, logout revocation, and actual `web-push` integration code. **External push-provider delivery to a physical phone was not verified in the sandbox.**

## Project versions and application releases

Only an immutable committed snapshot can be published. The shared compiler validates every imported module, signal reference, hierarchy, model parameter, archive policy, alarm and schedule before activation. Browser edits are drafts. Saving a commit and publishing it are distinct operations. A stale base revision is rejected; recovered drafts retain their original base revision.

The server repository uses `refs/heads/main` for authoring and `refs/scada/plant/published` for desired deployment. Check the actual symbolic branch in an existing repository before using external Git commands. Use a dedicated repository initialized by this application; do not point it at an unrelated working clone. Reads use immutable Git objects. No checkout over active files, hooks, arbitrary project JavaScript, or package lifecycle scripts are executed.

The server watches the desired ref. It retains a working applied checkpoint if an external candidate fails validation. The desired Git ref is durable before the applied SQLite checkpoint; restart reconciles a crash between them. Layout, report and archive-policy-only changes preserve the compatible simulation run. Dynamic model/wiring changes create a new run. A rollback creates a new commit containing old files and publishes that commit; it does not erase commits, measurements, report artifacts, or physical actions.

The native Git adapter does not add remote credentials or automatic `git fetch/push`. Repository transport can be handled by deployment tooling outside the service; the previous PR #11 Git project implementation remains available for its original scenes. Browser revisions have opaque `local:` identifiers and are not advertised as real Git object IDs. JSON import/export transfers project files, not an automatic merged history.

Installed model implementation changes require an application release and a model version change. Checkpoints reject incompatible model versions; there is no invented state migration. Back up the SQLite database **and** repository before upgrading. Stop the service for a straightforward file backup, or use SQLite's backup facilities; do not copy a live main database without accounting for WAL. Browser project JSON export is not an archive/checkpoint backup. Automated backup orchestration is not included.

## Reports as workflows

See [the DSL](dsl.md). Both manual and five-field UTC cron triggers create durable jobs. Jobs progress through queued/running/success/failure, pin the project revision, run ID, typed inputs, data interval and actual data capsule. A unique report/minute key suppresses duplicate scheduling. Interrupted jobs return to the queue at startup.

The scheduler checks current UTC minute; **missed minutes are not backfilled**. There is one report worker at a time and an eight-job pending limit. The demo schedules only while executing. Reports are a deliberately small workflow system: there is no shell execution, action marketplace, arbitrary JavaScript step or distributed DAG.

SQL runs in a new in-memory SQLite database containing only the report's declared `samples` and `segments`. It cannot access authentication, notification subscriptions, server files, operational command tables or Git metadata. SELECT-only validation is supplementary: process/worker isolation and the separate database are the actual boundary. A five-second worker timeout, bounded input/result counts and query-only mode limit abusive queries. Native reports run in disposable child processes, so the timeout can kill a native SQLite query. Each report adapter limits SQLite's allocator to 64 MiB; native report JavaScript also has a 96 MiB heap limit. These are not a total OS-enforced RSS quota. Unbounded blob/format allocation functions are rejected. Returned HTML escapes data and uses a restrictive CSP and sandboxed preview. Charts use the same SVG renderer in both environments.

`segments` retain the predecessor at the beginning of an interval. Time-weighted calculations account for unequal sample durations; unknown intervals are not zero. There is no universal database-side time-series abstraction or ORM. Historian retention is per signal for the active run. Old runs, reports and event journals are not automatically subject to a total storage quota: this is not yet a multiyear production historian.

## Verification

```sh
npm run plant:check
npx playwright install --with-deps chromium-headless-shell
npm run plant:test:browser
npm run check
```

The browser command starts its own isolated Node server on a free port, uses temporary credentials/database/Git, checks both remote and offline modes, and cleans up. `PWA_CHROMIUM` may select a test browser executable. `PWA_EVIDENCE_DIR` selects screenshots and JSON evidence (default `plant-test-results`). `.github/workflows/plant.yml` is **manual**, not a deploy or a billable test loop on every commit.

The Chernobyl-inspired model, assumptions and counterfactual results are documented [separately](model.md). Code under `plant/tests/` includes native/browser equation parity, SQL parity, quality, archive compression, native Git, release CAS, rollback, authentication, CSRF, report isolation and notification lifecycle tests. Type assertions also check the public DSL metadata inference. The existing legacy test suite remains separate; do not present its browser test counts as new PWA coverage.
