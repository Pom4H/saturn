# Bun server runtime

Saturn's installation runtime uses Bun for the native server adapter while keeping
the plant kernel, compiler, alarms, historian policy and service contracts
portable. The browser Worker still runs the same portable layers.

The boundary is deliberate:

```text
project.ts -> compiler -> Project
                         |
                    Service / Kernel
                         |
          +--------------+----------------+----------------+
          |              |                |                |
       BunSql       GitRepository     report worker     drivers
          |              |                |                |
       SQLite          bare Git       Bun.spawn       Bun.connect
          |                               |                |
          +-------------------------------+---------- Modbus TCP
                          |
                     Bun.serve
                    /        \
                  HTTP      WebSocket
                  SSE       pub/sub
```

## What Bun owns

Bun is used where it removes adapters or gives Saturn a stronger runtime boundary:

- `Bun.serve` handles HTTP, SSE, WebSocket upgrades, direct TLS/HTTP2 and optional
  Unix-domain sockets.
- `server.publish()` fans live frames out to WebSocket subscribers without one
  JavaScript callback per subscriber.
- `Bun.file` streams immutable build assets without copying them into a Buffer.
- `bun:sqlite` implements the existing synchronous `SqlDatabase` contract;
  WAL, FULL synchronous durability and explicit `BEGIN IMMEDIATE` transactions
  remain unchanged.
- `Bun.password` stores new server credentials as Argon2id. Existing scrypt
  credentials are accepted and upgraded after a successful login, so an existing
  installation does not need a destructive auth migration.
- `Bun.cron` wakes the report scheduler on minute boundaries instead of polling
  every second. Release refresh and push delivery remain independent housekeeping.
- `Bun.spawn` runs report capsules as disposable processes with hard timeout,
  a minimal environment, and optional Linux cgroup placement via
  `SCADA_REPORT_CGROUP`.
- `Bun.connect` provides the persistent bounded TCP transport used by protocol
  adapters. The first real adapter is Modbus TCP with FC03, FC04 and FC06.

SSE remains supported for existing browser clients. WebSocket is an additive,
read-only live transport at `/plant/api/ws`: authentication comes from the same
HttpOnly session cookie and the handshake is same-origin. Commands continue to
use the CSRF-protected HTTP API.

## Industrial I/O boundary

Protocol drivers terminate above the historian:

```text
device / PLC
     |
Bun TCP/UDP transport
     |
protocol adapter
     |
typed signal / command boundary
     |
Service -> historian / alarms / HMI
```

They must not write directly into SQLite or the renderer, and they must not create
a second project/configuration model. `BunTcpChannel` deliberately owns only
connect/reconnect, framing bounds and timeout; protocol semantics stay in separate
adapters. `ModbusTcpClient` proves that boundary with real MBAP framing,
transaction checks, exception handling and bounded register requests.

Bun also ships native UDP, Redis, SQL and S3 clients. They are intentionally not
mandatory dependencies of a single Saturn installation. Redis Pub/Sub is still
an optional distributed transport rather than the source of truth; PostgreSQL/S3
make sense later as historian/archive adapters, not as requirements for an edge
server that should remain deployable as Bun + SQLite + Git.

## Listener modes

Default local mode:

```sh
npm run plant
```

Direct TLS can be enabled without a reverse proxy:

```sh
SCADA_TLS_CERT=/etc/saturn/tls/cert.pem \
SCADA_TLS_KEY=/etc/saturn/tls/key.pem \
SCADA_PUBLIC_URL=https://saturn.example.com \
HOST=0.0.0.0 PORT=443 npm run plant
```

When TLS is configured, HTTP/2 is enabled by default. Set `SCADA_HTTP2=0` to
disable it.

For a local reverse proxy, Saturn can avoid opening a TCP port entirely:

```sh
SCADA_UNIX_SOCKET=/run/saturn/server.sock \
SCADA_PUBLIC_URL=https://saturn.example.com \
npm run plant
```

`SCADA_PUBLIC_URL` is mandatory in Unix-socket mode because browser origin
validation cannot be inferred from a filesystem socket.

## Report isolation

Report SQL already runs against a separate in-memory data capsule. The Bun worker
adds a process boundary. By default the child receives only `TZ=UTC`, not the
server's database, Git, push or cloud credentials.

On Linux an administrator can additionally place report workers into a prepared
cgroup:

```sh
SCADA_REPORT_CGROUP=/sys/fs/cgroup/saturn-reports
```

Create and configure the cgroup outside Saturn (for example `memory.max` and
`pids.max`). Bun joins the child to it before execution; Saturn does not grant
itself privileges to create or reconfigure cgroups.

## Verification

Install the pinned Bun version from `.bun-version`, then:

```sh
npm ci
npm run plant:bun:smoke
npm run plant:check
```

The Bun smoke test covers native SQLite transactions, isolated report execution,
a loopback Modbus TCP device over `Bun.listen`/`Bun.connect`, login/session,
origin protection and WebSocket delivery.

The legacy `server/` recorder remains available during the transition so its
existing replay/API contracts can continue to be regression-tested independently.
