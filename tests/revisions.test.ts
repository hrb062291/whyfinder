/**
 * The two revisions: asymmetric retirement, and informed repair with an
 * anti-dilution guard.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFLECTION_COOLDOWN_MS, emptyState, eligibleQuestions, inCooldown, recordAnswer,
} from '../src/constraints/questionGate.js';
import { QUESTIONS } from '../src/content/questions.js';
import {
  buildRepairGuidance, endSession, isDilution, newSession, takeTurn, NO_OP,
} from '../src/engine/session.js';
import { fixtureProvider } from '../src/providers/index.js';
import { filterSynthesis } from '../src/constraints/filter.js';
import type { FilterContext, Synthesis } from '../src/types/index.js';

const T0 = new Date('2026-10-01T12:00:00Z');
const co1 = QUESTIONS.find((q) => q.id === 'co1')!;
const th1 = QUESTIONS.find((q) => q.id === 'th1')!;
const heavy = { id: 'h1', tier: 'heavy' as const, category: 'pain', text: '?', retireOnAnswer: true };

// ============================================================ retirement

describe('retirement — light and medium', () => {
  it('a deflected constraint question cools down instead of burning', () => {
    let s = emptyState('u');
    s = recordAnswer(s, co1, 'skip', T0);
    expect(s.retiredQuestionIds).not.toContain('co1');
    expect(inCooldown(s, 'co1', T0)).toBe(true);
  });

  it('P-11 survives a deflection — the question returns after the cooldown', () => {
    let s = emptyState('u');
    s = recordAnswer(s, co1, 'skip', T0);
    const later = new Date(T0.getTime() + DEFLECTION_COOLDOWN_MS + 1000);
    expect(inCooldown(s, 'co1', later)).toBe(false);
  });

  it('a second deflection retires it for good', () => {
    let s = emptyState('u');
    s = recordAnswer(s, co1, 'skip', T0);
    const later = new Date(T0.getTime() + DEFLECTION_COOLDOWN_MS + 1000);
    s = recordAnswer(s, co1, 'nope', later);
    expect(s.retiredQuestionIds).toContain('co1');
  });

  it('answering for real after a deflection clears the record and retires ask-once', () => {
    let s = emptyState('u');
    s = recordAnswer(s, co1, 'skip', T0);
    const later = new Date(T0.getTime() + DEFLECTION_COOLDOWN_MS + 1000);
    s = recordAnswer(s, co1, 'Most evenings are taken up caring for my father at the moment.', later);
    expect(s.deflections.find((d) => d.questionId === 'co1')).toBeUndefined();
    expect(s.retiredQuestionIds).toContain('co1');
  });

  it('a cooled-down question is not offered meanwhile', () => {
    let s = emptyState('u');
    for (const id of ['dt1', 'wr1', 'en1']) {
      s = recordAnswer(s, QUESTIONS.find((q) => q.id === id)!, 'I did a real thing that took a while.', T0);
    }
    s = recordAnswer(s, th1, 'skip', T0);
    expect(eligibleQuestions(s, T0).some((q) => q.id === 'th1')).toBe(false);
    const later = new Date(T0.getTime() + DEFLECTION_COOLDOWN_MS + 1000);
    expect(eligibleQuestions(s, later).some((q) => q.id === 'th1')).toBe(true);
  });

  it('a bad first session does not burn a quarter of the bank', () => {
    let s = emptyState('u');
    const eight = QUESTIONS.slice(0, 8);
    for (const q of eight) s = recordAnswer(s, q, 'skip', T0);
    expect(s.retiredQuestionIds).toEqual([]);
    const later = new Date(T0.getTime() + DEFLECTION_COOLDOWN_MS + 1000);
    for (const q of eight) expect(eligibleQuestions(s, later).some((x) => x.id === q.id)).toBe(true);
  });
});

describe('retirement — heavy is asymmetric', () => {
  it('retires on serve even when deflected: the asking was the cost', () => {
    let s = emptyState('u');
    s = recordAnswer(s, heavy, 'skip', T0);
    expect(s.retiredQuestionIds).toContain('h1');
    expect(s.deflections).toEqual([]);
  });
});

// ============================================================ repair

describe('informed repair', () => {
  const ctx: FilterContext = {
    entriesById: { e1: 'I rewired the shed on Saturday.', e2: 'People ask me about the billing system.' },
    userSuppliedLabels: [], thirdPartyNames: [], reviewState: 'DEMO',
  };

  function synth(over: Partial<Synthesis>): Synthesis {
    return {
      id: 's', userId: 'u', sessionId: 'x', body: '', evidence: ['e1', 'e2'],
      concreteNouns: ['shed', 'billing system'], kind: 'ai_inference', status: 'offered',
      derivedFrom: [], affordances: { accept: true, reject: true, edit: true }, ...over,
    };
  }

  it('guidance names the rule', () => {
    const v = filterSynthesis(synth({ body: 'You are a natural teacher.' }), ctx);
    const g = buildRepairGuidance(v);
    expect(g).toMatch(/C-09/);
    expect(g).toMatch(/identity predicate/i);
  });

  it('guidance NEVER leaks the matched string — that teaches evasion', () => {
    const v = filterSynthesis(synth({ body: 'You are a natural teacher.' }), ctx);
    expect(v.violations.some((x) => x.match === 'You are a')).toBe(true);
    expect(buildRepairGuidance(v)).not.toMatch(/You are a/);
  });

  it('guidance tells the model not to weaken the observation', () => {
    const v = filterSynthesis(synth({ body: 'You are a natural teacher.' }), ctx);
    expect(buildRepairGuidance(v)).toMatch(/without weakening|same evidence|same concrete/i);
  });

  it('the second attempt receives the guidance', async () => {
    const seen: string[] = [];
    const provider = {
      name: 'fixture' as const,
      async complete(_m: unknown, system: string) {
        seen.push(system);
        return JSON.stringify({
          body: 'You are a builder.', evidence: ['e1', 'e2'], concreteNouns: ['shed'], kind: 'ai_inference',
        });
      },
    };
    let s = newSession('u', 'x');
    let r = await takeTurn(s, 'I rewired the shed on Saturday and lost track of time.', { provider, systemPrompt: 'BASE' });
    r = await takeTurn(r.state, 'People at work ask me about the billing system a lot.', { provider, systemPrompt: 'BASE' });
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[seen.length - 1]).toMatch(/previous candidate was rejected/i);
  });
});

describe('anti-dilution', () => {
  const base = {
    id: 's', userId: 'u', sessionId: 'x', kind: 'ai_inference' as const,
    status: 'offered' as const, derivedFrom: [],
    affordances: { accept: true, reject: true, edit: true },
  };

  it('flags a repair citing fewer entries', () => {
    expect(isDilution(
      { ...base, body: 'a', evidence: ['e1'], concreteNouns: ['shed', 'billing system'] },
      { ...base, body: 'b', evidence: ['e1', 'e2'], concreteNouns: ['shed', 'billing system'] },
    )).toBe(true);
  });

  it('flags a repair that dropped concrete nouns', () => {
    expect(isDilution(
      { ...base, body: 'a', evidence: ['e1', 'e2'], concreteNouns: ['shed'] },
      { ...base, body: 'b', evidence: ['e1', 'e2'], concreteNouns: ['shed', 'billing system'] },
    )).toBe(true);
  });

  it('permits a genuine repair that keeps its grounding', () => {
    expect(isDilution(
      { ...base, body: 'a', evidence: ['e1', 'e2'], concreteNouns: ['shed', 'billing system'] },
      { ...base, body: 'b', evidence: ['e1', 'e2'], concreteNouns: ['shed', 'billing system'] },
    )).toBe(false);
  });

  it('a diluted repair is suppressed rather than shown', async () => {
    const blocked = JSON.stringify({
      body: 'You are a natural teacher, going by the shed and the billing system.',
      evidence: ['e1', 'e2'], concreteNouns: ['shed', 'billing system'], kind: 'ai_inference',
    });
    // Passes the filter, but rests on less. A retreat, not a repair.
    const vague = JSON.stringify({
      body: 'Something about the shed might matter. Worth exploring?',
      evidence: ['e1', 'e2'], concreteNouns: ['shed'], kind: 'ai_inference',
    });
    let s = newSession('u', 'x');
    const deps = { provider: fixtureProvider([blocked, vague]), systemPrompt: 'BASE' };
    let r = await takeTurn(s, 'I rewired the shed on Saturday and lost track of time.', deps);
    r = await takeTurn(r.state, 'People at work ask me about the billing system a lot.', deps);
    expect(r.state.synthesesOffered).toEqual([]);
    expect(r.state.suppressionLog.some((l) =>
      l.verdict.violations.some((v) => v.constraint === 'DILUTION'))).toBe(true);
  });
});

// ============================================================ P-04

describe('P-04 — the no-op fires at session end', () => {
  it('a session where everything was blocked says so', () => {
    const s = newSession('u', 'x');
    expect(endSession(s)).toEqual({ kind: 'noop', text: NO_OP });
  });

  it('a session that produced something does not', () => {
    const s = newSession('u', 'x');
    s.synthesesOffered.push({} as Synthesis);
    expect(endSession(s).kind).toBe('summary');
  });

  it('the summary does not inflate what happened', () => {
    const s = newSession('u', 'x');
    s.synthesesOffered.push({} as Synthesis);
    expect(endSession(s).text).not.toMatch(/great session|breakthrough|really noticing/i);
  });
});
