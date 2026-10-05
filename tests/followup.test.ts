import { describe, expect, it } from 'vitest';
import { generateFollowUp, takeConversationTurn } from '../src/engine/conversation.js';
import { newSession } from '../src/engine/session.js';
import { fixtureProvider } from '../src/providers/index.js';

const turnDeps = { provider: fixtureProvider(['']), systemPrompt: 'X', thirdPartyNames: [] };
const SHED = 'I spent most of Saturday rewiring the shed with Tom.';

describe('generateFollowUp', () => {
  const entries = [{ text: SHED }];
  const ask = (reply: string) => generateFollowUp(fixtureProvider([reply]), entries);
  it('accepts one short question that uses their own word', async () => {
    expect(await ask('What was the trickiest part of rewiring the shed?')).toBe('What was the trickiest part of rewiring the shed?');
  });
  it.each([
    ['NONE'],
    ['Tell me more about Saturday.'],                              // not a question
    ['What did the shed involve? And how did Tom feel?'],          // two questions
    ['Why did you rewire the shed?'],                               // why
    ['What matters most to you in life?'],                          // none of their words
    ['What did the shed teach you about your purpose?'],            // the word purpose
  ])('rejects %s', async (r) => {
    expect(await ask(r)).toBeNull();
  });
});

describe('follow-ups in the conversation', () => {
  const live = () => fixtureProvider(['Rewiring a shed with Tom sounds like a full day.', 'What did the rewiring involve?']);

  it('asks about what they said, then goes back to the bank next turn', async () => {
    const deps = { turn: turnDeps, live: live() };
    const r1 = await takeConversationTurn(newSession('u', 's'), SHED, deps);
    expect((r1.output as { text: string }).text).toBe('What did the rewiring involve?');
    expect((r1.output as { questionId: string }).questionId).toBe('followup');
    expect(r1.state.followStreak).toBe(1);
    const r2 = await takeConversationTurn(r1.state, 'Mostly running new wire and swapping the breaker.',
      { turn: turnDeps, live: fixtureProvider(['Nice work.', 'What was the breaker like to swap?']) });
    expect((r2.output as { questionId: string }).questionId).toBe('followup');
    expect(r2.state.followStreak).toBe(2);
    // After two in a row, the bank gets a turn and the count starts again.
    const r3 = await takeConversationTurn(r2.state, 'Tom held the flashlight and I did the wiring.',
      { turn: turnDeps, live: fixtureProvider(['Good teamwork.', 'What did the flashlight help with?']) });
    expect((r3.output as { questionId: string }).questionId).not.toBe('followup');
    expect(r3.state.followStreak).toBe(0);
    expect(r3.state.entries).toHaveLength(3);
  });

  it('never follows up on a thin answer or a struggling one', async () => {
    const thin = await takeConversationTurn(newSession('u', 's'), 'not much', { turn: turnDeps, live: live() });
    expect((thin.output as { questionId: string }).questionId).not.toBe('followup');
    const hard = await takeConversationTurn(newSession('u', 's'), 'I feel hopeless about the shed', { turn: turnDeps, live: live() });
    expect((hard.output as { questionId: string }).questionId).not.toBe('followup');
  });

  it('falls back to the bank when the model has nothing concrete', async () => {
    const r = await takeConversationTurn(newSession('u', 's'), SHED,
      { turn: turnDeps, live: fixtureProvider(['NONE']) });
    expect((r.output as { questionId: string }).questionId).not.toBe('followup');
  });

  it('is off at phase 1', async () => {
    const r = await takeConversationTurn(newSession('u', 's'), SHED, { turn: turnDeps, live: live(), phase: 1 });
    expect((r.output as { questionId: string }).questionId).not.toBe('followup');
  });
});

import { BANNED_DISTRESS_CLAIMS } from '../src/config/patterns.js';
import { TENDER_LINE, isTender } from '../src/constraints/support.js';
import { isAskingUs, withoutQuestion } from '../src/engine/conversation.js';

describe('staying with what they said', () => {
  const REAL1 = 'I spent Saturday rewiring the shed with Tom.';
  const HURT = 'Today I feel unwell because my friends were really mean to me.';
  const tenderDeps = (...r: string[]) => ({ turn: { ...turnDeps, provider: fixtureProvider(['']) }, live: fixtureProvider(r) });

  it('uses a question in the reply as THE question, so there is only one', async () => {
    const r = await takeConversationTurn(newSession('u', 's'), REAL1,
      tenderDeps('Rewiring a shed with Tom sounds like a full day. What was the hardest part?'));
    const o = r.output as { text: string; questionId: string; reply?: string };
    expect(o.text).toBe('Rewiring a shed with Tom sounds like a full day. What was the hardest part?');
    expect(o.reply).toBeUndefined();
    expect(o.questionId).toBe('followup');
  });

  it('never moves on to a list question, a guess or an experiment when they are hurting', async () => {
    const deps = tenderDeps('That sounds hard.', 'NONE');
    let r = await takeConversationTurn(newSession('u', 's'), REAL1, tenderDeps('Nice.', 'What did the shed involve?'));
    r = await takeConversationTurn(r.state, HURT, deps);
    const o = r.output as { text: string; questionId: string; synthesis?: unknown };
    expect(o.synthesis).toBeUndefined();
    expect(r.output.experiment).toBeUndefined();
    expect(['followup', 'tender']).toContain(o.questionId);
  });

  it('says a gentle fixed line when hurting and the model has no good question', async () => {
    const r = await takeConversationTurn(newSession('u', 's'), HURT, tenderDeps('NONE', 'NONE'));
    expect((r.output as { text: string }).text).toBe(TENDER_LINE);
    expect((r.output as { questionId: string }).questionId).toBe('tender');
    expect(r.state.entries).toHaveLength(1);
  });

  it('knows tender language, and leaves ordinary talk alone', () => {
    for (const t of ['I feel unwell', 'my friends were mean to me', "they don't really care about me",
      'it feels like im distancing myself from god', 'im feeling quite distant from god right now',
      "I just don't feel God in my life", 'God feels far away', 'my soul is lonely', 'I cried a lot']) expect(isTender(t)).toBe(true);
    for (const t of ['I spent Saturday on the shed', 'people keep coming to me to explain the billing system']) {
      expect(isTender(t)).toBe(false);
    }
  });

  it('keeps the tender line clean (no detection claims, no purpose)', () => {
    for (const re of BANNED_DISTRESS_CLAIMS) expect(TENDER_LINE).not.toMatch(re);
    expect(TENDER_LINE).not.toMatch(/purpose/i);
  });

  it('drops a trailing question from a reflection', () => {
    expect(withoutQuestion('That sounds like a full day. What was hard?')).toBe('That sounds like a full day.');
    expect(withoutQuestion('What was hard?')).toBeNull();
    expect(withoutQuestion('No question here.')).toBeNull();
  });

  it('after two follow-ups the bank gets a turn, with one question only', async () => {
    let st = newSession('u', 's');
    const asks = (n: number) => tenderDeps(`Nice part ${n}. What was the hardest bit of the shed?`);
    let r = await takeConversationTurn(st, REAL1, asks(1));
    r = await takeConversationTurn(r.state, 'We swapped the breaker and ran new wire.', asks(2));
    r = await takeConversationTurn(r.state, 'Tom held the flashlight the whole time.', asks(3));
    const o = r.output as { text: string; questionId: string; reply?: string };
    expect(o.questionId).not.toBe('followup');
    expect(o.reply ?? '').not.toMatch(/\?/);
  });
});

describe('help requests and lingering tenderness', () => {
  it('treats "I need help on how I can become a better person" as a question for the app', () => {
    expect(isAskingUs('I need help on how i can become a better person')).toBe(true);
    expect(isAskingUs('Can you help me figure out how to trust God with my career')).toBe(true);
    expect(isAskingUs('I need help moving the couch on Saturday')).toBe(false);
    expect(isAskingUs('I have extreme anxiety and I dont know what I can do to deal with it')).toBe(false);
  });

  it('answers a help request with a discernment card, not another reflective question', async () => {
    const answer = JSON.stringify({
      body: 'Many Christians describe growth as slow, ordinary choices. It may be worth asking what one small habit could look like.',
      kind: 'christian_interpretation', scripture: ['Romans 12:2'],
      questionsToConsider: ['Who in your life already lives the way you hope to?', 'What is one small thing this week?'],
      counsel: ['A pastor or mentor you trust'],
    });
    const r = await takeConversationTurn(newSession('u', 's'), 'I need help on how i can become a better person',
      { turn: turnDeps, live: fixtureProvider([answer]) });
    expect(r.output.answer?.scripture).toEqual(['Romans 12:2']);
  });

  it('stays gentle for two more turns after something tender, even if the next answer is one word', async () => {
    const live = () => ({ turn: turnDeps, live: fixtureProvider(['NONE', 'NONE']) });
    let r = await takeConversationTurn(newSession('u', 's'), 'ive been feeling distant from god', live());
    expect(r.state.tenderLeft).toBe(2);
    r = await takeConversationTurn(r.state, 'connected', live());
    expect(['followup', 'tender']).toContain((r.output as { questionId: string }).questionId);
    expect(r.state.tenderLeft).toBe(1);
    r = await takeConversationTurn(r.state, 'I think so', live());
    expect(['followup', 'tender']).toContain((r.output as { questionId: string }).questionId);
    expect(r.state.tenderLeft).toBe(0);
  });
});