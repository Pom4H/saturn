export interface MaterialPreset {
  id: string;
  color: number;
  metalness: number;
  roughness: number;
  opacity?: number;
  transmission?: number;
  thickness?: number;
  ior?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  depthWrite?: boolean;
}
export interface MediumPreset {
  id: string;
  label: string;
  material: string;
  ior: number;
  tint: number;
  clarity: number;
}
export const materialPresets = {
  steel: { id:'steel',color:0xbac9d0,metalness:.58,roughness:.28 },
  lightSteel: { id:'lightSteel',color:0xe1e9e9,metalness:.42,roughness:.25 },
  darkMetal: { id:'darkMetal',color:0x284655,metalness:.46,roughness:.36 },
  paintedIndustrial: { id:'paintedIndustrial',color:0x167c88,metalness:.18,roughness:.24,clearcoat:.48,clearcoatRoughness:.19 },
  copper: { id:'copper',color:0xc78342,metalness:.72,roughness:.26 },
  warning: { id:'warning',color:0xe9ac43,metalness:.22,roughness:.28 },
  glass: { id:'glass',color:0xc7e4eb,metalness:0,roughness:.06,transmission:.88,thickness:.08,ior:1.45,opacity:.42,depthWrite:false },
  water: { id:'water',color:0x4ebed8,metalness:0,roughness:.055,transmission:.72,thickness:.18,ior:1.333,clearcoat:.85,clearcoatRoughness:.055,opacity:.78,depthWrite:false },
  waterSurface: { id:'waterSurface',color:0x8ee4ef,metalness:0,roughness:.035,transmission:.58,thickness:.06,ior:1.333,clearcoat:1,clearcoatRoughness:.025,opacity:.72,depthWrite:false },
  waterHighlight: { id:'waterHighlight',color:0xc8f7fb,metalness:0,roughness:.08,transmission:.25,thickness:.03,ior:1.333,opacity:.8,depthWrite:false },
  staleFluid: { id:'staleFluid',color:0x819199,metalness:0,roughness:.48,opacity:.44,transmission:.12,thickness:.1,ior:1.333,depthWrite:false },
  pipeShell: { id:'pipeShell',color:0xb9c9ce,metalness:.38,roughness:.16,opacity:.28,transmission:.26,thickness:.06,ior:1.46,clearcoat:.4,clearcoatRoughness:.12,depthWrite:false },
} as const satisfies Record<string, MaterialPreset>;
export type MaterialPresetId = keyof typeof materialPresets;
export const mediumPresets = {
  water: { id:'water',label:'Water',material:'water',ior:1.333,tint:0x4ebed8,clarity:.88 },
} as const satisfies Record<string, MediumPreset>;
