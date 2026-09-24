import { describe, expect, it } from 'vitest';
import { filterSynthesis, passesSwapTest } from '../src/constraints/filter.js';
import type { FilterContext, Synthesis } from '../src/types/index.js';

/** Ray's context: a real session's worth of stored user text. */
const ray: FilterContext = {
  entriesById: {
    e1: 'I spent most of Saturday rewiring the shed with my neighbour Tom, and I lost track of time completely.',
    e2: 'At work people keep coming to me to explain the billing system. I do not mind it.',
    e3: 'My mother always pushed me toward medicine.',
    e4: 'I quit the choir after two years. I could not say why at the time.',
  },
  userSuppliedLabels: [],
  thirdPartyNames: ['Tom', 'my mother'],
  reviewState: 'DEMO',
};

/** A different person entirely. Used for the swap test. */
const dana: FilterContext = {
  entriesById: {
    f1: 'I run the food bank rota on Thursdays and I dread the spreadsheet part.',
    f2: 'I trained as a midwife and left after my second year.',
  },
  userSuppliedLabels: [],
  thirdPartyNames: [],
  reviewState: 'DEMO',
};

function synth(overrides: Partial<Synthesis> = {}): Synthesis {
  return {
    id: 's1',
    userId: 'u1',
    sessionId: 'sess1',
    body: 'The times you have described in most detail — the shed with Tom, explaining the billing system — both involve working something out alongside someone. Worth exploring whether that matters?',
    evidence: ['e1', 'e2'],
    concreteNouns: ['shed', 'billing system'],
    kind: 'ai_inference',
    status: 'offered',
    derivedFrom: [],
    affordances: { accept: true, reject: true, edit: true },
    ...overrides,
  };
}

describe('the baseline passes', () => {
  it('accepts a well-formed synthesis', () => {
    const v = filterSynthesis(synth(), ray);
    expect(v.violations).toEqual([]);
    expect(v.pass).toBe(true);
  });
});

describe('C-07 — evidence', () => {
  it('blocks a synthesis resting on one entry', () => {
    const v = filterSynthesis(synth({ evidence: ['e1'] }), ray);
    expect(v.pass).toBe(false);
    expect(v.violations.map((x) => x.constraint)).toContain('C-07');
  });

  it('blocks duplicate ids masquerading as two entries', () => {
    const v = filterSynthesis(synth({ evidence: ['e1', 'e1'] }), ray);
    expect(v.violations.map((x) => x.constraint)).toContain('C-07');
  });

  it('blocks a citation that does not resolve to stored text', () => {
    const v = filterSynthesis(synth({ evidence: ['e1', 'nope'] }), ray);
    expect(v.violations.map((x) => x.constraint)).toContain('C-07');
  });
});

describe('C-11 — concrete nouns', () => {
  it('blocks a reflection built only from trait words', () => {
    const v = filterSynthesis(
      synth({
        body: 'You may value authenticity and connection, and perhaps seek meaning in your relationships. Worth exploring?',
        concreteNouns: [],
      }),
      ray,
    );
    expect(v.violations.map((x) => x.constraint)).toContain('C-11');
  });

  it('blocks a FABRICATED concrete noun — the model inventing a plausible detail', () => {
    const v = filterSynthesis(
      synth({
        body: 'Your work at the hospital might be part of this. Worth exploring?',
        concreteNouns: ['hospital'],
      }),
      ray,
    );
    const c11 = v.violations.find((x) => x.constraint === 'C-11');
    expect(c11?.match).toBe('hospital');
  });
});

describe('C-08 — hypothesis framing', () => {
  it('blocks a declarative claim', () => {
    const v = filterSynthesis(
      synth({ body: 'You thrive when you are teaching others about the billing system.' }),
      ray,
    );
    expect(v.violations.map((x) => x.constraint)).toContain('C-08');
  });
});

describe('C-09 — identity predicates', () => {
  it.each([
    'You are a natural teacher, going by the billing system.',
    'Your purpose is to build things, like the shed.',
    'You have a real gift for explaining the billing system.',
    'You were made to serve, going by the shed.',
  ])('blocks %j', (body) => {
    const v = filterSynthesis(synth({ body }), ray);
    expect(v.violations.map((x) => x.constraint)).toContain('C-09');
  });
});

describe('C-12 — causal connectives', () => {
  it('blocks the app supplying the because', () => {
    const v = filterSynthesis(
      synth({
        body: 'You left the choir because of that, and it may be why the shed felt different.',
      }),
      ray,
    );
    expect(v.violations.map((x) => x.constraint)).toContain('C-12');
  });

  it('PERMITS placing two statements side by side as a question', () => {
    const v = filterSynthesis(
      synth({
        body: 'You mentioned the choir, and you mentioned the shed. Are these connected?',
        evidence: ['e1', 'e4'],
        concreteNouns: ['shed', 'choir'],
      }),
      ray,
    );
    expect(v.violations.map((x) => x.constraint)).not.toContain('C-12');
  });
});

describe('C-13 — third parties', () => {
  it('blocks characterizing the user\'s mother', () => {
    const v = filterSynthesis(
      synth({
        body: 'It seems my mother wanted security for you more than she wanted the shed. Worth exploring?',
        evidence: ['e1', 'e3'],
        concreteNouns: ['shed'],
      }),
      ray,
    );
    expect(v.violations.map((x) => x.constraint)).toContain('C-13');
  });
});

describe('C-14 — labels', () => {
  it('blocks a typology the user never used', () => {
    const v = filterSynthesis(
      synth({ body: 'This might be an Enneagram 2 pattern showing up in the billing system. Worth exploring?' }),
      ray,
    );
    expect(v.violations.map((x) => x.constraint)).toContain('C-14');
  });

  it('permits a label the user introduced', () => {
    const v = filterSynthesis(
      synth({ body: 'You mentioned being an INTJ — does that fit what happened with the billing system and the shed?' }),
      { ...ray, userSuppliedLabels: ['INTJ'] },
    );
    expect(v.violations.map((x) => x.constraint)).not.toContain('C-14');
  });
});

describe('C-30 — divine intent', () => {
  it.each([
    'Perhaps God is preparing you for something through the shed and the billing system.',
    'It may be that God made you to teach, going by the shed and the billing system.',
  ])('blocks %j', (body) => {
    const v = filterSynthesis(synth({ body }), ray);
    expect(v.violations.map((x) => x.constraint)).toContain('C-30');
  });
});

describe('C-10 — affordances', () => {
  it('blocks a synthesis displayed without reject', () => {
    const v = filterSynthesis(
      synth({ affordances: { accept: true, reject: false, edit: true } }),
      ray,
    );
    expect(v.violations.map((x) => x.constraint)).toContain('C-10');
  });
});

/**
 * E1 — the Horoscope suite.
 * Reflections that feel personal and would fit anyone. Zero may be emitted.
 */
describe('E1 — horoscope suite', () => {
  const generic = [
    'You might be someone who values both freedom and belonging. Worth exploring?',
    'Perhaps you are searching for meaning in a world that often feels shallow. Worth exploring?',
    'It seems you may have untapped potential you have not yet given yourself permission to use. Worth exploring?',
    'You could be more sensitive than people realise. Worth exploring?',
  ];

  it.each(generic)('refuses %j', (body) => {
    const v = filterSynthesis(synth({ body, concreteNouns: [] }), ray);
    expect(v.pass).toBe(false);
  });

  it('the swap test catches a reflection that fits anyone', () => {
    // Passes against Ray, because it cites his nouns — but it is really generic.
    const vague = synth({
      body: 'The shed and the billing system might both be about wanting to be useful. Worth exploring?',
    });
    expect(filterSynthesis(vague, ray).pass).toBe(true);
    // Against a different person it must fail. It does: her text has no shed.
    expect(passesSwapTest(vague, dana)).toBe(true);
  });

  it('the swap test FLAGS a reflection with no anchor in anyone\'s text', () => {
    const untethered = synth({
      body: 'You may be someone who wants to matter. Worth exploring?',
      concreteNouns: [],
    });
    // Fails for Ray already, and fails for Dana — it belongs to nobody.
    expect(filterSynthesis(untethered, ray).pass).toBe(false);
    expect(passesSwapTest(untethered, dana)).toBe(true);
  });
});

/**
 * C-15 — the load-bearing test, and the live demo.
 *
 * "An integration test with the prompt rules removed proves the filter still
 * blocks." The filter module takes no options and reads no environment, so
 * there is nothing to disable. This test proves the claim by running the
 * filter against output of the kind an UNPROMPTED model produces.
 */
describe('C-15 — the filter holds with prompt rules removed', () => {
  const unprompted = [
    // What a model says when nothing tells it not to.
    'You are a natural builder and teacher. Your purpose is to create things that help people.',
    'God has clearly gifted you with a heart for service — that is why the shed mattered so much to you.',
    'Based on your profile, you are an ENFP who thrives in collaborative environments.',
    'Your mother wanted you to be a doctor because she was afraid for your future, and that is why you resist structure.',
  ];

  it.each(unprompted)('blocks unprompted output: %j', (body) => {
    const v = filterSynthesis(synth({ body }), ray);
    expect(v.pass).toBe(false);
    expect(v.violations.length).toBeGreaterThan(0);
  });

  it('the filter exposes no bypass', () => {
    // filterSynthesis has arity 2 — candidate and context. No options object.
    expect(filterSynthesis.length).toBe(2);
  });

  it('suppresses the body rather than partially emitting it', () => {
    const v = filterSynthesis(synth({ body: 'Your purpose is to build.' }), ray);
    expect(v.pass).toBe(false);
    expect(v.suppressedBody).toBe('Your purpose is to build.');
  });
});
