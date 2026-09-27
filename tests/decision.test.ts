import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, type DecisionProvider } from '../packages/core/decision';

const choices = [
  { id: 'continue', description: 'Keep the current process running' },
  { id: 'wait', description: 'Wait for more user intent' },
  { id: 'replan', description: 'Rebuild the current plan' },
] as const;

test('decision provider selects only from caller-owned action space', async () => {
  const provider: DecisionProvider<{ transcript: string }> = {
    id: 'test-policy',
    async decide(request) {
      return { choice: request.choices[1], confidence: 0.91, provider: this.id };
    },
  };
  const result = await decide(provider, {
    state: { transcript: 'wait, I am still explaining' },
    question: 'What should the harness do?',
    choices,
  });
  assert.equal(result.choice.id, 'wait');
  assert.equal(result.confidence, 0.91);
});

test('decision boundary rejects a provider inventing an unavailable action', async () => {
  const provider: DecisionProvider<unknown> = {
    id: 'bad-policy',
    async decide() {
      return { choice: { id: 'spawn-agent' }, confidence: 0.8 };
    },
  };
  await assert.rejects(
    decide(provider, { state: null, question: 'Next?', choices }),
    /unavailable choice: spawn-agent/,
  );
});

test('decision boundary rejects invalid confidence', async () => {
  const provider: DecisionProvider<unknown> = {
    id: 'bad-confidence',
    async decide(request) {
      return { choice: request.choices[0], confidence: 1.2 };
    },
  };
  await assert.rejects(
    decide(provider, { state: null, question: 'Next?', choices }),
    /between 0 and 1/,
  );
});

test('aborted partial-intent decisions never reach a provider', async () => {
  const controller = new AbortController();
  controller.abort(new Error('stale voice chunk'));
  let called = false;
  const provider: DecisionProvider<unknown> = {
    id: 'test-policy',
    async decide(request) {
      called = true;
      return { choice: request.choices[0], confidence: 1 };
    },
  };
  await assert.rejects(
    decide(provider, { state: null, question: 'Next?', choices, signal: controller.signal }),
    /stale voice chunk/,
  );
  assert.equal(called, false);
});
