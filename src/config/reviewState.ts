/**
 * REVIEW_STATE — shipping a demo without reviewers.
 *
 * Reviewers gate content WhyFinder AUTHORED. Where an existing authority can be
 * borrowed, the gate closes without a person. Where it cannot, the surface is
 * turned off rather than shipped unreviewed.
 */

import type { ReviewState } from '../types/index.js';

export const REVIEW_STATE: ReviewState =
  (process.env.WHYFINDER_REVIEW_STATE as ReviewState) ?? 'DEMO';

/** Hard expiry. Past this the build refuses to serve. */
export const DEMO_EXPIRY = new Date('2026-10-09T23:59:59Z');

/** Retention past expiry before tester data is deleted (§3). */
export const RETENTION_DAYS_PAST_EXPIRY = 30;

export function isExpired(now: Date = new Date()): boolean {
  return REVIEW_STATE === 'DEMO' && now > DEMO_EXPIRY;
}

/**
 * Called at the top of every request path. DEMO past its date does not
 * degrade — it stops, and says why.
 */
export function assertServable(now: Date = new Date()): void {
  if (isExpired(now)) {
    throw new Error(
      'WhyFinder DEMO expired on 2026-10-09. This build is an unreviewed prototype ' +
        'and will not serve past its expiry. Fill the reviewer roles and move to BETA, ' +
        'or shut it down.',
    );
  }
}

/** Heavy tiers are disabled in DEMO — the largest pastoral dependency. */
export function heavyTierEnabled(): boolean {
  return REVIEW_STATE !== 'DEMO';
}

/** E3 is scored but not gated in DEMO: no reviewer has set a bar. */
export function e3Gated(): boolean {
  return REVIEW_STATE !== 'DEMO';
}

// ---------------------------------------------------------------- register

export interface DeferredGate {
  id: string;
  constraint: string;
  deferred: string;
  approver: 'clinician' | 'pastoral' | 'ray';
  unblockedBy: string;
  resolved: boolean;
}

/**
 * Every unmet release gate. Rendered in-app on the disclosure screen, and
 * asserted by the `gates` suite, which stays red until these resolve.
 */
export const DEFERRED_GATES: DeferredGate[] = [
  {
    id: 'c06-acute-signal',
    constraint: 'C-06',
    deferred: 'Acute-signal response is PROVISIONAL — inferred from Q02/Q03, not chosen.',
    approver: 'clinician',
    unblockedBy: 'Clinician confirms the four musts and three must-nots.',
    resolved: false,
  },
  {
    id: 'c06-crisis-copy',
    constraint: 'C-06 / C-05',
    deferred: 'Crisis copy is borrowed verbatim from 988/Crisis Text Line/SAMHSA, not authored.',
    approver: 'clinician',
    unblockedBy: 'Clinician approves authored copy, or confirms borrowed copy is sufficient.',
    resolved: false,
  },
  {
    id: 'c23-heavy-rows',
    constraint: 'C-23',
    deferred: 'The 10 heavy-tier questions are unwritten and unreviewed. Disabled in DEMO.',
    approver: 'pastoral',
    unblockedBy: 'Pastoral reviewer signs off on every heavy question.',
    resolved: false,
  },
  {
    id: 'c29-accuracy-bar',
    constraint: 'C-29',
    deferred: 'E3 label-accuracy bar is unset. Scored, not gated.',
    approver: 'pastoral',
    unblockedBy: 'Pastoral reviewer sets the bar.',
    resolved: false,
  },
  {
    id: 'c29-source-line-reading',
    constraint: 'C-29',
    deferred: 'The "source line IS the label" reading is unconfirmed. If rejected, every unit carries a visible badge and P-17 loses.',
    approver: 'pastoral',
    unblockedBy: 'Pastoral reviewer accepts or rejects the reading.',
    resolved: false,
  },
  {
    id: 'c31-creed-and-nonpositions',
    constraint: 'C-31',
    deferred: 'Apostles\' Creed basis and the 3-item published non-positions list are unreviewed.',
    approver: 'pastoral',
    unblockedBy: 'Pastoral reviewer signs off.',
    resolved: false,
  },
  {
    id: 'c32-canon',
    constraint: 'C-32',
    deferred: 'Canon entries unapproved. Referral category cut from DEMO entirely.',
    approver: 'pastoral',
    unblockedBy: 'Pastoral reviewer approves faith entries; clinician approves any mental-health referral.',
    resolved: false,
  },
  {
    id: 'c21-gloo-terms',
    constraint: 'C-21',
    deferred: 'No written confirmation that Gloo does not train on user content. Gloo adapter unused.',
    approver: 'ray',
    unblockedBy: 'Gloo confirms data-handling terms in writing.',
    resolved: false,
  },
  {
    id: 'c33-copy-audit',
    constraint: 'C-33 (proposed)',
    deferred: 'Divine-intent copy-audit constraint proposed, not yet accepted. Patterns enforced pre-emptively.',
    approver: 'ray',
    unblockedBy: 'Ray accepts or rejects C-33.',
    resolved: false,
  },
  {
    id: 'swap-test-semantic',
    constraint: 'GATE (hardened prompt)',
    deferred: 'Swap test is mechanical (noun-presence), not semantic. A generic reflection naming a shared noun survives it.',
    approver: 'ray',
    unblockedBy: 'LLM judge in the swap path, after the conversation engine exists.',
    resolved: false,
  },
];

export function unresolvedGates(): DeferredGate[] {
  return DEFERRED_GATES.filter((g) => !g.resolved);
}

/** Flipping to BETA with any gate unresolved must fail the build. */
export function assertReleasable(state: ReviewState = REVIEW_STATE): void {
  if (state === 'DEMO') return;
  const open = unresolvedGates();
  if (open.length) {
    throw new Error(
      `Cannot run as ${state} with ${open.length} unresolved gate(s): ` +
        open.map((g) => g.id).join(', '),
    );
  }
}
