# ADR-0007: Saturn Cloud is an optional managed Environment

**Status:** Accepted  
**Date:** 2026-09-21

## Context

Saturn Core can run an installation completely locally, but a large class of users
does not want to operate a public server, TLS, remote access, backups and an
Internet-facing historian themselves.

The managed product must not weaken the architecture established by ADR-0001:

- Git remains configuration authority;
- the operator Saturn remains runtime authority;
- `head`, `published` and `applied` are distinct;
- telemetry never edits source;
- commands fail closed against the applied revision and run;
- loss of an engineering client or cloud service must not pause the plant.

Moving the actual control/runtime loop into a generic SaaS function would violate
that boundary and would make plant operation depend on WAN availability.

## Decision

Saturn Cloud is a managed **Environment mirror and control plane**, not a plant
runtime.

```text
             Git
              |
      Engineer Saturn
              |
              | Saturn Environment API
              v
        Saturn Cloud
       Vercel + Postgres
              ^
              | outbound WebSocket
              |
        Saturn Edge
     local runtime authority
              |
         PLC / equipment
```

### Local authority

The existing local `Service` remains authoritative for:

- current observations and quality;
- the applied project revision;
- run identity;
- alarms;
- command acceptance;
- local historian;
- physical I/O and protocol drivers.

Cloud downtime therefore does not stop the installation.

### Edge transport

A configured Saturn runtime opens one outbound WebSocket to Cloud.

The Edge sends:

- installation identity and revision state;
- the canonical compiled Project model;
- sampled runtime Frames;
- heartbeat state;
- command receipts.

Cloud sends commands back to Edge. Edge does not implement a second command
engine: it passes them into the existing `Service.command()`. This preserves role,
health, command-ID, revision and run guards.

The Edge credential is environment/deployment state and never belongs in project
source.

### Reconnection

The WebSocket transport is disposable. Edge reconnects with bounded exponential
backoff. This is required independently of provider behavior because Vercel
Functions have finite invocation durations.

Durable command state lives in PostgreSQL rather than in a WebSocket process.
A new connection can lease an unfinished command. The local runtime still provides
the final idempotency boundary.

### One origin per site

A site is addressed as a subdomain:

```text
https://plant-01.saturn.example.com
```

Cloud implements the existing `/plant/api/*` Saturn Environment contract at that
origin. The engineering IDE therefore does not need a Cloud-specific runtime API.

### Offline presentation

Cloud retains the last confirmed Frame. Once Edge is no longer current, the values
remain visible but their quality is projected as `stale`.

Remote commands are rejected while the Edge is offline.

### Storage

PostgreSQL stores:

- site identity and credential hashes;
- short-lived application sessions;
- sampled historian points;
- last project / instance / frame snapshots;
- durable command queue and receipts.

The first version deliberately does not make Cloud the canonical Git repository or
the canonical local historian.

### Deployment

The reference hosted composition is:

- Vercel static UI + Functions;
- standard Node.js WebSocket endpoint;
- Fluid compute for long-lived Edge connections;
- PostgreSQL through a Vercel Marketplace provider.

The database contract uses a normal `DATABASE_URL`; Neon is the initial adapter,
not a Saturn domain dependency.

### Product/licensing boundary

Saturn Core remains open under the repository root license and remains useful
without Cloud.

The `cloud/` implementation is commercial source under its own license notice.
Users pay for managed infrastructure and organizational service, not for tag count,
screen count or the ability to operate a local plant.

## Consequences

### Positive

- no inbound plant ports or public IP are required;
- Cloud failure cannot stop local control;
- engineering Saturn connects through the same Environment model;
- cloud and self-hosted deployments share project/runtime semantics;
- durable commands survive WebSocket function recycling;
- commercial SaaS code is separated from the open Core dependency graph.

### Costs

- Cloud is a mirror, so sampled cloud history can have gaps after WAN outages;
- wildcard site domains and managed identity must be operated;
- a WebSocket reconnect path is mandatory;
- full historian backfill, reports, organizations and HA require later work.

## Rejected alternatives

### Run the authoritative plant runtime in Vercel

Rejected because WAN/provider availability would enter the physical control path.

### Connect Cloud directly to PLCs

Rejected because it bypasses the Saturn runtime safety and provenance boundary and
requires inbound industrial-network exposure.

### Make Cloud the source authority

Rejected because Git already owns authored configuration and release review.

### License by tags, screens or connected PLCs

Rejected because those are properties of the engineering model, not managed-service
cost. Cloud monetizes hosting, retention, collaboration and fleet operations.
