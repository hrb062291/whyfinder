/**
 * Server-side record of every time the live model failed and the fixture took
 * over.
 *
 * The danger with a silent fallback is not noticing you have been running
 * degraded all afternoon. This is what makes it noticeable.
 *
 * It holds no user content — only when a call failed and why — so C-03 and C-19
 * are untouched. There is nothing here a staff member could read a conversation
 * from.
 */

import type { FallbackRecord } from '../providers/index.js';

const MAX = 50;
const log: FallbackRecord[] = [];

export function recordFallback(r: FallbackRecord): void {
  log.push(r);
  if (log.length > MAX) log.shift();
  console.warn(`[whyfinder] model fallback: ${r.provider} — ${r.error}`);
}

export function recentFallbacks(): FallbackRecord[] {
  return [...log];
}

export function fallbackCount(): number {
  return log.length;
}
