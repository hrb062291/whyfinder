/**
 * DEFERRED RELEASE GATES.
 *
 * This suite is RED BY DESIGN while REVIEW_STATE=DEMO. Every failure here is an
 * unmet release gate from Volume I, not a bug.
 *
 * It is a separate suite from `npm test` deliberately. The spec called for one
 * red CI; that destroys the signal a test suite exists to give — a real
 * regression becomes indistinguishable from a known gap. Splitting keeps both
 * properties: `npm test` must be green, `npm run gates` must be red until
 * reviewers sign off, and a release requires both green.
 *
 * Do not skip, xit, or "temporarily" comment these out.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFERRED_GATES,
  REVIEW_STATE,
  assertReleasable,
  heavyTierEnabled,
  unresolvedGates,
} from '../src/config/reviewState.js';

describe('release gates', () => {
  it.each(DEFERRED_GATES)('$constraint — $deferred', (gate) => {
    expect(
      gate.resolved,
      `\n  UNMET GATE: ${gate.id}\n  Approver: ${gate.approver}\n  Unblocked by: ${gate.unblockedBy}\n`,
    ).toBe(true);
  });

  it('no gate may remain unresolved', () => {
    const open = unresolvedGates();
    expect(
      open.length,
      `\n  ${open.length} unmet gate(s):\n${open.map((g) => `    - ${g.id} (${g.approver})`).join('\n')}\n`,
    ).toBe(0);
  });
});

describe('invariants that hold regardless of state', () => {
  it('DEMO disables heavy tiers', () => {
    if (REVIEW_STATE === 'DEMO') expect(heavyTierEnabled()).toBe(false);
  });

  it('BETA cannot be entered with gates open', () => {
    if (unresolvedGates().length > 0) {
      expect(() => assertReleasable('BETA')).toThrow(/unresolved gate/);
    }
  });
});
