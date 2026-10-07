/**
 * Gloo AI, behind an explicit switch that is OFF.
 *
 * C-21 (no training on user content, including by subprocessors) is not yet
 * confirmed by Gloo in writing. The professor owns that decision. This adapter
 * therefore refuses to run unless BOTH are set:
 *
 *   GLOO_API_KEY=<key from Gloo AI Studio>
 *   GLOO_C21_CONFIRMED=yes     (set only after deferred gate c21-gloo-terms is resolved)
 *
 * The original glooProvider in index.ts still throws and is left alone.
 *
 * Endpoint: POST https://platform.ai.gloo.com/ai/v2/guarded/chat/completions
 *   Authorization: Bearer <key>
 *   body: messages plus exactly one of auto_routing | model | model_family.
 */

import type { ModelProvider } from '../types/index.js';
import { REQUEST_TIMEOUT_MS } from './index.js';

export const GLOO_URL = 'https://platform.ai.gloo.com/ai/v2/guarded/chat/completions';

export interface GlooEnv {
  GLOO_API_KEY?: string;
  GLOO_C21_CONFIRMED?: string;
  GLOO_MODEL?: string;
  GLOO_TRADITION?: string;
}

/** True only with a key AND the explicit written-terms confirmation. */
export function glooEnabled(env: GlooEnv | Record<string, string | undefined>): boolean {
  return Boolean(env.GLOO_API_KEY) && env.GLOO_C21_CONFIRMED === 'yes';
}

export function glooGuardedProvider(
  apiKey: string,
  opts: { model?: string; tradition?: string; fetchImpl?: typeof fetch } = {},
): ModelProvider {
  return {
    name: 'gloo',
    async complete(messages, system) {
      const doFetch = opts.fetchImpl ?? fetch;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await doFetch(GLOO_URL, {
          method: 'POST',
          signal: ac.signal,
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            messages: [{ role: 'system', content: system }, ...messages],
            ...(opts.model ? { model: opts.model } : { auto_routing: true }),
            ...(opts.tradition ? { tradition: opts.tradition } : {}),
            max_tokens: 1024,
          }),
        });
        if (!res.ok) throw new Error(`Gloo ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const out = json.choices?.[0]?.message?.content;
        if (typeof out !== 'string' || !out.trim()) throw new Error('Gloo returned no content');
        return out;
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new Error(`Gloo timed out after ${REQUEST_TIMEOUT_MS}ms`);
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Try once more before giving up. Visible retry, then the caller falls back. */
export function withRetry(p: ModelProvider, onRetry?: (error: string) => void): ModelProvider {
  return {
    name: p.name,
    async complete(messages, system) {
      try {
        return await p.complete(messages, system);
      } catch (e) {
        onRetry?.(e instanceof Error ? e.message : String(e));
        return p.complete(messages, system);
      }
    },
  };
}