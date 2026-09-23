import { el } from '../src/svg';
import { renderProcessSvg } from '../src/equipment-svg';
import type { SvgRendererContext } from '../src/view';
import { terminals } from './ports';

/** Original SVG coordinates: no scale adapter or decorative connector plumbing. */
function nativeSymbol(kind: 'tank' | 'pump' | 'valve', visual: string, c: SvgRendererContext): void {
  renderProcessSvg(kind, c);
  for (const [name, port] of Object.entries(terminals(visual)))
    el(c.root, 'g', { 'data-symbol-port': name, 'data-anchor-x': port.x, 'data-anchor-y': port.y });
}
export const plantPumpSvg = (c: SvgRendererContext): void => nativeSymbol('pump', 'pump', c);
export const plantTankSvg = (c: SvgRendererContext): void => nativeSymbol('tank', 'reservoir', c);
export const plantValveSvg = (c: SvgRendererContext): void => nativeSymbol('valve', 'valve', c);
