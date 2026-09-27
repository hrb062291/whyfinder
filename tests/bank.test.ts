/**
 * Guards on the question bank itself.
 *
 * The bank is content, and content drifts in ways code does not. Someone adds
 * a reasonable-sounding question at 1am fifteen days before a hackathon and
 * the tier gate quietly stops meaning anything. These are the checks that
 * would catch that.
 */

import { describe, expect, it } from 'vitest';
import {
  HEAVY_CATEGORIES, LIGHT_CATEGORIES, MEDIUM_CATEGORIES, QUESTIONS, HEAVY_QUESTIONS,
} from '../src/content/questions.js';

const light = QUESTIONS.filter((q) => q.tier === 'light');
const medium = QUESTIONS.filter((q) => q.tier === 'medium');

describe('shape', () => {
  it('hits the §5 target of 30 light and 20 medium', () => {
    expect(light).toHaveLength(30);
    expect(medium).toHaveLength(20);
    expect(QUESTIONS).toHaveLength(50);
  });

  it('holds no heavy questions — those are a pastoral gate', () => {
    expect(QUESTIONS.filter((q) => q.tier === 'heavy')).toEqual([]);
    expect(HEAVY_QUESTIONS).toEqual([]);
  });

  it('every question sits in a declared category for its tier', () => {
    for (const q of light) expect(LIGHT_CATEGORIES).toContain(q.category);
    for (const q of medium) expect(MEDIUM_CATEGORIES).toContain(q.category);
  });

  it('no heavy category leaks into a lighter tier', () => {
    for (const q of QUESTIONS) expect(HEAVY_CATEGORIES).not.toContain(q.category);
  });

  it('ids are unique', () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every light category can satisfy the heavy gate on its own breadth', () => {
    // The heavy gate needs 3+ distinct categories. With 7 light categories,
    // a normal conversation reaches it without deliberate navigation.
    expect(LIGHT_CATEGORIES.length).toBeGreaterThanOrEqual(3);
    for (const c of LIGHT_CATEGORIES) {
      expect(light.filter((q) => q.category === c).length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('P-01 — the framework stays invisible', () => {
  it('never says "purpose"', () => {
    for (const q of QUESTIONS) expect(q.text).not.toMatch(/\bpurpose\b/i);
  });

  it('never names a six-stage label or the product', () => {
    for (const q of QUESTIONS) {
      // Stage labels are uppercase tokens; matching them case-insensitively
      // also catches the ordinary word "know", which is fine in a question.
      expect(q.text).not.toMatch(/\b(KNOW|UNDERSTAND|RENEW)\b/);
      expect(q.text).not.toMatch(/\b(WhyFinder|your why)\b/i);
    }
  });
});

describe('P-13 — behaviour, not rehearsed opinion', () => {
  const OPINION_SHAPES = [
    /biggest challenge/i,
    /what do you think (?:is|are) your/i,
    /in your opinion/i,
    /how would you describe yourself/i,
    /what are you passionate about/i,
    /\bwhat motivates you\b/i,
  ];

  it.each(QUESTIONS)('$id avoids rehearsed-answer shapes', (q) => {
    for (const re of OPINION_SHAPES) expect(q.text).not.toMatch(re);
  });

  it.each(QUESTIONS)('$id is not a thought experiment', (q) => {
    // The precise P-13 concern is not tense — "what do people come to you for"
    // is habitual and perfectly behavioural. It is the CONDITIONAL: "if you
    // could…", "imagine…", "in a perfect world…" all invite the answer the
    // person has already rehearsed about themselves rather than one drawn from
    // something that happened.
    expect(q.text).not.toMatch(/\bif you could\b/i);
    expect(q.text).not.toMatch(/\bimagine\b/i);
    expect(q.text).not.toMatch(/\bin a perfect world\b/i);
    expect(q.text).not.toMatch(/\bif money (?:were|was) no\b/i);
    expect(q.text).not.toMatch(/\bdream (?:job|life|scenario)\b/i);
  });

  it('a good share of the bank points at a specific occasion', () => {
    const occasion = QUESTIONS.filter((q) =>
      /\b(did|last|when|tell me about|walk me through|have you)\b/i.test(q.text));
    expect(occasion.length).toBeGreaterThanOrEqual(20);
  });
});

describe('answerability', () => {
  it('no question is so long it reads as a paragraph', () => {
    for (const q of QUESTIONS) {
      // The constraint disclosure questions carry a sentence of framing, which
      // C-26 justifies; nothing else should.
      const cap = q.category === 'constraint' ? 32 : 24;
      expect(q.text.split(/\s+/).length, `${q.id}: ${q.text}`).toBeLessThanOrEqual(cap);
    }
  });

  it('no two questions open with the same seven words', () => {
    const openings = QUESTIONS.map((q) =>
      q.text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).slice(0, 7).join(' '));
    const dupes = openings.filter((o, i) => openings.indexOf(o) !== i);
    expect(dupes).toEqual([]);
  });

  it('constraint questions are ask-once (C-26)', () => {
    const constraint = QUESTIONS.filter((q) => q.category === 'constraint');
    expect(constraint.length).toBeGreaterThan(0);
    for (const q of constraint) {
      expect(q.askOnce).toBe(true);
      expect(q.retireOnAnswer).toBe(true);
    }
  });

  it('nothing outside the constraint category is ask-once', () => {
    for (const q of QUESTIONS.filter((x) => x.category !== 'constraint')) {
      expect(q.askOnce).toBeUndefined();
    }
  });
});

describe('tier placement', () => {
  it('faith is split — practice is light, distance is medium', () => {
    expect(light.some((q) => q.category === 'faith_practice')).toBe(true);
    expect(medium.some((q) => q.category === 'faith_distance')).toBe(true);
    expect(light.some((q) => q.category === 'faith_distance')).toBe(false);
  });

  it('no light question asks about loss, grief, regret or fear', () => {
    // Those belong to the heavy rows, which are gated. A light question that
    // strays there defeats C-23 without tripping any state-machine test.
    const heavyWords = /\b(died|death|grief|grieving|funeral|regret|afraid|fear|abuse|loss)\b/i;
    for (const q of light) expect(q.text, `${q.id}: ${q.text}`).not.toMatch(heavyWords);
  });
});
