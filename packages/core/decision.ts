export type DecisionChoice<Id extends string = string, Meta = unknown> = Readonly<{
  id: Id;
  description?: string;
  meta?: Meta;
}>;

export type DecisionRequest<State, Choice extends DecisionChoice> = Readonly<{
  state: State;
  question: string;
  choices: readonly Choice[];
  signal?: AbortSignal;
  context?: Readonly<Record<string, unknown>>;
}>;

export type DecisionScore<Choice extends DecisionChoice> = Readonly<{
  choice: Choice;
  probability: number;
}>;

export type DecisionResult<Choice extends DecisionChoice> = Readonly<{
  choice: Choice;
  confidence: number;
  scores?: readonly DecisionScore<Choice>[];
  latencyMs?: number;
  provider?: string;
}>;

/**
 * Probabilistic policy boundary for Saturn's deterministic runtime.
 *
 * Providers may use Jev, another decision model, heuristics, or local code.
 * They can only select from choices supplied by the caller; the harness owns
 * which actions exist and whether a selected action is allowed to commit.
 */
export interface DecisionProvider<State = unknown> {
  readonly id: string;
  decide<const Choice extends DecisionChoice>(
    request: DecisionRequest<State, Choice>,
  ): Promise<DecisionResult<Choice>>;
}

export function assertDecisionResult<Choice extends DecisionChoice>(
  request: DecisionRequest<unknown, Choice>,
  result: DecisionResult<Choice>,
): DecisionResult<Choice> {
  if (request.signal?.aborted) throw request.signal.reason ?? new DOMException('Aborted', 'AbortError');
  if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) {
    throw new RangeError('Decision confidence must be between 0 and 1');
  }
  const choice = request.choices.find(({ id }) => id === result.choice.id);
  if (!choice) throw new Error(`Decision provider returned unavailable choice: ${result.choice.id}`);
  return { ...result, choice };
}

export async function decide<State, const Choice extends DecisionChoice>(
  provider: DecisionProvider<State>,
  request: DecisionRequest<State, Choice>,
): Promise<DecisionResult<Choice>> {
  if (request.choices.length === 0) throw new Error('Decision requires at least one choice');
  if (request.signal?.aborted) throw request.signal.reason ?? new DOMException('Aborted', 'AbortError');
  return assertDecisionResult(request, await provider.decide(request));
}
