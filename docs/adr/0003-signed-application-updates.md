# ADR-0003: Signed application updates

- **Status:** Accepted
- **Date:** 2026-09-20
- **Depends on:** ADR-0001

## Context

Standalone Saturn should be downloaded once and then update itself without recompiling projects, reinstalling Node/Bun or replacing runtime databases. An update mechanism for industrial installations must fail closed, survive interrupted upgrades and permit rollback when a new executable cannot start.

## Decision

Saturn application updates use a signed release manifest and atomic executable replacement. Project source, workspace metadata, extensions and runtime databases are outside the application binary and are never part of an application update.

### Manifest

~~~json
{
  "schema": 1,
  "version": "0.2.0",
  "channel": "stable",
  "publishedAt": "2026-09-20T00:00:00Z",
  "artifacts": {
    "windows-x64": {
      "url": "https://…/saturn.exe",
      "sha256": "…",
      "signature": "…",
      "size": 50000000
    }
  }
}
~~~

Each artifact signature is Ed25519 over a canonical payload containing schema, version, channel, target, URL and SHA-256 digest.

The verification public key is embedded at Saturn build time. Supplying a different manifest URL does not replace the trusted public key.

### Update flow

~~~text
check manifest
   |
verify Ed25519 metadata
   |
download artifact
   |
verify size + SHA-256
   |
stage outside project/runtime data
   |
copy running Saturn to temporary updater
   |
exit current Saturn
   |
rename current -> saturn.previous
rename staged -> current
   |
run hidden health check
   | success                 | failure
   v                         v
restart Saturn          restore previous
~~~

On Windows a running executable is not expected to replace itself. Saturn therefore starts a temporary copy of the old executable as the updater and exits before replacement.

### Health gate

A new executable is not accepted merely because bytes were replaced. The updater launches the new Saturn in an internal health-check mode that initializes the bundled runtime and verifies the local health endpoint. A non-zero health-check exit restores the previous executable.

### Channels

Supported channels are `stable`, `preview` and `nightly`.

Operator/production installations default to `stable`. Downgrades are rejected unless the administrator explicitly requests `--allow-downgrade`.

### CLI

~~~sh
saturn update --check
saturn update
saturn update --channel preview
~~~

A build without an embedded update manifest URL may use `--manifest`; signature verification still uses the embedded public key.

### Release key handling

The private Ed25519 signing key must never be committed to the repository or embedded in Saturn. Release CI receives it from a protected signing secret or external signing service.

The public key and default manifest URL are build inputs.

### Installation permissions

Self-update can only replace an executable location writable by the current user. The default distribution should therefore prefer a per-user installation directory on desktop platforms. System-wide installations require an external privileged installer/service and do not weaken signature verification.

## Consequences

- updating Saturn does not release a plant project;
- projects and runtime history survive application replacement;
- corrupted or unsigned downloads fail before replacement;
- a binary that cannot start is rolled back automatically;
- release infrastructure must manage an Ed25519 signing key and publish manifests.

## Rejected alternatives

### Trust HTTPS alone

Rejected because CDN/account compromise should not be sufficient to publish a Saturn binary accepted by existing installations.

### Update projects together with the application

Rejected because ADR-0001 deliberately separates application and project release lifecycles.

### Overwrite the running Windows executable directly

Rejected because it is unreliable and removes the rollback boundary.
