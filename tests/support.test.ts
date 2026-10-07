import { describe, expect, it } from 'vitest';
import { BANNED_DISTRESS_CLAIMS, LABEL_VOCABULARY } from '../src/config/patterns.js';
import {
  SUPPORT_CHECKIN, SUPPORT_CONTINUE, SUPPORT_THRESHOLD, emptySupport, evaluateSupport, isThin,
  saysNothingYet, strainWeight, supportCard,
} from '../src/constraints/support.js';
import { resumeQuestions, takeConversationTurn, isAskingUs } from '../src/engine/conversation.js';
import { newSession } from '../src/engine/session.js';
import { fixtureProvider } from '../src/providers/index.js';

const GOOD_SYNTH = JSON.stringify({
  body: 'Both the shed and the billing system involve working something out alongside someone. Worth exploring whether that matters?',
  evidence: ['e1', 'e2'], concreteNouns: ['shed', 'billing system'], kind: 'ai_inference',
});
const turnDeps = { provider: fixtureProvider([GOOD_SYNTH]), systemPrompt: 'X', thirdPartyNames: [] };
const live = (...r: string[]) => fixtureProvider(r.length ? r : ['That sounds like a lot to hold at once.']);

describe('strain weights', () => {
  it('anxiety plus a plea for help reaches the threshold in one message', () => {
    const w = strainWeight('i have extreme anxiety and I dont know what I can do to deal with it');
    expect(w).toBeGreaterThanOrEqual(SUPPORT_THRESHOLD);
  });
  it('an ordinary question for help counts for nothing on its own', () => {
    expect(strainWeight('What can I do about my job situation?')).toBe(0);
  });
  it('help-seeking counts once there is earlier strain', () => {
    expect(strainWeight('what can I do', 2)).toBe(1);
  });
  it('a single soft word stays below the threshold', () => {
    expect(strainWeight('I have been a bit stressed this week')).toBeLessThan(SUPPORT_THRESHOLD);
  });
  it('plain talk about a good day adds nothing', () => {
    expect(strainWeight('I spent Saturday rewiring the shed')).toBe(0);
  });
  it('accumulates across messages and shows the card once', () => {
    let s = emptySupport();
    let a = evaluateSupport(s, 'I feel stressed', 'none');
    expect(a.showCard).toBe(false);
    a = evaluateSupport(a.next, 'I feel overwhelmed and stuck', 'mild');
    a = evaluateSupport(a.next, 'so lonely lately', 'none');
    expect(a.next.shown).toBe(true);
    s = a.next;
    const again = evaluateSupport(s, 'I have so much anxiety', 'none');
    expect(again.showCard).toBe(false);
  });
  it('elevated language is worth the whole threshold on its own', () => {
    expect(evaluateSupport(undefined, 'I feel hopeless', 'elevated').showCard).toBe(true);
  });
});

describe('thin answers', () => {
  it.each(['not much', 'idk', 'Nothing.', 'no', 'ok', 'n/a'])('%s is thin', (t) => {
    expect(isThin(t)).toBe(true);
  });
  it.each(['drugs', 'advice', 'i just relaxed and stayed home', 'pickleball'])('%s is a real answer', (t) => {
    expect(isThin(t)).toBe(false);
  });
  it('recognises the model saying nothing has surfaced', () => {
    expect(saysNothingYet('Not much has surfaced yet, so I will not guess at a pattern.')).toBe(true);
    expect(saysNothingYet('Both the shed and the billing system involve working alongside someone.')).toBe(false);
  });
});

describe('the support path in the conversation', () => {
  const FIRST = 'i have extreme anxiety and I dont know what I can do to deal with it';

  it('shows the card on the first heavy message, and holds the bank, guesses and experiments', async () => {
    const r = await takeConversationTurn(newSession('u', 's'), FIRST, { turn: turnDeps, live: live() });
    expect(r.output.support?.title).toMatch(/not have to carry this alone/i);
    expect(r.output.support?.items.length).toBeGreaterThanOrEqual(3);
    expect(r.output.kind).toBe('question');
    expect((r.output as { text: string }).text).toBe(SUPPORT_CHECKIN);
    expect((r.output as { questionId: string }).questionId).toBe('support');
    expect(r.output.experiment).toBeUndefined();
    expect((r.output as { synthesis?: unknown }).synthesis).toBeUndefined();
    expect(r.state.support?.active).toBe(true);
    expect(r.state.entries).toHaveLength(1);
  });

  it('keeps listening on later turns: no bank question, no guess, no repeat of the card', async () => {
    const deps = { turn: turnDeps, live: live() };
    let r = await takeConversationTurn(newSession('u', 's'), FIRST, deps);
    r = await takeConversationTurn(
      r.state, 'I had a ton of homework and all I could do was procrastinate.', deps);
    expect(r.output.support).toBeUndefined();
    expect((r.output as { text: string }).text).toBe(SUPPORT_CONTINUE);
    expect((r.output as { synthesis?: unknown }).synthesis).toBeUndefined();
    expect(r.output.experiment).toBeUndefined();
    expect(r.state.entries).toHaveLength(2);
  });

  it('routes "what can I do about this anxiety?" to a careful answer, with the card', async () => {
    const answer = JSON.stringify({
      body: 'That sounds hard to carry. A doctor or counselor can help with it directly, and small steps like writing the worry down can help.',
      kind: 'psychological_research', scripture: ['Philippians 4:6-7'],
      questionsToConsider: ['Who could you tell this week?', 'What is one small thing that helps, even briefly?'],
      counsel: ['A licensed counselor or your doctor', 'A pastor or trusted friend'],
    });
    expect(isAskingUs('What can i do about this anxiety?')).toBe(true);
    const r = await takeConversationTurn(
      newSession('u', 's'), 'What can i do about this anxiety?', { turn: turnDeps, live: live(answer) });
    expect(r.output.answer?.counsel.join(' ')).toMatch(/counselor|doctor/i);
    expect(r.output.support).toBeDefined();
    expect(r.state.entries).toHaveLength(0);
  });

  it('resume returns to the question bank and clears the pause', async () => {
    const r1 = await takeConversationTurn(newSession('u', 's'), FIRST, { turn: turnDeps, live: live() });
    const r2 = resumeQuestions(r1.state);
    expect(r2.state.support?.active).toBe(false);
    expect(r2.state.support?.shown).toBe(true);
    expect(r2.output.kind).toBe('question');
    expect((r2.output as { questionId: string }).questionId).not.toBe('support');
  });

  it('keeps the 988 line for elevated language, and still shows the card', async () => {
    const r = await takeConversationTurn(
      newSession('u', 's'), 'I feel hopeless about all of it', { turn: turnDeps, live: live() });
    expect(r.output.care?.text).toMatch(/988/);
    expect(r.output.support?.showResources).toBe(true);
  });

  it('leaves acute language exactly as it was', async () => {
    const r = await takeConversationTurn(
      newSession('u', 's'), 'I have been thinking about killing myself', { turn: turnDeps, live: live() });
    expect(r.output.kind).toBe('acute');
    expect(r.output.support).toBeUndefined();
  });

  it('does nothing extra at phase 1', async () => {
    const r = await takeConversationTurn(
      newSession('u', 's'), FIRST, { turn: turnDeps, live: live(), phase: 1 });
    expect(r.output.support).toBeUndefined();
  });

  it('never offers a guess built from a thin answer, but records the answer', async () => {
    const deps = { turn: turnDeps, live: live() };
    let r = await takeConversationTurn(newSession('u', 's'), 'not much', deps);
    r = await takeConversationTurn(r.state, 'i just relaxed and stayed home', deps);
    expect((r.output as { synthesis?: unknown }).synthesis).toBeUndefined();
    expect(r.state.entries).toHaveLength(2);
  });

  it('allows a guess once there are two real answers', async () => {
    const deps = { turn: turnDeps, live: live() };
    let r = await takeConversationTurn(newSession('u', 's'), 'I spent most of Saturday rewiring the shed with Tom.', deps);
    r = await takeConversationTurn(r.state, 'At work people keep coming to me to explain the billing system.', deps);
    expect((r.output as { synthesis?: unknown }).synthesis).toBeDefined();
  });

  it('does not turn "nothing has surfaced yet" into a card', async () => {
    const hedge = JSON.stringify({
      body: 'Not much has surfaced yet, so I will not guess at a pattern from these. What did the shed involve?',
      evidence: ['e1', 'e2'], concreteNouns: ['shed'], kind: 'ai_inference',
    });
    const deps = { turn: { ...turnDeps, provider: fixtureProvider([hedge]) }, live: live() };
    let r = await takeConversationTurn(newSession('u', 's'), 'I spent most of Saturday rewiring the shed with Tom.', deps);
    r = await takeConversationTurn(r.state, 'At work people keep coming to me to explain the billing system.', deps);
    expect((r.output as { synthesis?: unknown }).synthesis).toBeUndefined();
    expect(r.state.synthesesOffered).toHaveLength(0);
    expect(r.output.experiment).toBeUndefined();
  });
});

describe('support copy audit', () => {
  const card = supportCard('mild');
  const all = [card.title, card.lead, card.note, SUPPORT_CHECKIN, SUPPORT_CONTINUE,
    ...card.items.flatMap((i) => [i.name, i.detail])].join(' ');

  it('makes no claim to detect or monitor distress (C-02)', () => {
    for (const re of BANNED_DISTRESS_CLAIMS) expect(all).not.toMatch(re);
  });
  it('uses no clinical or typology label (C-14)', () => {
    for (const label of LABEL_VOCABULARY) {
      expect(new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(all)).toBe(false);
    }
  });
  it('never uses the word purpose (P-01)', () => {
    expect(all).not.toMatch(/purpose/i);
  });
  it('names 988 and 211, and people, not a product', () => {
    expect(all).toMatch(/988/);
    expect(all).toMatch(/211/);
    expect(all).toMatch(/counselor|doctor/i);
    expect(all).toMatch(/pastor/i);
  });
  it('opens the crisis sheet only for elevated', () => {
    expect(supportCard('mild').showResources).toBe(false);
    expect(supportCard('elevated').showResources).toBe(true);
  });
});