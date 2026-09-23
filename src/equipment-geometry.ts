/** Original Saturn SVG coordinate systems. No renderer imports or runtime behavior. */
export const processSymbolGeometry = {
  tank: { width: 170, height: 230, inlet: { x: 79.5, y: 3 }, outlet: { x: 170, y: 184 } },
  pump: { width: 220, height: 170, inlet: { x: 0, y: 96 }, outlet: { x: 76, y: 0 }, drive: { x: 169.5, y: 40 } },
  valve: { width: 160, height: 164, inlet: { x: 0, y: 102 }, outlet: { x: 160, y: 102 }, command: { x: 80, y: 6 } },
} as const;
export const symbolFootprint = (symbol: { width: number; height: number }) => ({ width: symbol.width, height: symbol.height });
