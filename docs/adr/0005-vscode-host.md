# ADR-0005: VS Code is a Saturn host, not another Saturn IDE

- **Status:** Accepted
- **Date:** 2026-09-20
- **Depends on:** ADR-0001, ADR-0002, ADR-0004

## Context

Saturn already has a browser/PWA shell and a standalone engineering shell. VS Code is useful to engineers and software developers because it already owns source editing, TypeScript navigation, Git, terminals, tasks, workspace trust, settings and extension UX.

Rebuilding those features in a large Saturn webview would fork the product and create two editors with different semantics.

At the same time, plain TypeScript support is not enough for engineering work. VS Code needs first-class access to mnemonics, equipment catalogs, runtime/server lifecycle, deployment targets and controller tooling.

## Decision

VS Code is another host of Saturn's project/language/runtime contracts.

It does not get another project model and does not serialize a second representation of the mnemonic.

### VS Code surface mapping

| Saturn concept | VS Code integration |
|---|---|
| TypeScript project source | normal VS Code text editor and TypeScript service |
| project/equipment navigation | Activity Bar container + native `TreeView` |
| equipment catalog | native `TreeView`, searchable/refreshable, extension-backed |
| mnemonic / 2D / 3D | editor-area `WebviewPanel` beside source |
| diagnostics | Problems collection through Saturn language service |
| hover/completion/rename | TypeScript/LSP host described by the language-tooling guide |
| live runtime | status bar + target tree + runtime client |
| local server | integrated terminal / Task API, explicit start and stop |
| deployment | bounded target action delegated to Saturn target provider |
| controller discovery/flash/monitor | bounded target action delegated to Saturn target provider |
| credentials | VS Code `SecretStorage`, never project files |
| Git | VS Code SCM; Saturn does not implement another Git UI |
| commands | Command Palette / context menus / QuickPick |
| logs | OutputChannel or terminal depending on whether output is structured or interactive |

### Why the mnemonic is not a custom editor for TypeScript

A VS Code custom editor registered for `*.ts` would compete with the normal TypeScript editor and damage the source-first workflow.

The mnemonic is therefore a separate editor tab created with `WebviewPanel`. It can sit beside `plant.ts`, follow source selection and send source edits through the same Saturn source-edit contract. The TypeScript file remains a normal text document.

### Equipment catalog

The first bridge reuses the accepted extension manifest from ADR-0002.

```text
saturn ide catalog --json
             |
             +-- plant/models.ts
             |
             +-- installed extension.elements
                        |
                        v
              VS Code Equipment Catalog
```

Every installed package that contributes `elements` becomes a catalog group automatically. A vendor equipment library therefore remains a Saturn extension, not a second VS Code extension.

The host may later add richer catalog metadata without changing project identity.

### Targets

A project may declare target identity in `.saturn/targets.json`:

```json
{
  "schema": 1,
  "targets": [
    {
      "id": "operator-a",
      "title": "Operator A",
      "kind": "server",
      "provider": "@factory/docker",
      "actions": ["deploy", "logs"]
    },
    {
      "id": "plc-01",
      "title": "Saturn PLC 01",
      "kind": "controller",
      "provider": "@saturn/plc",
      "actions": ["flash", "monitor"]
    }
  ]
}
```

The project may name a provider and a bounded action. It may not contain a shell command.

This is important for workspace trust: cloning a project must never make VS Code execute a command supplied by that Git repository.

Target execution belongs behind the Saturn CLI/provider boundary:

```text
VS Code button / task
        |
        v
saturn target flash plc-01
        |
        v
installed trusted provider
        |
        v
controller transport / bootloader
```

The same provider is then reusable by standalone Saturn, CI and VS Code.

### Local runtime

`Saturn: Run Server` starts `saturn open <workspace>` in the integrated terminal with the configured host/port. The process remains visible to the engineer. Closing/stopping the terminal stops the local runtime.

The diagram view points at that local Saturn runtime rather than implementing another compiler/rendering stack.

## Implemented in the first VS Code slice

The repository now contains a loadable CommonJS VS Code extension under `vscode/` with:

- Saturn Activity Bar container;
- Project, Equipment Catalog and Targets views;
- diagram editor tab;
- local runtime start/stop;
- HMI open command;
- status-bar runtime state;
- insertion of a selected catalog element into the active TypeScript document;
- canonical core + extension catalog discovery through `saturn ide catalog --json`;
- safe target descriptor parsing;
- Deploy and Flash commands that only become actionable for targets advertising those capabilities;
- tests ensuring target files cannot inject arbitrary actions.

Provider-side `saturn target ...` execution is a separate layer. Until a provider exists, the VS Code host reports that deploy/flash is unavailable rather than pretending hardware work succeeded.

## Consequences

- VS Code becomes a serious Saturn engineering frontend without forking Saturn.
- Software engineers keep native TypeScript/Git/terminal workflows.
- Equipment vendors publish one Saturn extension package and can appear in every host.
- Controller/server tooling has one provider boundary shared by UI, CLI and CI.
- Project Git remains data/configuration; trusted executable tooling remains installed application code.
