import { describe, expect, it } from 'vitest';
import { FIRST_MESSAGE, REPEAT_MESSAGE, SECOND_MESSAGE, acuteResponse, detectAcuteSignal, normalizeForSignal } from '../src/constraints/acuteSignal.js';
import { concernTier } from '../src/constraints/concernTier.js';
import { HEAVY_TURNS, takeConversationTurn } from '../src/engine/conversation.js';
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

describe('the crisis response, first time', () => {
  const r = acuteResponse();
  it('uses the team\'s message, names real people and 988 once, and keeps the door open', () => {
    expect(r.level).toBe(1);
    expect(r.faith).toBe(FIRST_MESSAGE);
    expect(r.faith).toMatch(/not a licensed psychologist or pastor/);
    expect(r.faith).toMatch(/meant for community/);
    expect(r.offersHuman).toMatch(/988/);
    expect(r.offersHuman).toMatch(/pastor|counselor|friend/i);
    expect(r.closing).toMatch(/keep talking/i);
  });
  it('carries a fixed verse with its source', () => {
    expect(r.verse?.reference).toBe('Psalm 34:18');
    expect(r.verse?.text).toBe('The Lord is near to the brokenhearted; He saves the contrite in spirit.');
    expect(r.verse?.copyright).toBe('Public Domain');
  });
  it('keeps the must-nots at every level', () => {
    for (const n of [1, 2, 3, 7]) {
      const all = JSON.stringify(acuteResponse('general', n));
      expect(all).not.toMatch(/\bflagged\b|\bdiagnos|\bdepress|anxiet|disorder\b/i);
      expect(all).not.toMatch(/\bpurpose\b/i); // P-01
    }
  });
});

describe('when it comes up again', () => {
  it('second time: plainer, and says this is not what the app is for', () => {
    const r = acuteResponse('general', 2);
    expect(r.level).toBe(2);
    expect(r.namesConcern).toBe(SECOND_MESSAGE);
    expect(r.namesConcern).toMatch(/not licensed for counseling/);
    expect(r.verse).toBeUndefined();
  });
  it('third time and every time after: the short message', () => {
    for (const n of [3, 4, 10]) expect(acuteResponse('general', n).namesConcern).toBe(REPEAT_MESSAGE);
  });
  it('the engine counts it across the conversation', async () => {
    const live = () => ({ turn: turnDeps, live: fixtureProvider(['NONE', 'NONE']) });
    let r = await takeConversationTurn(newSession('u', 's'), 'work is a lot', live());
    const levels: number[] = [];
    for (const m of ['I want to kill myself', 'soccer was taken from me', 'i still want to die', 'i want to end it', 'kms']) {
      r = await takeConversationTurn(r.state, m, live());
      if (r.output.kind === 'acute') levels.push((r.output as { response: { level: number } }).response.level);
    }
    expect(levels).toEqual([1, 2, 3, 3]);
  });
});

describe('after a crisis, no stock questions and no reminders', () => {
  it('replays the live conversation: no bank question, no guess, no repeated hotline', async () => {
    const live = () => ({ turn: turnDeps, live: fixtureProvider(['NONE', 'NONE']) });
    let r = await takeConversationTurn(newSession('u', 's'), "I've been angry at everything, mostly at my parents.", live());
    r = await takeConversationTurn(r.state, "I've been feeling like I want to kill myslef", live());
    expect(r.output.kind).toBe('acute');
    expect(r.state.heavyAt?.level).toBe('acute');
    for (const msg of ['idk', 'I had soccer taken away from me', 'soccer was freeing for my mind']) {
      r = await takeConversationTurn(r.state, msg, live());
      const o = r.output as { text?: string; care?: { text: string }; synthesis?: unknown };
      expect(BANK.has(o.text ?? '')).toBe(false);
      expect(o.synthesis).toBeUndefined();
      expect(o.care?.text ?? '').not.toMatch(/988|ending your life/);
    }
  });

  it('elevated language gets 988 once, on that message only', async () => {
    const live = () => ({ turn: turnDeps, live: fixtureProvider(['NONE', 'NONE']) });
    let r = await takeConversationTurn(newSession('u', 's'), 'I have been arguing with my parents a lot.', live());
    r = await takeConversationTurn(r.state, "I don't have any purpose", live());
    let o = r.output as { text?: string; care?: { text: string } };
    expect(BANK.has(o.text ?? '')).toBe(false);
    expect(o.care?.text ?? '').toMatch(/988/);
    expect(r.state.heavyAt?.level).toBe('elevated');
    r = await takeConversationTurn(r.state, 'we argued about my grades again at dinner', live());
    o = r.output as { text?: string; care?: { text: string } };
    expect(o.care?.text ?? '').not.toMatch(/988/);
  });

  it('keeps stock questions away for a while', () => {
    expect(HEAVY_TURNS).toBeGreaterThan(3);
  });
});