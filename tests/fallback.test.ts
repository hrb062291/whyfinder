import { describe, expect, it, vi } from 'vitest';
import { fixtureProvider, withFallback } from '../src/providers/index.js';
import type { ModelProvider } from '../src/types/index.js';

const OK = JSON.stringify({ body: 'fine', evidence: ['e1', 'e2'], concreteNouns: ['shed'], kind: 'ai_inference' });
const BACKUP = JSON.stringify({ body: 'backup', evidence: ['e1', 'e2'], concreteNouns: ['shed'], kind: 'ai_inference' });

function failing(msg = 'rate limited'): ModelProvider {
  return { name: 'anthropic', async complete() { throw new Error(msg); } };
}
function working(): ModelProvider {
  return { name: 'anthropic', async complete() { return OK; } };
}

describe('silent fallback', () => {
  it('uses the primary when it works', async () => {
    const p = withFallback(working(), fixtureProvider([BACKUP]));
    expect(await p.complete([], '')).toBe(OK);
    expect(p.lastMode()).toBe('primary');
  });

  it('falls back rather than throwing — the demo does not die on stage', async () => {
    const p = withFallback(failing(), fixtureProvider([BACKUP]));
    expect(await p.complete([], '')).toBe(BACKUP);
    expect(p.lastMode()).toBe('fallback');
  });

  it('records every fallback so degraded mode is noticed', async () => {
    const seen: { provider: string; error: string }[] = [];
    const p = withFallback(failing('529 overloaded'), fixtureProvider([BACKUP]), (r) => seen.push(r));
    await p.complete([], '');
    expect(seen).toHaveLength(1);
    expect(seen[0].provider).toBe('anthropic');
    expect(seen[0].error).toMatch(/529/);
  });

  it('reports mode per call, not once per session', async () => {
    let fail = true;
    const flaky: ModelProvider = {
      name: 'anthropic',
      async complete() { if (fail) { fail = false; throw new Error('blip'); } return OK; },
    };
    const p = withFallback(flaky, fixtureProvider([BACKUP]));
    await p.complete([], '');
    expect(p.lastMode()).toBe('fallback');
    await p.complete([], '');
    expect(p.lastMode()).toBe('primary');
  });

  it('a fallback response is still filtered — the wrapper weakens nothing', async () => {
    // The wrapper returns raw text either way. Nothing here touches the filter,
    // which is the point: both paths go through it downstream.
    const p = withFallback(failing(), fixtureProvider(['not json at all']));
    expect(await p.complete([], '')).toBe('not json at all');
  });
});

describe('C-01 is recorded as a knowing exception', () => {
  it('appears in the deferred-gate register rather than silently not existing', async () => {
    const { DEFERRED_GATES } = await import('../src/config/reviewState.js');
    const gate = DEFERRED_GATES.find((g) => g.id === 'c01-age-assurance');
    expect(gate).toBeDefined();
    expect(gate!.resolved).toBe(false);
    expect(gate!.deferred).toMatch(/KNOWING EXCEPTION/);
  });
});
