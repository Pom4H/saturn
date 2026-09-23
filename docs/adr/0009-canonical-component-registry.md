# ADR 0009: One component registry; examples outside the library

Status: implemented candidate; validate against exact-tree release evidence.

## Decision

ComponentDefinition owns identity, version, signals, commands, parameters, canonical ports, visual identity and optional schematic authoring metadata. ComponentRegistry is the only installation store. A schematic anchor references a canonical port; its role and direction are derived, not declared again. Authored SVG anchor positions are retained because a schematic is not a literal photograph of 3D geometry.

The source compiler, completions, inspector, configuration identity and 2D/3D consumers read a derived, frozen ComponentProjection. This projection is not another installed model. Installed metadata cannot be mutated through it. The former catalog, Definition, PortSpec, registerComponent function, filter re-registration and src/next compatibility re-exports are removed.

Native 2D definitions (including generated plant/PLC terminals) use the pure defineSchematicElement constructor and register the returned ComponentDefinition. The public @saturn/core Project DSL remains the authoring source of truth. Scene is a renderer projection of it; ModelSpec describes runtime behavior, not a duplicate visual catalog.

Quality/Alarm are shared observation types. Sample contracts retain their deliberate time/timestamp and value distinctions. No transport client, DOM, runtime behavior or demo solver is imported by the element contract.

## Examples and preview

All bundled project sources live under examples/. The old diagram application and visual lab also live there. Shared renderer styles remain in src/. Generic code in site/plant-project.ts no longer contains the nested starter factory. Build commands and published routes are unchanged.

The illustrative series-circuit solver lives in examples/diagram/simulation.ts. A host may explicitly inject PreviewProvider into a view. Without live observations or an injected provider, a view does not invent a flow value. Runtime frames take precedence over preview.

## Evidence

A fixture captures all pre-migration schematic dimensions, fields, ports, signals, commands and versions. Registry regression tests compare every built-in against that fixture, verify shared identity, immutability, atomic extension registration, source-preserving edits and the example boundary. Existing core, challenge, lab, authoring, consumer, server and browser release checks remain the integration oracle.

The repository-mandated usegit context command returned Unknown command: context during inspection. No work lease or queue state was claimed or modified. Accepted status requires observed results for the final candidate; this document does not claim that result.
