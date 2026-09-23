import { compileSaturnC23Presentation, type SaturnC23PresentationSource } from './presentation-c23';
import { renderPresentation, validatePresentation, type Presentation, type PresentationContext, type PresentationTarget } from './presentation';

/**
 * Presentation is the only authored HMI/report UI model.
 *
 * Targets consume that IR and may reject unsupported semantics. A target adapter
 * must never introduce another project signal namespace or another authored HMI DSL.
 */
export const presentationTargets = {
    web: { width: null, height: null, interactive: true },
    report: { width: null, height: null, interactive: false },
    'saturn-plc-320': { width: 320, height: 240, interactive: true },
} as const satisfies Record<PresentationTarget, {
    width: number | null;
    height: number | null;
    interactive: boolean;
}>;

export type PresentationProjectionRequest =
    | { target: 'web' | 'report'; context: PresentationContext }
    | { target: 'saturn-plc-320' };

export type PresentationProjection =
    | { target: 'web' | 'report'; html: string }
    | { target: 'saturn-plc-320'; c23: SaturnC23PresentationSource };

/**
 * Project one canonical Presentation IR into one concrete target.
 *
 * Web/report keep semantic nodes and resolve observations at render time.
 * The physical Saturn display compiles the same IR to deterministic C23 source.
 * A target toolchain links that generated source to libsatstd/satgui; FBD screen
 * records are intentionally not part of the rich-HMI target.
 */
export function projectPresentation(
    view: Presentation,
    request: Extract<PresentationProjectionRequest, { target: 'web' | 'report' }>,
): Extract<PresentationProjection, { target: 'web' | 'report' }>;
export function projectPresentation(
    view: Presentation,
    request: Extract<PresentationProjectionRequest, { target: 'saturn-plc-320' }>,
): Extract<PresentationProjection, { target: 'saturn-plc-320' }>;
export function projectPresentation(view: Presentation, request: PresentationProjectionRequest): PresentationProjection {
    validatePresentation(view, request.target);
    if (request.target === 'saturn-plc-320') {
        return { target: request.target, c23: compileSaturnC23Presentation(view) };
    }
    const interactive = request.target === 'web' && request.context.interactive !== false;
    return {
        target: request.target,
        html: renderPresentation(view, { ...request.context, interactive }),
    };
}
