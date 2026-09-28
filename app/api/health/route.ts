/**
 * Diagnostics. Answers one question: is this thing actually running live, or
 * quietly serving fixtures?
 *
 * The silent fallback is right for a demo — the app must not die on stage —
 * but it makes a broken model call indistinguishable from a working one. Every
 * symptom is identical: HTTP 200, a plausible synthesis, no errors. This is the
 * page that tells the difference.
 *
 * It exposes NO user content: whether a key is configured (never the key), the
 * model id, and why recent model calls failed. C-03 and C-19 are untouched.
 *
 * DEMO only. Remove or authenticate before BETA — the failure reasons are
 * harmless but they are still internals on a public URL.
 */

import { NextResponse } from 'next/server';
import { DEFAULT_MODEL, REQUEST_TIMEOUT_MS, WORKSPACE_ID } from '../../../src/providers/index.js';
import { recentFallbacks } from '../../../src/observability/fallbackLog.js';
import { REVIEW_STATE, DEMO_EXPIRY, isExpired, unresolvedGates } from '../../../src/config/reviewState.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY;

  return NextResponse.json({
    reviewState: REVIEW_STATE,
    expiresAt: DEMO_EXPIRY.toISOString(),
    expired: isExpired(),
    openGates: unresolvedGates().length,

    model: {
      configured: Boolean(key),
      // Shape only. Enough to spot a truncated paste or a stray quote.
      keyLooksValid: Boolean(key && key.startsWith('sk-ant-') && key.length > 40),
      keyLength: key ? key.length : 0,
      id: DEFAULT_MODEL,
      timeoutMs: REQUEST_TIMEOUT_MS,
      // Required for an organization-scoped key, ignored by a workspace-scoped
      // one. Empty here plus a 400 about workspaces means this is the problem.
      workspaceId: WORKSPACE_ID || null,
    },

    /**
     * Empty with a key configured means live generation is working. Anything
     * here means the app is serving fixtures while looking healthy.
     */
    recentFallbacks: recentFallbacks(),
  });
}
