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
          +--------------+---------------+
          |              |               |
       BunSql       GitRepository     report worker
          |              |               |
       SQLite          bare Git       isolated process
                         |
                    Bun.serve
                    /       \
                  HTTP      WebSocket
                  SSE       pub/sub
```

Bun owns the hot path around the service:

- `Bun.serve` handles HTTP, SSE and WebSocket upgrades.
- `server.publish()` fans live frames out to WebSocket subscribers without one
  JavaScript callback per subscriber.
- `Bun.file` streams immutable build assets without copying them into a Buffer.
- `bun:sqlite` implements the existing synchronous `SqlDatabase` contract;
  WAL, FULL synchronous durability and explicit `BEGIN IMMEDIATE` transactions
  remain unchanged.
- `maxRequestBodySize` and per-request idle timeouts are enforced by the server
  in addition to application validation.
- the server has a stable `id`, so `bun --hot` can replace its handler during
  development without opening another listening socket.

SSE remains supported for existing browser clients. WebSocket is an additive,
read-only live transport at `/plant/api/ws`: authentication comes from the same
HttpOnly session cookie and the handshake is same-origin. Commands continue to
use the CSRF-protected HTTP API.

Protocol drivers should terminate at a typed signal boundary above the historian;
they must not write directly into the database or renderer. The project model
remains the source of truth. Adding Modbus, OPC UA or Saturn PLC transport must
not create a second project/configuration model.

## Run

Install the pinned Bun version from `.bun-version`, then:

```sh
npm ci
npm run plant
```

The browser application stays at `http://127.0.0.1:4176/plant/app/`.

For a focused native smoke test:

```sh
npm run plant:bun:smoke
```

The legacy `server/` recorder remains available during the transition so its
existing replay/API contracts can continue to be regression-tested independently.
