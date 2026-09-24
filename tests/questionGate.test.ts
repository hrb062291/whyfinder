import { describe, expect, it } from 'vitest';
import {
  emptyState, eligibleQuestions, heavyAllowedNow, isSubstantive, nextQuestion,
  recordAnswer, recordServed, tierUnlocked, HEAVY_WINDOW_MS,
} from '../src/constraints/questionGate.js';
import { QUESTIONS } from '../src/content/questions.js';
import type { GateState } from '../src/constraints/questionGate.js';

const REAL = 'I spent most of Saturday rewiring the shed with my neighbour Tom.';

function answer(state: GateState, id: string, text = REAL): GateState {
  const q = QUESTIONS.find((x) => x.id === id)!;
  return recordAnswer(state, q, text);
}

describe('the bank itself', () => {
  it('never uses the word "purpose" (P-01)', () => {
    for (const q of QUESTIONS) expect(q.text).not.toMatch(/\bpurpose\b/i);
  });

  it('contains no heavy questions — they are a pastoral gate', () => {
    expect(QUESTIONS.filter((q) => q.tier === 'heavy')).toEqual([]);
  });

  it('has unique ids', () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('asks about behaviour, not hypothetical opinion (P-13)', () => {
    // No question should ask what the user *thinks* their biggest challenge is.
    for (const q of QUESTIONS) {
      expect(q.text).not.toMatch(/biggest challenge|what do you think is|in your opinion/i);
    }
  });

  it('constraint questions are ask-once (C-26)', () => {
    for (const q of QUESTIONS.filter((x) => x.category === 'constraint')) {
      expect(q.askOnce).toBe(true);
      expect(q.retireOnAnswer).toBe(true);
    }
  });
});

describe('isSubstantive', () => {
  it.each(['skip', 'idk', 'no idea', "i don't know", 'nope', '-', 'nothing'])(
    'rejects the deflection %j', (t) => expect(isSubstantive(t)).toBe(false),
  );

  it('rejects a one-word reply', () => expect(isSubstantive('Work.')).toBe(false));

  it('accepts a real answer', () => expect(isSubstantive(REAL)).toBe(true));

  it('accepts honest uncertainty that is actually an answer (P-03)', () => {
    expect(
      isSubstantive("I don't know, I've never really thought about it before now."),
    ).toBe(true);
  });
});

describe('C-23 — tier gates', () => {
  it('light is open from the first message', () => {
    expect(tierUnlocked('light', emptyState('u'))).toBe(true);
  });

  it('medium needs 3 substantive answers', () => {
    let s = emptyState('u');
    expect(tierUnlocked('medium', s)).toBe(false);
    s = answer(s, 'dt1'); s = answer(s, 'wr1');
    expect(tierUnlocked('medium', s)).toBe(false);
    s = answer(s, 'en1');
    expect(tierUnlocked('medium', s)).toBe(true);
  });

  it('deflections do not advance the gate', () => {
    let s = emptyState('u');
    for (const id of ['dt1', 'wr1', 'en1']) s = answer(s, id, 'skip');
    expect(tierUnlocked('medium', s)).toBe(false);
  });

  it('heavy is disabled in DEMO regardless of how much the user answered', () => {
    let s = emptyState('u');
    for (const id of ['dt1', 'wr1', 'en1', 'pe1', 'cc1', 'de1']) s = answer(s, id);
    expect(s.substantiveAnswers.length).toBe(6);
    expect(new Set(s.substantiveAnswers.map((a) => a.category)).size).toBe(6);
    // Would otherwise qualify. DEMO says no.
    expect(tierUnlocked('heavy', s)).toBe(false);
  });

  it('a new account is served no heavy question under any path', () => {
    const s = emptyState('new');
    expect(eligibleQuestions(s).some((q) => q.tier === 'heavy')).toBe(false);
  });

  it('breadth counts answers at any tier', () => {
    let s = emptyState('u');
    s = answer(s, 'dt1'); s = answer(s, 'wr1'); s = answer(s, 'en1');
    expect(tierUnlocked('medium', s)).toBe(true);
    // A medium answer now counts toward the heavy breadth requirement too.
    s = answer(s, 'th1');
    expect(s.substantiveAnswers.length).toBe(4);
  });
});

describe('C-24 — rolling dosage window', () => {
  const heavy = { id: 'h1', tier: 'heavy' as const, category: 'pain', text: '?', retireOnAnswer: true };

  it('allows two, then stops', () => {
    let s = emptyState('u');
    const now = new Date('2026-10-01T12:00:00Z');
    expect(heavyAllowedNow(s, now)).toBe(true);
    s = recordServed(s, heavy, now);
    expect(heavyAllowedNow(s, now)).toBe(true);
    s = recordServed(s, heavy, now);
    expect(heavyAllowedNow(s, now)).toBe(false);
  });

  it('closing the tab resets nothing — the window is user-keyed', () => {
    let s = emptyState('u');
    const t0 = new Date('2026-10-01T12:00:00Z');
    s = recordServed(s, heavy, t0);
    s = recordServed(s, heavy, t0);
    // "New session" three hours later. Still blocked.
    const t1 = new Date(t0.getTime() + 3 * 60 * 60 * 1000);
    expect(heavyAllowedNow(s, t1)).toBe(false);
  });

  it('frees up once the window rolls past', () => {
    let s = emptyState('u');
    const t0 = new Date('2026-10-01T12:00:00Z');
    s = recordServed(s, heavy, t0);
    s = recordServed(s, heavy, t0);
    const later = new Date(t0.getTime() + HEAVY_WINDOW_MS + 1000);
    expect(heavyAllowedNow(s, later)).toBe(true);
  });
});

describe('retirement', () => {
  it('a constraint question is never asked twice (C-26)', () => {
    let s = emptyState('u');
    s = answer(s, 'dt1'); s = answer(s, 'wr1'); s = answer(s, 'en1');
    const co1 = QUESTIONS.find((q) => q.id === 'co1')!;
    s = recordAnswer(s, co1, 'Most evenings are taken up with my father at the moment.');
    expect(s.retiredQuestionIds).toContain('co1');
    expect(eligibleQuestions(s).some((q) => q.id === 'co1')).toBe(false);
  });

  it('an answered question is not re-served', () => {
    let s = emptyState('u');
    s = answer(s, 'dt1');
    expect(eligibleQuestions(s).some((q) => q.id === 'dt1')).toBe(false);
  });
});

describe('selection', () => {
  it('prefers a category the user has not been asked about', () => {
    let s = emptyState('u');
    s = answer(s, 'dt1');
    const q = nextQuestion(s)!;
    expect(q.category).not.toBe('daily_texture');
  });

  it('opens on a light question', () => {
    expect(nextQuestion(emptyState('u'))!.tier).toBe('light');
  });

  it('returns null rather than inventing one when the bank is exhausted', () => {
    let s = emptyState('u');
    for (const q of QUESTIONS) s = recordAnswer(s, q, REAL);
    expect(nextQuestion(s)).toBeNull();
  });
});
