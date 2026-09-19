# Resilient client/server connection

Saturn uses the same application shell in the public web demo, installed PWA and packaged desktop/mobile builds. The shell must therefore treat the network as a transport detail rather than as application state.

## Contract

The client keeps three independent states:

1. **Auth/session** — whether commands and protected data are authorized.
2. **Transport** — connecting, live, stale/reconnecting, offline, or auth-required.
3. **Revision identity** — the source revision and run that produced the frame.

A frame is actionable only when transport is live and its revision/run still match the loaded project. The last confirmed frame may remain visible after a disconnect, but every value is marked stale and controls are disabled. This is intentionally fail-closed: loss of connectivity never turns an old value into a current measurement.

## Reconnect behaviour

The SSE stream is the normal telemetry path. On a transport failure the client keeps the last confirmed frame, enters **stale**, and reconnects on a bounded schedule (1 s, 2 s, 5 s, then 10 s). Browser online/offline events can wake the reconnect loop but are not treated as proof that the Saturn server is reachable.

Every reconnect begins with `GET /plant/api/session`, so a client that missed any number of SSE frames receives the current authoritative frame before opening a new stream. Sequence numbers reject out-of-order frames.

## Commands on a poor link

Commands remain disabled while telemetry is stale/offline or when the executing revision differs from the loaded revision.

A command carries a stable `command.id`. The server already persists command receipts and rejects reuse of the same id with different content. The client may therefore retry a timed-out command using the **same payload and id**. It must never manufacture a second id merely because the acknowledgement was lost.

This gives the operator a deterministic result:

- live + matching revision: command can be submitted;
- acknowledgement arrives: show accepted;
- request times out: retry the same id;
- link is lost: keep the last frame as stale and disable controls;
- session expires: enter auth-required and stop pretending reconnect alone can restore control.

## Platform transport

The domain API above is platform-neutral. Browser/PWA currently use same-origin cookie auth and `/plant/api/*`. Packaged Bun/macOS/Windows/mobile hosts should provide a transport adapter with the same operations (session, stream, post) and explicit server origin/credential storage. Project/source/runtime code must not depend on whether the transport is a browser cookie, native secure storage, or a future local gateway.

No offline command queue is allowed. Offline project authoring can continue locally, but control actions require a live session and matching revision at the moment they are issued.
