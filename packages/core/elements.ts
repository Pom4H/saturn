/**
 * Trusted Saturn element/device-pack authoring API.
 *
 * Deliberately separate from the declarative project DSL exported by @saturn/core.
 */
export {
  ComponentRegistry,
  defineElementPack,
  deriveSchematicProjection,
  type Asset,
  type ComponentDefinition,
  type ElementCategory,
  type ElementPack,
  type ElementVisualIdentity,
  type FluidZoneDefinition,
  type GeometryEnvelope,
  type Parameter,
  type Port,
  type Projection2D,
  type SemanticPart,
  type SemanticPartRole,
} from '../../src/elements/model';

export {
  createGlyphSvg,
  getGlyph,
  listGlyphs,
  registerGlyph,
  type GlyphDefinition,
  type GlyphPrimitive,
} from '../../src/elements/symbols';

export {
  materialCssColor,
  materialPresets,
  mediumCssColor,
  mediumPresets,
  type MaterialPreset,
  type MaterialPresetId,
  type MediumPreset,
} from '../../src/elements/materials';

export {
  coreElementPack,
  registry as coreElementRegistry,
} from '../../src/elements/core-elements';
