# Saturn for VS Code

This directory is a thin VS Code host for the same Saturn project, runtime and extension contracts used by standalone Saturn.

It deliberately does **not** embed a second IDE inside VS Code.

## Surfaces

- **Project** — native `TreeView` for the project entry, diagram, local runtime and HMI.
- **Equipment Catalog** — native `TreeView` built from Saturn Core equipment plus `elements` contributed by installed Saturn extensions.
- **Targets** — native `TreeView` for local runtime, servers, controllers, HMIs and devices.
- **Diagram** — editor-area `WebviewPanel`, opened beside TypeScript source.
- **Status bar** — local runtime state.
- **Integrated terminal** — Saturn CLI processes remain visible and controllable by the engineer.

The normal VS Code TypeScript editor remains the source editor. Git stays in VS Code SCM. Saturn-specific semantic tooling is expected to project the host-independent language service described in `docs/developer/language-tooling.md`.

## Development

Open `vscode/` as an extension-development folder or point an Extension Development Host at this package.

The extension expects `saturn` on PATH by default. Set `saturn.cli.path` when using a standalone binary elsewhere.

Run repository checks with:

```sh
npm run vscode:check
```

## Project targets

A project may describe safe target identity in `.saturn/targets.json`:

```json
{
  "schema": 1,
  "targets": [
    {
      "id": "operator-a",
      "title": "Operator A",
      "kind": "server",
      "provider": "@factory/docker",
      "endpoint": "https://operator.example.test",
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

This file never contains executable shell commands. VS Code only exposes a bounded action name and delegates execution to the Saturn CLI/provider boundary. A future target provider implements `saturn target <action> <id>`; the workspace itself cannot inject a process command.

## Extension catalogs

`saturn extension list --json` is the bridge used by the VS Code host. Existing Saturn extension `elements` become catalog entries automatically, grouped by extension package.

This keeps custom equipment packs installable once through Saturn instead of requiring a separate VS Code extension for every vendor catalog.
