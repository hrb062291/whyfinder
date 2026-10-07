import { describe, expect, it } from 'vitest';
import { ALREADY_KNOW, replyPrompt, takeChoice, takeConversationTurn, typedPath } from '../src/engine/conversation.js';
import { newSession } from '../src/engine/session.js';
import { journalRequest, pickPassages } from '../src/engine/journalRequest.js';
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

  it('the Scripture offer keeps the reflection even when it was a question', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), opener, live());
    r = await takeConversationTurn(r.state, 'my friends', live('Your friends were a big part of it. Is it the people you miss most?', 'NONE'));
    expect(r.state.bibleOffered).toBe(true);
    expect(r.output.reply).toBe('Your friends were a big part of it.');
    expect((r.output as { text?: string }).text).toMatch(/Bible|Scripture/);
  });

  it('a short answer to a stock question picks up the earlier thread', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'I spent Saturday fixing the fence with my neighbor Tom.', live());
    expect(r.state.currentQuestionId).not.toBe('followup');
    r = await takeConversationTurn(r.state, 'yeah', live('NONE', 'What was it like working on the fence with Tom?'));
    expect((r.output as { text?: string }).text).toBe('What was it like working on the fence with Tom?');
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

describe('from the final live test', () => {
  it('"Ecclesiastes 4:9-12. I would like to add this to my journal" saves the passage', () => {
    expect(journalRequest('Ecclesiastes 4:9-12. I would like to add this to my journal')?.content).toBe('Ecclesiastes 4:9-12.');
    expect(journalRequest('I would like to add this to my journal')).toEqual({ content: null });
    expect(journalRequest('I want to put my thoughts in my journal more often')).toBeNull();
  });

  it('a short answer right after a crisis is met gently, not with a question about something else', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'I am using what soccer taught me at a hackathon.', live());
    r = await takeConversationTurn(r.state, 'i want to kill myslef', live());
    expect(r.output.kind).toBe('acute');
    r = await takeConversationTurn(r.state, 'idk', live('NONE', 'What part of the hackathon felt like soccer?'));
    expect((r.output as { text?: string }).text).not.toBe('What part of the hackathon felt like soccer?');
  });

  it('right after a crisis, "idk" gets kind words and no question about work', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'work is a lot', live());
    r = await takeConversationTurn(r.state, 'i want to kill myslef', live());
    r = await takeConversationTurn(r.state, 'idk',
      live("That's okay, it can be hard to put words to when work is a lot. If one moment from this week at work comes to mind, what was it?", 'NONE'));
    const o = r.output as { text?: string; reply?: string };
    expect(o.reply).toBe("That's okay, it can be hard to put words to when work is a lot.");
    expect(o.text).toMatch(/Take your time|still here|No rush/i);
    expect(o.text).not.toMatch(/work/);
  });

  it('a long, real message gets a question about it, not a stock question', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'Rewiring the shed with Tom took all of Saturday.', live('NONE', 'What did rewiring the shed with Tom involve?'));
    for (const [m, q] of [
      ['We ran new wire from the house to the shed.', 'What was running the wire to the shed like?'],
      ['Tom held the ladder while I worked on the shed.', 'What was it like working on the shed with Tom?'],
      ['The breaker in the shed was older than both of us.', 'What did you do about the old breaker in the shed?'],
      ['We replaced the breaker and the shed lights finally worked.', 'What did you and Tom do once the shed lights worked?'],
    ]) r = await takeConversationTurn(r.state, m, live('NONE', q));
    expect(r.state.followStreak).toBeGreaterThanOrEqual(4);
    r = await takeConversationTurn(r.state, 'Honestly working with my hands like that with Tom is the best part of my whole week.',
      live('NONE', 'What makes working with your hands with Tom the best part of the week?'));
    expect((r.output as { text?: string }).text).toBe('What makes working with your hands with Tom the best part of the week?');
  });

  it('remembers which passages were shown, so the next answer can choose others', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'I played soccer my whole life and wanted to go pro.', live());
    r = await takeConversationTurn(r.state, 'Now it is over for me and I feel like it is time to move on but I do not know how.', live());
    r = await takeConversationTurn(r.state, 'yes', live(ANSWER));
    expect(r.state.said?.join(' ')).toMatch(/already shared: Ecclesiastes 3:1/);
  });
});

describe('saving a verse, from the live test', () => {
  const p = (reference: string, text: string) => ({ reference, version: 'BSB', text });
  const answer = [p('Genesis 2:15', 'Then the Lord God took the man...'), p('Colossians 3:23', 'Whatever you do, work at it with your whole being...')];
  const later = [p('Psalm 34:18', 'The Lord is near to the brokenhearted...')];

  it('"can I save that verse?" and "add colossionons verse" are save requests', () => {
    expect(journalRequest('can I save that verse?')).toEqual({ content: 'that verse' });
    expect(journalRequest('add colossionons verse')).toEqual({ content: 'colossionons verse' });
    expect(journalRequest('keep this passage please')).toEqual({ content: 'this passage' });
    expect(journalRequest('I want to keep that verse in mind this week')).toBeNull();
    expect(journalRequest('The verse about work stuck with me')).toBeNull();
  });

  it('finds the passage they mean, with its words', () => {
    expect(pickPassages('that verse', [later, answer])).toEqual(later);
    expect(pickPassages('colossionons verse', [later, answer])).toEqual([answer[1]]);
    expect(pickPassages('Colossians 3:23', [later, answer])).toEqual([answer[1]]);
    expect(pickPassages('Ecclesiastes 4:9-12.', [later, answer])).toBeNull();
    expect(pickPassages('call my sister', [later, answer])).toBeNull();
  });

  it('the reply never points to buttons for saving', () => {
    expect(replyPrompt([{ text: 'can I keep that?' }])).toMatch(/add that to my journal/);
  });
});

describe('typing a path instead of tapping it, from the live test', () => {
  it('reads what they typed', () => {
    const after = { entries: [1, 2, 3], choicesAt: 3 };
    expect(typedPath('All three', after)).toBe('both');
    expect(typedPath('both please', after)).toBe('both');
    expect(typedPath('go deeper', after)).toBe('deeper');
    expect(typedPath('the bible one', after)).toBe('bible');
    expect(typedPath('I want to hear your thoughts and get some biblical thoughts', { entries: [1, 2] })).toBe('both');
    expect(typedPath('I would like to hear your thoughts', { entries: [1, 2] })).toBe('thoughts');
    // Ordinary sentences are not paths.
    expect(typedPath('both of my parents work a lot', { entries: [1, 2] })).toBeNull();
    expect(typedPath('I read the Bible every morning', { entries: [1, 2] })).toBeNull();
  });

  it('"All three" after the block brings an answer, not a guess', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'Work has been a lot lately with all the deadlines.', live());
    r = await takeConversationTurn(r.state, 'My manager keeps adding projects without asking.', live());
    r = await takeConversationTurn(r.state, 'idk', live());
    r = await takeConversationTurn(r.state, 'yeah', live());
    expect((r.output as { choices?: boolean }).choices).toBe(true);
    r = await takeConversationTurn(r.state, 'All three', live(ANSWER));
    expect(r.output.answer?.scripture).toEqual(['Ecclesiastes 3:1']);
  });

  it('"your thoughts and some biblical thoughts" after the Scripture offer brings an answer', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'I played soccer my whole life and wanted to go pro.', live());
    r = await takeConversationTurn(r.state, 'Now it is over for me and I feel like it is time to move on but I do not know how.', live());
    expect(r.state.bibleOffered).toBe(true);
    r = await takeConversationTurn(r.state, 'I want to hear your thoughts and get some biblical thoughts', live(ANSWER));
    expect(r.output.answer).toBeDefined();
    expect((r.output as { synthesis?: unknown }).synthesis).toBeUndefined();
  });
});

describe('from the full test run', () => {
  it('"can I save Ecclesiastes 4:9-10" and "add Psalm 23" are save requests', () => {
    expect(journalRequest('can I save Ecclesiastes 4:9-10')).toEqual({ content: 'Ecclesiastes 4:9-10' });
    expect(journalRequest('add Ecclesiastes 4:9-10')).toEqual({ content: 'Ecclesiastes 4:9-10' });
    expect(journalRequest('add 1 John 4:18 please')).toEqual({ content: '1 John 4:18' });
    expect(journalRequest('add Psalm 23')).toEqual({ content: 'Psalm 23' });
    expect(journalRequest('I want to add 3 more hours to my week')).toBeNull();
    expect(journalRequest('add more 10 minutes of reading')).toBeNull();
  });

  it('"my mom passed away last year" gets no stock question', async () => {
    const r = await takeConversationTurn(newSession('u', 's'), 'my mom passed away last year', live());
    expect((r.output as { questionId?: string }).questionId).toBe('tender');
  });

  it('"I undestand about loniless" (typos) counts as "I already know"', () => {
    expect(ALREADY_KNOW.test('I undestand about loniless')).toBe(true);
  });

  it('if the combined answer is rejected, the plain Bible answer still comes', async () => {
    let r = await takeConversationTurn(newSession('u', 's'), 'Work has been a lot lately with all the deadlines.', live());
    r = await takeConversationTurn(r.state, 'I want to hear your thoughts and some biblical thoughts', live('not json', 'not json', ANSWER));
    expect(r.output.answer?.scripture).toEqual(['Ecclesiastes 3:1']);
  });

  it('"the only reason I am still alive" is never praised as a step forward', () => {
    expect(replyPrompt([{ text: 'this hackathon is the only reason I am still alive' }])).toMatch(/only reason they are still alive/);
  });
});