# Saturn Cloud

Saturn Cloud is the optional managed environment for Saturn installations that do not
want to operate an Internet-facing server.

It does **not** move the plant runtime into the cloud.

```text
Engineer Saturn / browser
          |
          | HTTPS / SSE
          v
     Saturn Cloud
   Vercel + Postgres
          ^
          | outbound WebSocket only
          |
     Saturn Edge
   local Saturn runtime
          |
      PLC / I/O / HMI
```

The local Saturn runtime remains authoritative for current observations, command
acceptance, alarms, the applied revision and physical equipment. Losing Internet
connectivity does not stop the local runtime.

## What this MVP provides

- one managed URL per site, for example `https://pump-01.saturn.example.com`;
- operator and engineer authentication;
- current project/runtime state;
- `head -> published -> applied` visibility;
- sampled cloud historian;
- SSE live stream compatible with Saturn Environment;
- remote commands routed back through the local `Service.command()` safety checks;
- stale last-known telemetry when Edge disconnects;
- fail-closed remote commands while the site is offline;
- a compact browser dashboard;
- an admin API for provisioning sites.

A normal engineering Saturn can connect to the Cloud site URL as an Environment.
Cloud intentionally exposes the same `/plant/api/*` contract instead of inventing
a second IDE protocol.

## Vercel deployment

Use `cloud/` as the Vercel project root.

The WebSocket Edge endpoint uses a long-running Vercel Function, so production
deployments should use a Pro or Enterprise team with Fluid compute enabled. The
configuration opts into a 30 minute function duration; Edge reconnects
automatically when an invocation is recycled.

1. Add a PostgreSQL provider from Vercel Marketplace. Neon is the reference
   adapter and only requires `DATABASE_URL`.
2. Run `migrations/001_init.sql` against that database.
3. Configure:

```env
DATABASE_URL=postgresql://...
SATURN_CLOUD_ROOT_DOMAIN=saturn.example.com
SATURN_CLOUD_ADMIN_TOKEN=<at-least-32-random-characters>
```

4. Add `saturn.example.com` and the wildcard `*.saturn.example.com` to the
   Vercel project.
5. Deploy.

The cloud package uses Node.js 24 and standard `ws` WebSockets.

## Provision a site

Site creation is deliberately an administrative operation. Credentials are returned
only in the creation response.

```sh
curl -X POST https://saturn.example.com/api/sites \
  -H "Authorization: Bearer $SATURN_CLOUD_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slug":"pump-01","name":"Pump station 01"}'
```

The response contains:

- the site URL;
- `SATURN_CLOUD_URL`;
- `SATURN_CLOUD_SITE`;
- `SATURN_CLOUD_TOKEN`;
- initial `operator` credentials;
- initial `engineer` credentials.

Store that response securely.

## Connect a local Saturn runtime

Set the three Edge variables on the machine that already runs Saturn:

```env
SATURN_CLOUD_URL=https://saturn.example.com
SATURN_CLOUD_SITE=pump-01
SATURN_CLOUD_TOKEN=<site-edge-token>
```

Then run Saturn normally:

```sh
saturn run ./project
```

The connection is outbound only. No public plant IP, inbound port forwarding or
plant TLS certificate is required for Cloud connectivity. Edge requires HTTPS/WSS
for non-loopback Cloud URLs; plaintext WebSocket is accepted only for local development.

When Cloud is absent or unreachable, Saturn keeps running locally and reconnects
with exponential backoff.

## Connect an engineering Saturn

Add this Environment:

```text
Name: Pump station 01
URL:  https://pump-01.saturn.example.com
User: operator | engineer
Password: <site credential>
```

The existing Environment broker exchanges the password for a short-lived bearer
session and keeps that bearer in memory.

## Safety boundary

Cloud does not bypass local Saturn safety rules.

Every remote command still reaches `Service.command()` on the authoritative
runtime, which checks role, runtime health, command ID, applied revision and run ID
where applicable. A repeated command ID is idempotent. A disconnected Edge makes
the cloud copy stale and remote commands are rejected before queueing.

The Edge token is deployment state. It must never be placed in project TypeScript,
Git, reports or share URLs.

## Current limitations

This is the first vertical slice, not an HA industrial control plane.

- Cloud samples the live stream; it does not yet backfill every local historian
  sample accumulated during a long Internet outage.
- Report artifacts and the full event journal remain local in this MVP.
- Runtime restart is intentionally not exposed remotely yet.
- One Edge connection is expected per site. Runtime-authority failover needs a
  separate HA decision.
- Billing, organizations, invitations, password rotation, SSO and fleet views are
  commercial-product follow-ups.

These limits are intentional: the first Cloud release proves the managed
Environment boundary without moving runtime authority away from the plant.

## Licensing

Saturn Core remains under the repository root MIT license.

The `cloud/` directory is commercial source and is governed by
[cloud/LICENSE](LICENSE).
