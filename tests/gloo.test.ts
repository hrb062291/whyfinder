import { describe, expect, it } from 'vitest';
import { glooEnabled, glooGuardedProvider, withRetry } from '../src/providers/gloo.js';
import { glooProvider, withFallback, fixtureProvider } from '../src/providers/index.js';

describe('gloo switch', () => {
  it('is off by default and off with only a key', () => {
    expect(glooEnabled({})).toBe(false);
    expect(glooEnabled({ GLOO_API_KEY: 'k' })).toBe(false);
    expect(glooEnabled({ GLOO_API_KEY: 'k', GLOO_C21_CONFIRMED: 'yes' })).toBe(true);
  });
  it('the original adapter still refuses (C-21)', async () => {
    await expect(glooProvider('k', 'u').complete([], 's')).rejects.toThrow(/C-21/);
  });
});

describe('gloo adapter', () => {
  const ok = (calls: { url: string; body: any; auth: string }[]) => (async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) } as Response;
  }) as unknown as typeof fetch;
  it('sends bearer auth and exactly one routing field', async () => {
    const calls: { url: string; body: any; auth: string }[] = [];
    const out = await glooGuardedProvider('K', { fetchImpl: ok(calls), tradition: 'evangelical' }).complete([{ role: 'user', content: 'x' }], 'sys');
    expect(out).toBe('hi');
    expect(calls[0].auth).toBe('Bearer K');
    expect(calls[0].body.auto_routing).toBe(true);
    expect(calls[0].body.model).toBeUndefined();
    expect(calls[0].body.tradition).toBe('evangelical');
  });
  it('retries once, then falls back and records it', async () => {
    let n = 0;
    const bad = (async () => { n++; return { ok: false, status: 500, text: async () => 'boom' } as Response; }) as unknown as typeof fetch;
    const recs: string[] = [];
    const chain = withFallback(withRetry(glooGuardedProvider('K', { fetchImpl: bad })), fixtureProvider(['backup']), (r) => recs.push(r.provider));
    expect(await chain.complete([], 's')).toBe('backup');
    expect(n).toBe(2);
    expect(chain.lastMode()).toBe('fallback');
    expect(recs).toEqual(['gloo']);
  });
});