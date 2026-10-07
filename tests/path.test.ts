import { describe, expect, it } from 'vitest';
import { replyPrompt, takeChoice, takeConversationTurn } from '../src/engine/conversation.js';
import { newSession } from '../src/engine/session.js';
import { fixtureProvider } from '../src/providers/index.js';

const turnDeps = { provider: fixtureProvider(['']), systemPrompt: 'X', thirdPartyNames: [] };
const live = (...r: string[]) => ({ turn: turnDeps, live: fixtureProvider(r.length ? r : ['NONE', 'NONE']) });
const ANSWER = JSON.stringify({
  body: 'Scripture often speaks of seasons that end and new ones that begin. One reading is that loss can sit alongside hope.',
  kind: 'biblical_teaching', scripture: ['Ecclesiastes 3:1'],
  questionsToConsider: ['What are you hoping the next season holds?', 'Who could walk with you in it?'],
  counsel: ['A pastor or trusted mentor'],
});

describe('affirming a step forward', () => {
  it('the reply prompt asks for specific, varied affirmation of what they are doing', () => {
    const p = replyPrompt([{ text: 'I am using what soccer taught me in a hackathon now' }]);
    expect(p).toMatch(/step forward/);
    expect(p).toMatch(/Affirm what they are doing, never who they are/);
  });
});

describe('the "where next?" block', () => {
  it('appears after a long stretch with no card', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'I spent Saturday fixing the fence with my neighbor Tom.', live());
    let shownAt = -1;
    const msgs = [
      'We dug out three old posts and set new concrete for them.',
      'Tom brought his tools and I brought lunch for both of us.',
      'It took most of the afternoon but the fence looks solid now.',
      'Next weekend we might build a small gate for the garden.',
      'I like that kind of work more than sitting at my desk all week.',
      'My office job is mostly spreadsheets and long meetings.',
    ];
    for (let i = 0; i < msgs.length; i++) {
      r = await takeConversationTurn(r.state, msgs[i], live());
      if ((r.output as { choices?: boolean }).choices && shownAt < 0) shownAt = r.state.entries.length;
    }
    expect(shownAt).toBe(7);
  });

  it('appears sooner when the answers get short', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'Work has been a lot lately with all the deadlines.', live());
    r = await takeConversationTurn(r.state, 'My manager keeps adding projects without asking.', live());
    r = await takeConversationTurn(r.state, 'idk', live());
    expect((r.output as { choices?: boolean }).choices).toBeUndefined();
    r = await takeConversationTurn(r.state, 'yeah', live());
    const o = r.output as { choices?: boolean; text?: string };
    expect(o.choices).toBe(true);
    // The block is the question: no second question on the screen with it.
    expect(o.text).toBe('');
  });

  it('never appears right after a crisis', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'Work has been a lot lately with all the deadlines.', live());
    r = await takeConversationTurn(r.state, 'i want to kill myself', live());
    for (const m of ['idk', 'yeah', 'ok', 'sure']) {
      r = await takeConversationTurn(r.state, m, live());
      expect((r.output as { choices?: boolean }).choices).toBeUndefined();
    }
  });

  it('each path gives the right kind of answer', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'Soccer was taken from me and I feel like I need to move on.', live());
    const bible = await takeChoice(r.state, 'bible', live(ANSWER));
    expect(bible.output.answer?.scripture).toEqual(['Ecclesiastes 3:1']);
    const thoughts = await takeChoice(r.state, 'thoughts', live(ANSWER));
    expect(thoughts.output.answer).toBeDefined();
    const deeper = await takeChoice(r.state, 'deeper', live('What would it mean to you to move on from soccer?'));
    expect((deeper.output as { text?: string }).text).toMatch(/soccer/);
    expect(deeper.state.entries.length).toBe(r.state.entries.length);
  });
});

describe('offering Scripture in the chat', () => {
  it('at a fitting moment it asks, and "yes" brings a Bible answer about their situation', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'I played soccer my whole life and wanted to go pro.', live());
    r = await takeConversationTurn(r.state, 'Now it is over for me and I feel like it is time to move on but I do not know how.', live());
    const o = r.output as { text?: string };
    expect(o.text ?? '').toMatch(/Bible|Scripture/);
    expect(r.state.bibleOffered).toBe(true);
    r = await takeConversationTurn(r.state, 'yes please', live(ANSWER));
    expect(r.output.answer?.scripture).toEqual(['Ecclesiastes 3:1']);
    expect(r.state.bibleOffered).toBe(false);
  });

  it('an opener about moving on still gets the offer a turn or two later', async () => {
    const msgs = [
      "I played soccer my whole life but it's over for me and I don't know how to move on",
      'my friends',
      "I'm using the resilience soccer taught me in a hackathon now",
    ];
    let r = await takeConversationTurn(newSession('u', 's'), msgs[0], live());
    let asked = false;
    for (const m of msgs.slice(1)) {
      r = await takeConversationTurn(r.state, m, live());
      if (r.state.bibleOffered) asked = true;
    }
    expect(asked).toBe(true);
  });

  it('"no" is respected and the conversation carries on', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'I played soccer my whole life and wanted to go pro.', live());
    r = await takeConversationTurn(r.state, 'Now it is over for me and I feel like it is time to move on but I do not know how.', live());
    r = await takeConversationTurn(r.state, 'no thanks', live());
    expect(r.output.answer).toBeUndefined();
    expect((r.output as { text?: string }).text).toMatch(/keep going/);
  });

  it('a different reply simply continues the conversation', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'I played soccer my whole life and wanted to go pro.', live());
    r = await takeConversationTurn(r.state, 'Now it is over for me and I feel like it is time to move on but I do not know how.', live());
    r = await takeConversationTurn(r.state, 'Actually I started a business with a friend last month.', live());
    expect(r.output.answer).toBeUndefined();
    expect(r.state.bibleOffered).toBe(false);
  });
});

describe('the conversation flows: one card at a time', () => {
  const opener = "I played soccer my whole life but it's over for me and I don't know how to move on";
  const GUESS = JSON.stringify({
    body: 'Soccer and the team seem tied together for you. Worth exploring whether that matters?',
    evidence: ['e1', 'e2'], concreteNouns: ['soccer', 'team'], kind: 'ai_inference',
  });
  const AFFIRM = 'Taking the resilience soccer gave you into a hackathon is a real step forward; are there people around you there?';

  it('the Scripture offer keeps the affirmation', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), opener, live());
    r = await takeConversationTurn(r.state, 'my friends', live());
    if (!r.state.bibleOffered) {
      r = await takeConversationTurn(r.state, "I'm using the resilience soccer taught me in a hackathon now", live(AFFIRM, 'NONE'));
    }
    expect(r.state.bibleOffered).toBe(true);
    if (r.state.entries.length === 3) {
      expect(r.output.reply).toMatch(/real step forward\.$/);
      expect((r.output as { text?: string }).text).toMatch(/Bible|Scripture/);
    }
  });

  it('after a Bible answer, a short reply stays on the topic and no block follows it', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), opener, live());
    r = await takeConversationTurn(r.state, 'my friends', live());
    if (!r.state.bibleOffered) r = await takeConversationTurn(r.state, "I'm using the resilience soccer taught me in a hackathon now", live());
    expect(r.state.bibleOffered).toBe(true);
    r = await takeConversationTurn(r.state, 'yes', live(ANSWER));
    expect(r.output.answer).toBeDefined();
    r = await takeConversationTurn(r.state, 'idk', live('NONE', 'Which of your friends from soccer do you still talk to?'));
    let o = r.output as { text?: string; choices?: boolean };
    expect(o.text).toBe('Which of your friends from soccer do you still talk to?');
    expect(o.choices).toBeUndefined();
    r = await takeConversationTurn(r.state, 'ifk', live());
    o = r.output as { text?: string; choices?: boolean };
    expect(o.choices).toBeUndefined();
    expect(o.text).not.toBe('Which of your friends from soccer do you still talk to?');
  });

  it('after the guess, a talk about moving on gets the Scripture offer, not the experiment', async () => {
    const deps = (...r: string[]) => ({ turn: { ...turnDeps, provider: fixtureProvider([GUESS]) }, live: fixtureProvider(r.length ? r : ['NONE', 'NONE']) });
    let r = await takeConversationTurn(newSession('u', 's'), opener, deps());
    r = await takeConversationTurn(r.state, 'My friends from the team, we did everything together.', deps());
    expect((r.output as { synthesis?: unknown }).synthesis).toBeDefined();
    r = await takeConversationTurn(r.state, "I'm using the resilience soccer taught me in a hackathon now", deps(AFFIRM, 'NONE'));
    expect(r.output.experiment).toBeUndefined();
    expect(r.state.bibleOffered).toBe(true);
  });

  it('never two cards on one screen', async () => {
    const msgs = [opener, 'my friends', "I'm using the resilience soccer taught me in a hackathon now", 'idk', 'yeah',
      'we are building an app', 'it helps people think', 'ok', 'sure', 'maybe', 'I guess'];
    let r = await takeConversationTurn(newSession('u', 's'), msgs[0], live());
    for (const m of msgs.slice(1)) {
      r = await takeConversationTurn(r.state, m, live());
      const o = r.output as { synthesis?: unknown; experiment?: unknown; choices?: boolean; answer?: unknown };
      const cards = [o.synthesis, o.experiment, o.choices, o.answer, r.state.bibleOffered || undefined].filter(Boolean).length;
      expect(cards).toBeLessThanOrEqual(1);
    }
  });
});