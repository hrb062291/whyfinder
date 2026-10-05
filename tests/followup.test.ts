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
    expect(r1.state.lastFollowUp).toBe(true);
    const r2 = await takeConversationTurn(r1.state, 'Mostly running new wire and swapping the breaker.',
      { turn: turnDeps, live: fixtureProvider(['What did the rewiring involve?']) });
    expect((r2.output as { questionId: string }).questionId).not.toBe('followup');
    expect(r2.state.lastFollowUp).toBe(false);
    expect(r2.state.entries).toHaveLength(2);
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