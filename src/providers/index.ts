/**
 * Model providers.
 *
 * This is the ONLY module that names a vendor. Every constraint is enforced
 * outside it, downstream, so swapping Gloo for Claude cannot weaken a rule —
 * and so the demo can flip providers mid-session and show the filter behaving
 * identically.
 *
 * C-21: training on user content requires explicit opt-in, default off,
 * enforced per user, INCLUDING any subprocessor. Gloo has not confirmed its
 * terms in writing (deferred gate c21-gloo-terms), so the Gloo adapter exists
 * and is not used.
 */

import type { ModelProvider } from '../types/index.js';

/**
 * Try `primary`; on any failure fall back to `backup`.
 *
 * The demo must never die in front of a judge because of a rate limit. The
 * danger with a silent fallback is not noticing you are running degraded, so
 * every fallback is recorded and the mode is readable afterwards.
 *
 * This wrapper does NOT weaken any constraint: whatever comes back, from
 * either provider, goes through the same filter.
 */
export interface FallbackRecord {
  at: string;
  provider: string;
  error: string;
}

export function withFallback(
  primary: ModelProvider,
  backup: ModelProvider,
  onFallback?: (r: FallbackRecord) => void,
): ModelProvider & { lastMode: () => 'primary' | 'fallback' | 'unused' } {
  let mode: 'primary' | 'fallback' | 'unused' = 'unused';
  return {
    name: primary.name,
    lastMode: () => mode,
    async complete(messages, system) {
      try {
        const out = await primary.complete(messages, system);
        mode = 'primary';
        return out;
      } catch (e) {
        mode = 'fallback';
        onFallback?.({
          at: new Date().toISOString(),
          provider: primary.name,
          error: e instanceof Error ? e.message : String(e),
        });
        return backup.complete(messages, system);
      }
    },
  };
}

/** Recorded generations. The demo's default, and the test default. */
export function fixtureProvider(responses: string[]): ModelProvider {
  let i = 0;
  return {
    name: 'fixture',
    async complete() {
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return r;
    },
  };
}

/**
 * Model id is configurable. Hard-coding one means a deprecated or misspelled id
 * takes the app down and can only be fixed by a deploy.
 */
export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';

/**
 * Fail fast rather than hang.
 *
 * A serverless function that waits on a slow upstream call gets killed by the
 * platform, and a killed function returns an empty 500 — the fallback never
 * runs, because nothing is left alive to run it. Timing out here means the
 * request fails inside our own code, where withFallback can catch it.
 */
export const REQUEST_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 20_000);

export function anthropicProvider(apiKey: string, model = DEFAULT_MODEL): ModelProvider {
  return {
    name: 'anthropic',
    async complete(messages, system) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: ac.signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({ model, max_tokens: 1024, system, messages }),
        });
        if (!res.ok) {
          // Body may name the model or the rate limit. It never contains the key.
          throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
        }
        const json = (await res.json()) as { content: { type: string; text?: string }[] };
        return json.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new Error(`Anthropic timed out after ${REQUEST_TIMEOUT_MS}ms`);
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * UNUSED until C-21 is satisfied. Calling this throws rather than silently
 * sending user content to a subprocessor whose training terms are unconfirmed.
 */
export function glooProvider(_apiKey: string, _baseUrl: string): ModelProvider {
  return {
    name: 'gloo',
    async complete() {
      throw new Error(
        'C-21: Gloo has not confirmed in writing that it does not train on user content. ' +
          'Resolve deferred gate c21-gloo-terms before enabling this provider.',
      );
    },
  };
}
