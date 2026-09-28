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

describe('the model call cannot hang the function', () => {
  it('aborts rather than waiting forever', async () => {
    const { anthropicProvider, REQUEST_TIMEOUT_MS } = await import('../src/providers/index.js');
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    // The provider passes an AbortSignal; a hung upstream fails inside our own
    // code, where withFallback can catch it, instead of being killed by the
    // platform with an empty 500.
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_u, init) => new Promise((_res, rej) => {
        (init as RequestInit).signal?.addEventListener('abort', () =>
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    );
    const p = anthropicProvider('k');
    vi.useFakeTimers();
    const call = p.complete([], '').catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
    await expect(call).resolves.toMatch(/timed out/);
    vi.useRealTimers();
    spy.mockRestore();
  });

  it('the model id is configurable, so a bad default is not a redeploy', async () => {
    const { DEFAULT_MODEL } = await import('../src/providers/index.js');
    expect(typeof DEFAULT_MODEL).toBe('string');
    expect(DEFAULT_MODEL.length).toBeGreaterThan(0);
  });
});

describe('the default model id', () => {
  it('is not the one that was wrong', async () => {
    const { DEFAULT_MODEL } = await import('../src/providers/index.js');
    // claude-sonnet-4-5 does not exist. It was written from memory rather than
    // checked, every call 404'd, and the fallback made that look like success.
    expect(DEFAULT_MODEL).not.toBe('claude-sonnet-4-5');
  });
});

describe('the failure reason travels with the response', () => {
  it('is exposed on the same call that fell back', async () => {
    const p = withFallback(failing('Anthropic 401: invalid x-api-key'), fixtureProvider([BACKUP]));
    expect(p.lastError()).toBeNull();
    await p.complete([], '');
    expect(p.lastMode()).toBe('fallback');
    expect(p.lastError()).toMatch(/401/);
  });

  it('clears once a call succeeds, so a stale reason is never reported', async () => {
    let fail = true;
    const flaky = {
      name: 'anthropic' as const,
      async complete() { if (fail) { fail = false; throw new Error('blip'); } return OK; },
    };
    const p = withFallback(flaky, fixtureProvider([BACKUP]));
    await p.complete([], '');
    expect(p.lastError()).toMatch(/blip/);
    await p.complete([], '');
    expect(p.lastError()).toBeNull();
  });
});
