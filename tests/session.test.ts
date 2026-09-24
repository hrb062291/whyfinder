import { describe, expect, it } from 'vitest';
import {
  FIRST_RUN_DISCLOSURE, MAX_SYNTHESES_PER_SESSION, NO_OP, OPENING,
  begin, crisisAffordance, newSession, parseCandidate, takeTurn,
} from '../src/engine/session.js';
import { fixtureProvider, glooProvider } from '../src/providers/index.js';

const SYS = 'constraint prompt';
const REAL_1 = 'I spent most of Saturday rewiring the shed with my neighbour Tom and lost track of time.';
const REAL_2 = 'At work people keep coming to me to explain the billing system, and I do not mind it.';

const GOOD = JSON.stringify({
  body: 'Both the shed and the billing system involve working something out alongside someone. Worth exploring whether that matters?',
  evidence: ['e1', 'e2'],
  concreteNouns: ['shed', 'billing system'],
  kind: 'ai_inference',
});

const BAD = JSON.stringify({
  body: 'You are a natural teacher. Your purpose is to explain things to people.',
  evidence: ['e1', 'e2'],
  concreteNouns: ['shed'],
  kind: 'ai_inference',
});

function deps(responses: string[]) {
  return { provider: fixtureProvider(responses), systemPrompt: SYS, thirdPartyNames: ['Tom'] };
}

describe('C-22 — first run', () => {
  it('states both disclosures before any substantive question', () => {
    const { output } = begin(newSession('u', 's'));
    expect(output.kind).toBe('disclosure');
    if (output.kind !== 'disclosure') return;
    expect(output.text).toMatch(/not a therapist, pastor or licensed counselor/i);
    expect(output.text).toMatch(/training on anything you write here is off/i);
    expect(output.then).toBe(OPENING);
  });

  it('discloses no human review, because C-03 means there is none', () => {
    expect(FIRST_RUN_DISCLOSURE).not.toMatch(/human review|our team|reviewed by/i);
  });

  it('P-01 — the opening avoids the word purpose', () => {
    expect(OPENING).not.toMatch(/\bpurpose\b/i);
  });
});

describe('C-05 — crisis affordance', () => {
  it('is present and carries reachable resources', () => {
    const a = crisisAffordance();
    expect(a.resources.length).toBeGreaterThan(0);
    expect(a.resources[0].contact).toMatch(/988/);
  });
});

describe('C-06 — acute signal stops the exercise', () => {
  it('fires before any synthesis is generated', async () => {
    let s = newSession('u', 's');
    const r = await takeTurn(s, 'I have been thinking about killing myself.', deps([GOOD]));
    expect(r.output.kind).toBe('acute');
    expect(r.state.synthesesOffered).toEqual([]);
    expect(r.state.acuteFired).toBe(true);
  });

  it('does not fire on lament (E2)', async () => {
    const s = newSession('u', 's');
    const r = await takeTurn(s, "I don't know how to go on without her. She died in March.", deps([GOOD]));
    expect(r.output.kind).not.toBe('acute');
  });

  it('C-04 — nothing locks; the session remains usable afterwards', async () => {
    let s = newSession('u', 's');
    let r = await takeTurn(s, 'I want to die.', deps([GOOD]));
    expect(r.output.kind).toBe('acute');
    // Next turn still works. Nothing stopped.
    r = await takeTurn(r.state, REAL_1, deps([GOOD]));
    expect(r.output.kind).toBe('question');
  });
});

describe('the synthesis cap', () => {
  it('is enforced in code at 3 per session', async () => {
    let s = newSession('u', 's');
    let r = await takeTurn(s, REAL_1, deps([GOOD]));
    for (let i = 0; i < 8; i += 1) {
      r = await takeTurn(r.state, `${REAL_2} Also something else happened, number ${i}.`, deps([GOOD]));
    }
    expect(r.state.synthesesOffered.length).toBeLessThanOrEqual(MAX_SYNTHESES_PER_SESSION);
    expect(r.state.synthesesOffered.length).toBe(MAX_SYNTHESES_PER_SESSION);
  });

  it('offers none before two entries exist (C-07)', async () => {
    const s = newSession('u', 's');
    const r = await takeTurn(s, REAL_1, deps([GOOD]));
    expect(r.state.synthesesOffered).toEqual([]);
  });
});

describe('the filter sits between the model and the user', () => {
  it('blocks a violating candidate and logs the suppression', async () => {
    let s = newSession('u', 's');
    let r = await takeTurn(s, REAL_1, deps([BAD, BAD]));
    r = await takeTurn(r.state, REAL_2, deps([BAD, BAD]));
    expect(r.state.synthesesOffered).toEqual([]);
    expect(r.state.suppressionLog.length).toBeGreaterThan(0);
    const fired = r.state.suppressionLog[0].verdict.violations.map((v) => v.constraint);
    expect(fired).toContain('C-09');
  });

  it('never pads — a blocked synthesis produces no softer replacement', async () => {
    let s = newSession('u', 's');
    let r = await takeTurn(s, REAL_1, deps([BAD, BAD]));
    r = await takeTurn(r.state, REAL_2, deps([BAD, BAD]));
    expect(r.state.synthesesOffered.length).toBe(0);
  });

  it('lets a well-formed candidate through', async () => {
    let s = newSession('u', 's');
    let r = await takeTurn(s, REAL_1, deps([GOOD]));
    r = await takeTurn(r.state, REAL_2, deps([GOOD]));
    expect(r.state.synthesesOffered.length).toBe(1);
  });

  it('discards malformed model output rather than letting prose bypass structure', () => {
    const s = newSession('u', 's');
    expect(parseCandidate('I think you are a builder.', s)).toBeNull();
    expect(parseCandidate('{not json', s)).toBeNull();
  });
});

describe('P-04 — the honest no-op', () => {
  it('reads as a designed state, not an error', () => {
    expect(NO_OP).not.toMatch(/error|unavailable|failed|try again/i);
    expect(NO_OP).not.toMatch(/great session|really noticing|breakthrough/i);
  });
});

describe('C-21 — Gloo is wired but refuses to run', () => {
  it('throws rather than sending content to an unconfirmed subprocessor', async () => {
    const p = glooProvider('key', 'https://example.invalid');
    await expect(p.complete([], '')).rejects.toThrow(/C-21/);
  });
});
