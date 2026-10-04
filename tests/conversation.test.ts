import { describe, expect, it } from 'vitest';
import { careFor, concernTier } from '../src/constraints/concernTier.js';
import { filterProse } from '../src/constraints/proseFilter.js';
import {
  ANSWER_FALLBACK, generateAnswer, generateReply, isAskingUs, takeConversationTurn,
} from '../src/engine/conversation.js';
import { newSession } from '../src/engine/session.js';
import {
  chooseExperiment, hasLimitedSlack, offer, pickExperiment, recordReflection, EXPERIMENTS,
} from '../src/content/experiments.js';
import { fixtureProvider } from '../src/providers/index.js';
import type { Entry } from '../src/types/index.js';

const e = (id: string, text: string, questionId?: string): Entry => ({
  id, userId: 'u', sessionId: 's', createdAt: '2026-10-04T00:00:00Z', text, source: 'answer', questionId,
});

describe('concern tiers', () => {
  it('leaves ordinary text alone', () => {
    expect(concernTier('I rewired the shed on Saturday.').tier).toBe('none');
  });
  it('treats "pointless" as mild, not a crisis', () => {
    expect(concernTier("i've been feeling like everything i do is pointless").tier).toBe('mild');
  });
  it('treats "hopeless" as elevated', () => {
    expect(concernTier('I feel hopeless about all of it').tier).toBe('elevated');
  });
  it('keeps explicit self-harm acute', () => {
    expect(concernTier('I have been thinking about killing myself').tier).toBe('acute');
  });
  it('caps grief in psalm register at mild', () => {
    expect(concernTier('I feel hopeless since she died').tier).toBe('mild');
  });
  it('elevated care names 988 and never flags or monitors', () => {
    const c = careFor('elevated')!;
    expect(c.text).toMatch(/988/);
    expect(c.showResources).toBe(true);
    expect(c.text).not.toMatch(/flagged|monitor|reviewed|diagnos/i);
  });
  it('mild care does not open the sheet', () => {
    expect(careFor('mild')!.showResources).toBe(false);
  });
});

describe('filterProse', () => {
  it('passes a plain reflective sentence', () => {
    expect(filterProse('The shed and the billing system both sound like things you got absorbed in.').pass).toBe(true);
  });
  it.each([
    ['You are a natural teacher.', 'C-09'],
    ['God is telling you to quit.', 'C-30'],
    ['You froze up. That is why you avoid crowds.', 'C-12'],
    ['This sounds like ADHD to me.', 'C-14'],
  ])('blocks %s', (body, rule) => {
    expect(filterProse(body).violations).toContain(rule);
  });
  it('blocks raw JSON leaking through as prose', () => {
    expect(filterProse('{"body":"x"}').violations).toContain('NOT-PROSE');
  });
});

describe('isAskingUs', () => {
  it('catches a faith question', () => {
    expect(isAskingUs('How do I know what God wants me to do?')).toBe(true);
  });
  it('ignores an answer that happens to end in a question mark', () => {
    expect(isAskingUs('pickleball?')).toBe(false);
  });
  it('ignores a statement', () => {
    expect(isAskingUs('I spent Saturday on the shed.')).toBe(false);
  });
});

describe('reply and answer generation', () => {
  const heard = [{ text: 'I spent Saturday rewiring the shed.' }];

  it('returns a clean reply', async () => {
    const p = fixtureProvider(['Rewiring the shed sounds like it took all of Saturday.']);
    expect(await generateReply(p, heard)).toMatch(/shed/);
  });
  it('drops a reply that tells the person who they are', async () => {
    expect(await generateReply(fixtureProvider(['You are a born builder.']), heard)).toBeNull();
  });
  it('drops fixture JSON that fell through from a failed live call', async () => {
    expect(await generateReply(fixtureProvider(['{"body":"fine"}']), heard)).toBeNull();
  });
  it('treats NONE as no reply', async () => {
    expect(await generateReply(fixtureProvider(['NONE']), heard)).toBeNull();
  });

  const good = JSON.stringify({
    body: 'Leaving a job is something you may want to prayerfully consider. One reading is that discernment is slow.',
    kind: 'christian_interpretation',
    scripture: ['Proverbs 3:5-6'],
    questionsToConsider: ['What would stay the same if you left?', 'Who has seen you at your best?'],
    counsel: ['A pastor or a mentor you trust'],
  });

  it('accepts a discernment-framed answer', async () => {
    const a = await generateAnswer(fixtureProvider([good]), 'Should I quit my job?', heard);
    expect(a?.kind).toBe('christian_interpretation');
  });
  it('rejects an answer that speaks for God', async () => {
    const bad = JSON.stringify({ ...JSON.parse(good), body: 'God is telling you to quit your job.' });
    expect(await generateAnswer(fixtureProvider([bad]), 'Should I quit?', heard)).toBeNull();
  });
  it('rejects an invalid kind', async () => {
    const bad = JSON.stringify({ ...JSON.parse(good), kind: 'vibes' });
    expect(await generateAnswer(fixtureProvider([bad]), 'Should I quit?', heard)).toBeNull();
  });
  it('rejects an answer with no way forward', async () => {
    const bad = JSON.stringify({ ...JSON.parse(good), counsel: [] });
    expect(await generateAnswer(fixtureProvider([bad]), 'Should I quit?', heard)).toBeNull();
  });
});

describe('takeConversationTurn', () => {
  const GOOD_SYNTH = JSON.stringify({
    body: 'Both the shed and the billing system involve working something out alongside someone. Worth exploring whether that matters?',
    evidence: ['e1', 'e2'], concreteNouns: ['shed', 'billing system'], kind: 'ai_inference',
  });
  const turnDeps = { provider: fixtureProvider([GOOD_SYNTH]), systemPrompt: 'X', thirdPartyNames: [] };

  it('does nothing extra without a live model', async () => {
    const r = await takeConversationTurn(newSession('u', 's'), 'I spent Saturday rewiring the shed with Tom.', { turn: turnDeps });
    expect(r.output.reply).toBeUndefined();
    expect(r.output.answer).toBeUndefined();
  });

  it('adds a reply when a live model is present', async () => {
    const live = fixtureProvider(['Rewiring the shed took your whole Saturday.']);
    const r = await takeConversationTurn(newSession('u', 's'), 'I spent Saturday rewiring the shed with Tom.', { turn: turnDeps, live });
    expect(r.output.reply).toMatch(/shed/);
  });

  it('answers a faith question without recording it or advancing the gate', async () => {
    const live = fixtureProvider([JSON.stringify({
      body: 'You may want to prayerfully consider it.', kind: 'christian_interpretation', scripture: [],
      questionsToConsider: ['What matters most here?'], counsel: ['A pastor'],
    })]);
    const s = newSession('u', 's');
    const r = await takeConversationTurn(s, 'How do I know what God wants me to do with my job?', { turn: turnDeps, live });
    expect(r.output.answer?.body).toMatch(/prayerfully/);
    expect(r.state.entries).toHaveLength(0);
  });

  it('falls back to a safe line when the answer is blocked', async () => {
    const live = fixtureProvider(['not json']);
    const r = await takeConversationTurn(newSession('u', 's'), 'How do I know what God wants me to do?', { turn: turnDeps, live });
    expect(r.output.answer?.body).toBe(ANSWER_FALLBACK);
  });

  it('never sends distress to the model', async () => {
    let called = false;
    const live = { name: 'anthropic' as const, async complete() { called = true; return 'x'; } };
    const r = await takeConversationTurn(newSession('u', 's'), 'I feel hopeless about all of it', { turn: turnDeps, live });
    expect(called).toBe(false);
    expect(r.output.care?.tier).toBe('elevated');
  });

  it('still hands off on acute language, and adds nothing', async () => {
    const live = fixtureProvider(['x']);
    const r = await takeConversationTurn(newSession('u', 's'), 'I have been thinking about killing myself', { turn: turnDeps, live });
    expect(r.output.kind).toBe('acute');
    expect(r.output.reply).toBeUndefined();
  });

  it('offers one experiment after the first synthesis, and only one', async () => {
    const deps = { turn: { ...turnDeps, provider: fixtureProvider([GOOD_SYNTH]) } };
    let r = await takeConversationTurn(newSession('u', 's'), 'I spent most of Saturday rewiring the shed with Tom.', deps);
    r = await takeConversationTurn(r.state, 'At work people keep coming to me to explain the billing system.', deps);
    expect(r.output.experiment).toBeDefined();
    r = await takeConversationTurn(r.state, 'Another thing happened with the garden this week and it went well.', deps);
    expect(r.output.experiment).toBeUndefined();
  });

  it('respects phase 1 by adding nothing', async () => {
    const live = fixtureProvider(['Rewiring the shed took your whole Saturday.']);
    const r = await takeConversationTurn(newSession('u', 's'), 'I spent Saturday rewiring the shed with Tom.', { turn: turnDeps, live, phase: 1 });
    expect(r.output.reply).toBeUndefined();
  });
});

describe('experiments', () => {
  it('every experiment is small and none count, score or streak', () => {
    for (const x of EXPERIMENTS) expect(x.title).not.toMatch(/streak|badge|points|day \d|every day/i);
  });
  it('skips slack-heavy experiments for someone with limited slack', () => {
    const entries = [e('e1', 'Most evenings are taken up caring for my father.', 'co2'), e('e2', 'I am curious and wonder about it someday.')];
    expect(hasLimitedSlack(entries)).toBe(true);
    expect(pickExperiment(entries).needsSlack).toBe(false);
  });
  it('picks from the person\'s own words', () => {
    expect(pickExperiment([e('e1', 'I fixed the shed and built a garden bed.')]).id).toBe('x3');
  });
  it('a note becomes an entry, a bare feeling does not', () => {
    let s = { ...newSession('u', 's'), experiments: [] as never[] };
    const o = offer(s, EXPERIMENTS[0], new Date());
    s = chooseExperiment(o.state, 'x1', 'accept') as typeof s;
    const bare = recordReflection(s, 'x1', 'more', undefined, new Date());
    expect(bare.entries).toHaveLength(0);
    const noted = recordReflection(s, 'x1', 'more', 'It felt easy to ask.', new Date());
    expect(noted.entries.map((x) => x.text)).toEqual(['It felt easy to ask.']);
  });
});
