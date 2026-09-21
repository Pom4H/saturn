# Security

Saturn separates authored project data, trusted application code and live operational authority.

## Project source

Saturn projects are treated as untrusted declarative input. The compiler accepts a bounded TypeScript subset and does not execute arbitrary project JavaScript. Project text cannot gain DOM, filesystem or network authority through the DSL. Source size, AST evaluation and domain objects are bounded and validated before a revision can become runnable.

Visual editing patches the same source artifact; it does not create a second hidden executable project format.

## Authentication and roles

The production Bun server uses application users with three ordered roles:

- `viewer` — read live state, history and reports;
- `operator` — viewer access plus allowed operational commands and acknowledgements;
- `engineer` — operator access plus project, release and engineering actions.

Browser sessions use HttpOnly, SameSite cookies and CSRF protection for state-changing requests. Login attempts are rate-limited. Bun credentials use Argon2id; legacy scrypt rows are upgraded after a successful login.

Saturn-to-Saturn environment connections exchange credentials server-to-server for a short-lived bearer session. Remote bearer credentials stay in process memory and are not written to project TypeScript, Git commits or share URLs.

## Network boundary

The server binds to loopback by default. Cross-origin writes and live connections are rejected unless they match the configured origin. Request bodies, live connections and stream buffers are bounded. TLS, HTTP/2 and Unix-socket deployment are explicit host configuration.

Git and runtime communication are separate protocols: Git is configuration authority; the running operator instance is runtime authority. Losing a live connection makes observations stale/offline and commands fail closed instead of silently falling back to simulation.

## Extensions and equipment integration

Extensions are trusted installed application code, not project data. Installation is explicit. Saturn uses npm-compatible registries as transport, requires sha512 integrity, does not execute npm lifecycle scripts and does not silently install executable code requested by an untrusted project.

Industrial protocol drivers, equipment behavior and PLC target providers run behind explicit adapter/provider boundaries. The bundled demonstrations use synthetic equipment; connecting real equipment requires an installed integration and deployment-specific engineering.

A visualization, simulator, report or generated HMI is never a safety authority. Safety functions and equipment limits remain the responsibility of the relevant certified control system and engineering process.

## Reports and generated artifacts

Report definitions operate on bounded runtime/history interfaces. Production report execution is isolated from the main runtime worker. Generated reports, exported HTML and shared project links may contain project source or operational data; treat those artifacts according to the sensitivity of the installation.

## Browser and offline storage

The public landing has no analytics account service. Local browser workspaces and offline assets are stored on the device. Shared links can contain complete authored source in the URL fragment. Anyone receiving such a link can read that source.

## Updates

Application updates and extension updates are separate from project releases. The standalone update protocol verifies signed manifests before replacing an application binary. Projects, workspace metadata, extensions and runtime databases have independent lifecycles.

## Reporting vulnerabilities

Use GitHub private security reporting when available. Otherwise contact the maintainer privately before publishing an exploit. Include a minimal reproducer and never attach real credentials, private project source or operational plant data.

The architectural security boundaries are documented in [ADR-0001](docs/adr/0001-saturn-system-architecture.md) and the extension trust model in [ADR-0002](docs/adr/0002-extension-packages.md).
