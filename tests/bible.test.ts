import { describe, expect, it } from 'vitest';
import { isAskingUs, takeConversationTurn } from '../src/engine/conversation.js';
import { newSession } from '../src/engine/session.js';
import { fixtureProvider } from '../src/providers/index.js';
import { QUESTIONS } from '../src/content/questions.js';

const turnDeps = { provider: fixtureProvider(['']), systemPrompt: 'X', thirdPartyNames: [] };
const BANK = new Set(QUESTIONS.map((q) => q.text));

describe('asking what the Bible says, however it is phrased', () => {
  it.each([
    "im in a season that's the hardest time of my life, my relationships with friends and family have started deteriorating, school work is extremely hard, and my work is demanding. Is there anything in the bible that talks about how people go through seasons and what is the next step I should go through",
    'I want to know what the bible says about what I said above',
    'what the bible says about loneliness',
    'does the bible talk about grief',
    'are there any verses about anxiety',
    'is there a verse for when you feel alone',
    "what's the biblical view on forgiveness",
    'what is my next step here',
  ])('answers: %s', (t) => {
    expect(isAskingUs(t, true)).toBe(true);
  });

  it.each([
    'I read the bible this morning before work',
    'my mom goes to church every sunday',
    'school work is extremely hard',
  ])('does not treat as a question: %s', (t) => {
    expect(isAskingUs(t, true)).toBe(false);
  });
});

describe('a guess card does not come with a stock question', () => {
  it('after loneliness, the guess stands alone and no small experiment is offered', async () => {
    const guess = JSON.stringify({
      body: 'Both the office and the library come up when you talk about this season. Worth exploring whether that matters?',
      evidence: ['e2', 'e3'], concreteNouns: ['office', 'library'], kind: 'ai_inference',
    });
    const deps = (provider: ReturnType<typeof fixtureProvider>) => ({
      turn: { ...turnDeps, provider }, live: fixtureProvider(['NONE', 'NONE']), phase: 3,
    });
    let r = await takeConversationTurn(newSession('u', 's'), "I've been feeling extremely lonely recently", deps(fixtureProvider([''])));
    r = await takeConversationTurn(r.state, 'most days I sit in the office until late and nobody stops by my desk', deps(fixtureProvider([''])));
    r = await takeConversationTurn(r.state, 'after that I go to the library to study for my classes until it closes', deps(fixtureProvider([''])));
    r = await takeConversationTurn(r.state, 'the office and the library are where most of my week goes right now', deps(fixtureProvider([guess])));
    const o = r.output as { text?: string; synthesis?: unknown; experiment?: unknown };
    expect(o.synthesis).toBeDefined();
    expect(BANK.has(o.text ?? '')).toBe(false);
    expect(o.text ?? '').toBe('');
    expect(o.experiment).toBeUndefined();
  });
});