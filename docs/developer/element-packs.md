# Project-owned equipment and registry items

Saturn extends the engineering domain primarily by adding ordinary typed source to the project. The registry is a distribution convenience, not an extension runtime.

## Add an item

~~~sh
saturn registry list
saturn add pump --project ./pump-station
~~~

For example, the built-in pump item copies a project-owned factory similar to:

~~~ts
import { simulation, type Layout } from '@saturn/core'

export function pump<const ID extends string>(
  id: ID,
  system: string,
  at: Layout,
) {
  return simulation(id, 'pump', { system, at })
}
~~~

After `saturn add`, the source is yours. Edit it, type-check it, test it and commit it. There is no activation lifecycle or hidden uninstall state.

## When to use a package

Use a normal package dependency when the code intentionally has an independent lifecycle shared by many projects. Package resolution happens at a trusted engineering/build boundary; runtime consumes the validated BuildArtifact and does not execute project TypeScript.

Offline PWA projects should remain self-contained: built-ins plus copied registry source.

## Canonical element semantics

Equipment definitions must preserve one semantic identity across projections:

- stable equipment type/ID;
- typed parameters and signals with units;
- canonical ports and topology;
- engineering glyph;
- optional spatial geometry/material identity;
- explicit stale/offline/quality behavior.

2D, 3D, HMI and PLC projections consume those semantics rather than creating their own equipment model.

For trusted renderer/domain infrastructure inside Saturn itself, use the canonical element APIs under `@saturn/core/elements`. Project registry items should normally build on the public project DSL from `@saturn/core`.

## Registry item contract

A registry item declares:

~~~ts
interface RegistryItem {
  name: string
  title: string
  kind: 'equipment' | 'report' | 'target' | 'template'
  description: string
  tags: readonly string[]
  files: Readonly<Record<string, string>>
  dependencies?: Readonly<Record<string, string>>
}
~~~

`files` are copied into the project. Optional dependencies are merged into the project's `package.json`.

Registry operations refuse to overwrite existing files. That keeps copied source explicit instead of silently mutating project-owned code.

## Review checklist

Before adding equipment or another registry item:

- it extends the canonical project model instead of inventing a parallel schema;
- signals and units are typed;
- ports/topology have stable semantic identities;
- 2D/3D/HMI projections reuse those identities;
- generated files are minimal and project-owned;
- no runtime-only state is written into source;
- external dependencies are used only when an independent shared lifecycle is intentional.

See [ADR-0008](../adr/0008-conventions-first-artifact-runtime.md) for the ownership boundary and [ADR-0007](../adr/0007-element-visual-system.md) for visual semantics.
