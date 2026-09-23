# ADR-0002: Extension packages and trust model

- **Status:** Superseded by [ADR-0008](0008-conventions-first-artifact-runtime.md)
- **Date:** 2026-09-20
- **Depends on:** ADR-0001

## Supersession

The installation-scoped extension store/installer described below was removed. Saturn now prefers source copied into the project through the registry; ordinary package dependencies are used only when code is intentionally external and shared. This ADR remains as negative knowledge.

## Context

Saturn needs equipment libraries, custom elements, industrial protocols, data sources, reports and IDE features without turning each installation into a fork of the application. The project model must remain reproducible, while the standalone application must not require Node, npm or Bun to be separately installed on the target machine.

## Decision

npm-compatible registries are the transport and version catalogue for Saturn extensions. Saturn is the installer and extension host.

An extension package is ordinary npm package metadata plus a Saturn manifest:

~~~json
{
  "name": "@saturn/my-extension",
  "version": "1.4.2",
  "saturn": {
    "api": 1,
    "entry": "dist/index.js",
    "capabilities": ["elements"],
    "elements": [
      {
        "type": "saturn.example",
        "title": "Motor",
        "tag": "factory-motor",
        "glyph": "electrical.motor",
        "category": "electrical"
      }
    ]
  }
}
~~~

### Self-contained packages

Installed extensions must be pre-bundled and have no runtime npm dependencies or optional dependencies.

Saturn never executes npm lifecycle scripts and never runs an external package manager during installation. This makes installation deterministic and keeps standalone Saturn independent of Node/Bun/npm on the target machine.

Development repositories may still use `bun add` or workspaces normally. The standalone installer consumes the published bundled artifact.

### Integrity

The installer:

1. resolves an exact version through registry metadata;
2. requires npm `sha512` integrity;
3. downloads the tarball over HTTPS (loopback HTTP is allowed for tests);
4. verifies integrity before extraction;
5. rejects symlinks, path traversal, oversized archives and unexpected tar entry types;
6. validates package identity and Saturn manifest again after extraction;
7. atomically activates the exact version.

Registry credentials are host/user configuration such as `SATURN_NPM_TOKEN`; they are never written to a project.

### Scopes

ADR-0001 defines installation/user scope and project scope.

This implementation first establishes the installation store:

~~~text
Saturn application data/
  extensions/
    state.json
    packages/
      saturn__my-extension/
        1.4.2/
~~~

Project manifests may later declare required/recommended extension ranges, but opening an untrusted project must never silently install executable extension code.

### Trust

Extensions are trusted application code, not declarative project data.

Installing an extension is an explicit trust action. Its code may only execute through a Saturn extension host matching the manifest API and granted capabilities.

Capability names in API v1 are:

- `elements`
- `protocol`
- `datasource`
- `panel`
- `command`
- `report`

Future permissions that grant filesystem, network or process access require a separate explicit permission model; capability declaration alone does not grant those OS privileges.

### CLI

~~~sh
saturn extension list
saturn extension add @saturn/my-extension
saturn extension add @saturn/my-extension@1.4.2
saturn extension update @saturn/my-extension
saturn extension remove @saturn/my-extension
~~~

### Consequences

- one Saturn binary can gain domain-specific capabilities;
- npm registry/versioning infrastructure is reused without embedding npm as a runtime dependency;
- extension releases can be pinned independently of Saturn;
- extension installation is intentionally stricter than arbitrary npm installation;
- full host execution for each capability can evolve without changing package transport or trust boundaries.

## Rejected alternatives

### Execute arbitrary package install scripts

Rejected because it makes target behavior non-reproducible and gives registry packages uncontrolled installation-time code execution.

### Store extension code inside project Git

Rejected because trusted executable application code and authored declarative project configuration have different trust and update lifecycles.

### Invent a proprietary package registry

Rejected because npm-compatible registries already solve naming, version metadata, private scopes and artifact distribution.


### Element packs and visual identity

The `elements` capability uses the same element design system as Saturn Core. Package metadata may expose a stable `glyph` and `category` for discovery before trusted package code is activated. Raw SVG is intentionally not accepted in the manifest.

Trusted extension code may register richer element definitions and visual renderers. A device family should keep these concerns distinct:

- semantic type, ports, signals and commands;
- stable engineering glyph for catalog/tree/navigation;
- canonical spatial geometry identity;
- material and medium presets;
- optional vendor-specific renderers.

The glyph answers **what kind of equipment is this?** while the spatial representation answers **which physical/vendor variant is this?**. Multiple vendor models can therefore share one engineering glyph without sharing geometry.
