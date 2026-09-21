# Element and device packs

Saturn elements separate engineering semantics from their visual projections. Use this API for new equipment instead of adding renderer branches to the Shell.

## Minimal pack

~~~ts
import {
  defineElementPack,
  type ElementDefinition,
} from '@saturn/core'

const pump: ElementDefinition = {
  type: 'acme.pump.mx',
  version: 1,
  label: 'ACME MX pump',
  parameters: {
    scale: { default: 1, min: 0.8, max: 1.2, unit: 'ratio' },
  },
  signals: {
    rpm: { unit: 'rpm', meaning: 'Measured drive speed' },
    flow: { unit: 'm3/h', meaning: 'Measured process flow' },
  },
  ports: p => [
    { id: 'IN', position: [-0.9 * p.scale, 0, 0.6], normal: [-1, 0, 0], medium: 'water', role: 'in' },
    { id: 'OUT', position: [0.6 * p.scale, 0, 0.8], normal: [1, 0, 0], medium: 'water', role: 'out' },
  ],
  references: [],
  visual: {
    glyph: 'process.pump.centrifugal',
    category: 'process',
    geometry: 'acme.pump.mx',
    envelope: { min: [-1, -0.5, 0], max: [0.8, 0.5, 1.4] },
    materials: ['steel', 'paintedIndustrial'],
    fluids: [{ id: 'process-flow', medium: 'water', role: 'flow', signal: 'flow' }],
  },
}

export default defineElementPack({
  id: '@acme/equipment',
  version: '1.0.0',
  title: 'ACME equipment',
  elements: [pump],
})
~~~

This code is trusted installed application code. It is not valid project DSL and must never be executed from an uploaded project.

## Glyphs

Prefer an existing generic engineering glyph when a vendor model has the same engineering meaning:

~~~ts
visual: {
  glyph: 'process.pump.centrifugal',
  geometry: 'acme.pump.mx',
  // ...
}
~~~

Only register a new glyph when the semantic class is genuinely new.

~~~ts
import { registerGlyph } from '@saturn/core'

registerGlyph({
  id: 'factory.special-separator',
  label: 'Special separator',
  primitives: [
    { kind: 'rect', x: 6, y: 3, width: 12, height: 18, rx: 5 },
  ],
})
~~~

Do not put raw SVG in the extension manifest. The manifest may advertise a glyph ID for safe catalog discovery; trusted extension code registers custom artwork.

## Deriving schematic ports

Do not manually maintain a second physical port map.

~~~ts
import { deriveSchematicProjection } from '@saturn/core'

const projection = deriveSchematicProjection(pump, {}, {
  width: 180,
  height: 120,
  padding: 12,
})
~~~

The result maps canonical metre-space port positions/normals onto 2D boundary anchors. A custom SCADA drawing may simplify the pump body, but it should use these connectors.

## Materials and fluids

Use the shared semantic identities:

~~~ts
import { materialPresets, mediumPresets } from '@saturn/core'

materialPresets.paintedIndustrial
mediumPresets.water
~~~

Do not copy the current RGB values into device packs. Renderers are free to improve shading while the material identity stays stable.

Water is currently the first core medium. New media should define their physical and schematic identity explicitly rather than reusing water with a different color.

## Custom 3D renderer

The existing trusted renderer hook remains supported. New material handles are additive: a renderer only needs the original `steel`, `dark`, `teal` and `fluid` handles, while newer hosts may additionally provide physical water/surface/shell handles.

The project compiler does not import or execute this renderer. Composition roots load installed visual packages.

## Extension manifest discovery

An extension with the `elements` capability may expose safe catalog metadata:

~~~json
{
  "saturn": {
    "api": 1,
    "entry": "dist/index.js",
    "capabilities": ["elements"],
    "elements": [
      {
        "type": "acme.pump.mx",
        "title": "ACME MX pump",
        "tag": "acme-pump",
        "glyph": "process.pump.centrifugal",
        "category": "process"
      }
    ]
  }
}
~~~

This is discovery metadata, not the complete element definition.

## Review checklist

Before adding a new element:

- canonical ports/normals are defined in metres;
- generic engineering identity/glyph is chosen;
- vendor geometry is not confused with the glyph;
- SCADA 2D topology derives from canonical ports;
- operational state is represented semantically, not only by color;
- fluid zones name a medium;
- quality/stale/offline have an explicit behavior;
- HMI keeps only task-relevant information;
- renderer code is trusted installed code, not project source.
