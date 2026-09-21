# Saturn server runtime

Saturn runs the same authored project as an engineering workspace, an operator runtime or a kiosk HMI. The production server is Bun-based and keeps project configuration, runtime state and application updates as separate lifecycles.

## Start

```sh
npm run plant
```

By default Saturn listens on `127.0.0.1:4176`. If no persistent engineer account exists, the first run creates one and prints its generated password once. Store that password immediately.

Useful routes:

- `/` — Saturn landing / engineering shell;
- `/plant/app/` — authenticated installation UI;
- `/plant/demo/` — browser-local demonstration;
- `/plant/api/health` — unauthenticated health check.

## Host configuration

The v0.1 server keeps the historical `SCADA_*` environment-variable prefix for compatibility even though the product name is Saturn.

| Variable | Purpose |
| --- | --- |
| `HOST` / `PORT` | TCP listen address, default `127.0.0.1:4176` |
| `SCADA_UNIX_SOCKET` | listen on a Unix socket instead of TCP |
| `SCADA_PUBLIC_URL` | externally visible origin; required with Unix sockets |
| `SCADA_TLS_CERT` / `SCADA_TLS_KEY` | TLS certificate and key; configure together |
| `SCADA_TLS_CA` | optional comma-separated CA files |
| `SCADA_HTTP2` | explicitly enable/disable HTTP/2 |
| `SCADA_DATABASE` | runtime SQLite database location |
| `SCADA_PROJECT_REPO` | Git repository used for project/release refs |
| `SCADA_USER` / `SCADA_PASSWORD` | initial engineer credentials |
| `SCADA_PROJECT_REMOTE` | tracked Git remote |
| `SCADA_PROJECT_BRANCH` | engineering branch, default `main` |
| `SCADA_PROJECT_RELEASE_BRANCH` | release branch, default `production` |
| `SCADA_PROJECT_REF` / `SCADA_PROJECT_RELEASE_REF` | explicit source/release refs |
| `SCADA_PUSH_SUBJECT` | enables Web Push support for the installation |

Credentials for Git/SSH and extension registries are host configuration. They do not belong in project source.

## Identity and authorization

The server has `viewer`, `operator` and `engineer` roles. Browser login creates an eight-hour HttpOnly/SameSite session and uses CSRF for writes. Bun stores password hashes with Argon2id.

The engineering shell can connect to another Saturn runtime without moving source authority to that runtime. The browser gives credentials only to its own Saturn backend; the backend holds the resulting remote bearer session in memory.

## Project and release refs

Git is configuration authority.

```text
main / source ref
      ↓ validate
production / release ref
      ↓ apply
running revision
```

The running installation records both desired and applied revisions. An invalid release does not replace the last valid running revision. External Git changes are detected and reloaded through the same validation boundary.

## Live runtime

The operator instance owns live signals, history, alarms, command receipts and report jobs. Browsers are clients of that authority; closing a tab or pausing a view does not pause the installation.

Live transport supports snapshot + stream semantics over SSE and WebSocket. Reconnection starts from a complete current snapshot. When the stream is lost or stops advancing, retained values become visibly stale and operational commands fail closed.

## Storage

Operational state is stored behind the Saturn SQL adapter. The production Bun composition uses `bun:sqlite`. Browser demonstrations use SQLite WASM/OPFS and enforce a single persistent writer; another tab can use an isolated in-memory demo instead.

Project source remains ordinary files/Git. Runtime databases are not a replacement for source control.

## Reports

Reports are authored in the project model but execute against bounded runtime/history interfaces. Production report jobs run in isolated workers and produce durable artifacts independently of the browser session.

## Equipment and protocols

The included demo is synthetic. Real equipment access belongs behind installed protocol adapters and target providers. Saturn already has explicit boundaries for TCP/Modbus-class integrations and PLC compile/deploy/flash providers; a project upload cannot acquire arbitrary network or executable-code authority by itself.

See [ADR-0001](adr/0001-saturn-system-architecture.md) for the complete authority model and [SECURITY.md](../SECURITY.md) for the trust boundaries.
