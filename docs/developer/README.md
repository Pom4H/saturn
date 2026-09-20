# Saturn developer documentation

Start here when changing the project language, editor, extensions or agent-facing tooling.

- [TypeScript DSL, language tooling and coding agents](language-tooling.md) — canonical developer guide for `@saturn/core`, CodeMirror/LSP, diagnostics, i18n, extensions and agent workflows.
- [System architecture](../adr/0001-saturn-system-architecture.md)
- [Extension packages and trust](../adr/0002-extension-packages.md)
- [Package names and project DSL](../adr/0004-package-and-dsl-names.md)
- [Installation DSL reference](../plant/dsl.md)
- [Shell/host boundaries research](../research/shell-host-boundaries-2026-09-19.md)

## Rule of thumb

If a new Saturn entity needs editor-specific regexes, duplicated metadata or prose-only errors, stop and check whether the same information belongs in TypeScript types, shared model metadata or structured Saturn diagnostics first.
