# ADR-0007: Elements have canonical spatial geometry and semantic projections

- **Status:** Accepted
- **Date:** 2026-09-21
- **Depends on:** ADR-0001, ADR-0002, ADR-0006
- **Scope:** equipment/device packs, 2D/3D rendering, engineering glyphs, materials, fluids and future visual projections

## Context

Saturn must grow from a small built-in equipment set to many first-party, vendor and private device packs without giving every element an independent SVG, 3D model, icon, port map and state vocabulary that can drift apart.

A physical element has several useful representations, but they answer different questions:

- spatial 3D: what physical object/variant is this and how is it connected?
- SCADA 2D: what is happening in the process, with maximum operational readability?
- engineering glyph: what class of equipment is this?
- PLC/operator HMI: what does the operator need to know or do now?
- catalog/tree: how can the engineer recognize and find the type quickly?

These are not a linear LOD ladder. A PLC HMI must not become more detailed than SCADA merely because it is another projection.

## Decision

### 1. Canonical element contract

Trusted installed code defines an element through one renderer-independent contract:

~~~text
ElementDefinition
├─ semantic type
├─ parameters
├─ signals
├─ canonical 3D ports + normals
├─ visual identity
│  ├─ glyph
│  ├─ category
│  ├─ geometry family
│  ├─ spatial envelope
│  ├─ semantic parts
│  └─ fluid zones
└─ references
~~~

The contract lives under `src/elements/`. The old `src/next/*` experiment is only a compatibility re-export.

### 2. Spatial geometry is canonical for physical topology

Port positions and normals are authored once in metres in the element definition.

SCADA 2D connector anchors are derived from those canonical ports through `deriveSchematicProjection()`. The projection may simplify visual geometry for readability, but it must not invent a contradictory port topology.

A 2D renderer is therefore not a screenshot of 3D and not an independently authored physical model.

### 3. Engineering glyph is semantic identity, not reduced 3D

Every element has a stable glyph ID. Glyphs are used in:

- equipment catalog;
- project/tree navigation;
- search results;
- plugin/device pack discovery;
- compact fallbacks where a semantic icon is useful.

The glyph answers **what class of equipment is this?**. Canonical geometry answers **which physical/vendor variant is this?**.

Several vendor pumps may share `process.pump.centrifugal` while using different geometry families.

Core glyph artwork is Saturn-authored. Official standard symbol libraries may be supplied as separately licensed packs; Saturn Core must not copy restricted ISO/IEC/ISA artwork.

### 4. SCADA 2D is a controlled semantic projection

SCADA 2D may deliberately exaggerate or omit physical detail:

- enlarge small valves/sensors;
- hide bolts and supports;
- preserve uniform pipe readability;
- expose flow inside an opaque physical pipe;
- move labels away from geometry;
- emphasize operational state.

Topology, identities, signal bindings and port roles remain canonical.

### 5. HMI is task-specific

Presentation/HMI projections consume the same semantics and runtime state but choose information for the target and operator task. A 320×240 PLC display normally has lower geometric detail than SCADA and may have higher emphasis on state, alarm and controls.

### 6. Materials and media are shared semantic presets

Element visuals refer to named material/media identities instead of local renderer colors.

Current core presets include industrial metals, painted metal, glass, water, water surface/highlight, stale fluid and pipe shell.

Water uses IOR 1.333 and transmissive/clearcoat physical materials in the 3D renderer. 2D intentionally remains schematic but derives water/surface/stale colors from the same medium/material presets.

A medium is not a decorative color. Future oil/coolant/chemical packs must define an explicit medium identity.

### 7. Device packs are the scaling boundary

`ElementPack` groups stable element definitions. Vendor/private extensions can register their own pack and renderers without adding branches to central compiler or renderer code.

Extension manifests may publish safe discovery metadata such as `type`, `title`, `glyph` and `category`; raw SVG or arbitrary code is not accepted as manifest metadata. Trusted installed entry code owns richer geometry/renderers.

### 8. Visual renderer APIs evolve additively

Existing third-party 3D renderers that consume the original `steel/dark/teal/fluid` material context remain valid. New physical material handles are optional so introducing the design system does not break installed renderers.

## Consequences

### Positive

- one port topology drives 3D and schematic connection points;
- catalog/tree/plugin discovery share one glyph vocabulary;
- device packs can add many variants without duplicating Saturn UI;
- physical fluids/materials become reusable across element classes;
- vendor geometry and standard engineering notation stay separate;
- future renderers can introduce semantic zoom without changing project source.

### Costs

- old hand-authored 2D visuals must gradually migrate to projection helpers;
- a good SCADA projection still needs deliberate simplification rules;
- high-quality fluids need GPU feature fallbacks;
- official standards packs require separate licensing/provenance decisions.

## Invariants

A new core or extension element is integrated only when:

1. it has a stable semantic type;
2. its ports have canonical 3D positions/normals;
3. it has a stable glyph identity;
4. 2D topology does not contradict those ports;
5. runtime state is not encoded only in geometry/color;
6. renderer-specific materials do not become project data;
7. a vendor variant can be replaced without changing the generic engineering identity unless its semantics actually differ.
