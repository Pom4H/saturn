import { compileSaturnPlcPresentation } from './presentation-hmi';
import { renderPresentation, validatePresentation, type Presentation, type PresentationContext, type PresentationTarget } from './presentation';
import type { HmiScreenModel } from './vendor/saturn/src/types';

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
    | { target: 'saturn-plc-320'; bindings: Record<string, string> };

export type PresentationProjection =
    | { target: 'web' | 'report'; html: string }
    | { target: 'saturn-plc-320'; screen: HmiScreenModel };

/**
 * Project one canonical Presentation IR into one concrete target.
 *
 * Web/report keep semantic nodes and resolve observations at render time.
 * The physical Saturn display compiles the same IR to the bounded 320x240
 * screen schema that Firmverse packages into / executes from the controller artifact.
 */
export function projectPresentation(view: Presentation, request: PresentationProjectionRequest): PresentationProjection {
    validatePresentation(view, request.target);
    if (request.target === 'saturn-plc-320') {
        return { target: request.target, screen: compileSaturnPlcPresentation(view, request.bindings) };
    }
    const interactive = request.target === 'web' && request.context.interactive !== false;
    return {
        target: request.target,
        html: renderPresentation(view, { ...request.context, interactive }),
    };
}
