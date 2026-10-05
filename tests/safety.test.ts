import { describe, expect, it } from 'vitest';
import { concernTier, careFor } from '../src/constraints/concernTier.js';
import { takeConversationTurn } from '../src/engine/conversation.js';
import { newSession } from '../src/engine/session.js';
import { fixtureProvider } from '../src/providers/index.js';

describe('passive ideation reaches the 988 line', () => {
  it.each([
    'Instead I was on the floor of a locked room, crying, not totally sure I wanted to keep going.',
    "I don't want to be here anymore",
    "I didn't want to keep going",
    "I can't go on like this",
    'Everyone would be better off without me',
    "I wish I wasn't alive",
  ])('%s', (t) => {
    expect(concernTier(t).tier === 'elevated' || concernTier(t).tier === 'acute').toBe(true);
  });
  it.each([
    'I want to keep going with this project',
    'I do not want to quit my job, I want to keep going',
    'I spent the weekend in the shed',
    'That was the first night I actually called out to God.',
  ])('leaves ordinary talk alone: %s', (t) => {
    expect(concernTier(t).tier).toBe('none');
  });
  it('names 988 and never calls a model for it', async () => {
    const r = await takeConversationTurn(
      newSession('u', 's'), 'I was crying, not totally sure I wanted to keep going.',
      { turn: { provider: fixtureProvider(['']), systemPrompt: 'X', thirdPartyNames: [] }, live: fixtureProvider(['SHOULD NOT APPEAR']) });
    expect(r.output.care?.text).toMatch(/988/);
    expect(JSON.stringify(r.output)).not.toMatch(/SHOULD NOT APPEAR/);
    expect(careFor('elevated')?.showResources).toBe(true);
  });
});