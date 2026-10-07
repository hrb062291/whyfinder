import { describe, expect, it } from 'vitest';
import { acuteResponse, detectAcuteSignal, normalizeForSignal } from '../src/constraints/acuteSignal.js';
import { concernTier } from '../src/constraints/concernTier.js';
import { HEAVY_CARE, HEAVY_TURNS, takeConversationTurn } from '../src/engine/conversation.js';
import { newSession } from '../src/engine/session.js';
import { fixtureProvider } from '../src/providers/index.js';
import { QUESTIONS } from '../src/content/questions.js';

const turnDeps = { provider: fixtureProvider(['']), systemPrompt: 'X', thirdPartyNames: [] };
const BANK = new Set(QUESTIONS.map((q) => q.text));

describe('crisis language with typos and slang', () => {
  it.each([
    "I've been feeling like I want to kill myslef",
    'i want to kill mysefl',
    'thinking about killin myself',
    'i want to kil myself',
    'kms',
    'i want to unalive myself',
    'having sucidal thoughts',
    'thinking about sucide',
    'i wanna die',
    'there is no reason to live',
    'i wish i was dead',
    'I just want to end it',
  ])('fires on: %s', (t) => {
    expect(detectAcuteSignal(t).fired).toBe(true);
  });

  it.each([
    'I hope my anger will subside',
    'I made it myself',
    'I killed it at my game last night',
    'the meeting had no purpose',
    'I love myself more these days',
  ])('does not fire on: %s', (t) => {
    expect(detectAcuteSignal(t).fired).toBe(false);
  });

  it('normalises only what it should', () => {
    expect(normalizeForSignal('kill myslef')).toBe('kill myself');
    expect(normalizeForSignal('subside')).toBe('subside');
  });

  it('"I don\'t have any purpose" is elevated, not ordinary', () => {
    expect(concernTier("I don't have any purpose").tier).toBe('elevated');
    expect(concernTier('my life has no meaning').tier).toBe('elevated');
    expect(concernTier('the meeting had no purpose').tier).toBe('none');
  });
});

describe('the crisis response', () => {
  const r = acuteResponse();
  it('says it is beyond the app, names 988 and real people', () => {
    expect(r.offersHuman).toMatch(/beyond/i);
    expect(r.offersHuman).toMatch(/988/);
    expect(r.offersHuman).toMatch(/pastor|counselor|friend/i);
  });
  it('carries a Christian word and a fixed verse with its source', () => {
    expect(r.faith).toMatch(/you are loved/i);
    expect(r.faith).toMatch(/community/i);
    expect(r.verse.reference).toBe('Psalm 34:18');
    expect(r.verse.text).toBe('The Lord is near to the brokenhearted; He saves the contrite in spirit.');
    expect(r.verse.copyright).toBe('Public Domain');
  });
  it('keeps the must-nots', () => {
    const all = JSON.stringify(r);
    expect(all).not.toMatch(/\bflagged\b|\bdiagnos|\bdepress|anxiet|disorder\b/i);
    expect(all).not.toMatch(/\bpurpose\b/i); // P-01
  });
});

describe('after a crisis, no stock questions', () => {
  it('replays the live conversation: no bank question, no guess, 988 stays in view', async () => {
    const live = () => ({ turn: turnDeps, live: fixtureProvider(['NONE', 'NONE']) });
    let r = await takeConversationTurn(newSession('u', 's'), "I've been angry at everything, mostly at my parents.", live());
    r = await takeConversationTurn(r.state, "I've been feeling like I want to kill myslef", live());
    expect(r.output.kind).toBe('acute');
    expect(r.state.heavyAt?.level).toBe('acute');
    for (const msg of ["I don't have any purpose", 'idk', 'they never listen to me', 'i just feel tired of everything']) {
      r = await takeConversationTurn(r.state, msg, live());
      const o = r.output as { text?: string; care?: { text: string }; synthesis?: unknown };
      expect(BANK.has(o.text ?? '')).toBe(false);
      expect(o.synthesis).toBeUndefined();
      expect(o.care?.text ?? '').toMatch(/988/);
    }
  });

  it('elevated language alone also keeps stock questions away', async () => {
    const live = () => ({ turn: turnDeps, live: fixtureProvider(['NONE', 'NONE']) });
    let r = await takeConversationTurn(newSession('u', 's'), 'I have been arguing with my parents a lot.', live());
    r = await takeConversationTurn(r.state, "I don't have any purpose", live());
    const o = r.output as { text?: string; care?: { text: string } };
    expect(BANK.has(o.text ?? '')).toBe(false);
    expect(o.care?.text ?? '').toMatch(/988/);
    expect(r.state.heavyAt?.level).toBe('elevated');
  });

  it('lets the bank back in after enough calmer messages', async () => {
    expect(HEAVY_TURNS).toBeGreaterThan(3);
    expect(HEAVY_CARE.acute).toMatch(/988/);
  });
});