# Git, workspaces and deployment

Saturn projects are normal directories. Git is ordinary engineering source control; it is not the runtime transport or a Saturn project database.

## Project layout

```text
pump-station/
├── package.json
├── src/
│   └── plant.ts
├── targets/
├── tests/
└── .gitignore
```

Create and validate a project with the same product API used by the IDE:

```sh
saturn new pump-station
cd pump-station
git init -b main
git add .
git commit -m "Initial Saturn project"
saturn check .
saturn open .
```

There is no `scada.project.json`. `package.json` supplies package/project identity and dependencies; `src/plant.ts` is the conventional engineering entrypoint.

## Source history and deployment are different boundaries

```text
working directory
      │
      ├── Git SHA
      │
      ▼
  saturn build
      │
      ▼
BuildArtifact (sha256:...)
      │
      ├── published
      ▼
    applied
      │
      ▼
   runtime
```

A build artifact contains validated Saturn IR, referenced assets and provenance (source SHA when available, dependency/lock identity and per-file hashes). Runtime stores and applies artifacts by content hash. It does not need a Git checkout, TypeScript compiler or package manager to operate an already-built installation.

The UI therefore shows four different facts when available:

- **Source** — Git commit in the engineering workspace.
- **Build** — immutable content-addressed artifact.
- **Published** — artifact selected for a target.
- **Applied** — artifact currently running.

They must not be collapsed into one “revision”.

## Workspace host

The standalone IDE may expose its opened folder to the browser shell as a workspace service. Saving edits writes ordinary files. Git commits, branches, merges and pushes remain normal Git operations performed by the engineer, VS Code, CLI or CI.

The workspace service is intentionally separate from the plant runtime API. A runtime-only installation does not expose project source.

## Deployment

A trusted engineering host builds then deploys:

```sh
saturn check .
# target/deploy CLI evolves around the same BuildArtifact contract
```

A GitOps workflow can watch a branch, build and send the resulting artifact to a runtime. That workflow is external deployment tooling; the runtime itself does not poll/fetch Git branches.

Rollback normally means reverting/choosing source in Git, rebuilding and deploying. A runtime may re-apply a previously retained approved artifact for recovery, but it records that exact artifact/source provenance instead of manufacturing a Git commit.

## Browser/PWA

Local PWA projects live as files in OPFS. Editor buffers are not project storage. Runtime history/checkpoints use a separate SQLite database.

The PWA does not implement npm resolution. A self-contained project using Saturn built-ins and copied registry items can build offline. Projects with external package dependencies are built by a capable native/server workspace host.

## Safety properties

- Source code executes only at the trusted build boundary.
- Runtime consumes validated serializable IR/artifacts.
- Deployment uses compare-and-swap on the published artifact identity.
- A failed candidate leaves the last-good applied artifact running.
- Checkpoints pin the immutable build artifact, not a duplicate Project JSON blob.
- Operator command authority does not imply source-control write authority.
