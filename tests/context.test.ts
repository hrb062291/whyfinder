import { describe, expect, it } from 'vitest';
import { acuteResponse, crisisContext } from '../src/constraints/acuteSignal.js';
import {
  ALREADY_KNOW, followUpPrompt, generateReply, repeatsItself, replyPrompt, takeConversationTurn,
} from '../src/engine/conversation.js';
import { newSession } from '../src/engine/session.js';
import { fixtureProvider } from '../src/providers/index.js';

const turnDeps = { provider: fixtureProvider(['']), systemPrompt: 'X', thirdPartyNames: [] };

describe('the crisis response fits what they have been going through', () => {
  it.each([
    [['My mom died in March.', 'I want to kill myself'], 'grief'],
    [['since my brother passed away nothing feels right', 'i want to die'], 'grief'],
    [["I've been angry at my parents, they never listen", 'I want to kill myslef'], 'family'],
    [['I feel so lonely, I have no friends here', 'I want to end it'], 'lonely'],
    [['work has been a lot', 'I want to kill myself'], 'general'],
  ])('%j -> %s', (texts, ctx) => {
    expect(crisisContext(texts as string[])).toBe(ctx);
  });

  it('each context gets its own opening, people and verse, and the same safety core', () => {
    const grief = acuteResponse('grief');
    const lonely = acuteResponse('lonely');
    const family = acuteResponse('family');
    const general = acuteResponse('general');
    expect(grief.namesConcern).toMatch(/lost/);
    expect(lonely.namesConcern).toMatch(/alone/);
    expect(family.namesConcern).toMatch(/home/);
    expect(new Set([grief.faith, lonely.faith, family.faith, general.faith]).size).toBe(4);
    expect(lonely.verse.reference).toBe('Psalm 25:16');
    expect(grief.verse.reference).toBe('Psalm 34:18');
    // At home the conflict may be with a parent, so a parent is not the first person named.
    expect(family.offersHuman).not.toMatch(/a parent/);
    for (const r of [grief, lonely, family, general]) {
      expect(r.offersHuman).toMatch(/beyond what a conversation with an app/);
      expect(r.offersHuman).toMatch(/988/);
      expect(r.offersHuman).toMatch(/911/);
      expect(r.faith).toMatch(/you are loved/i);
      expect(JSON.stringify(r)).not.toMatch(/\bpurpose\b|\bflagged\b|\bdiagnos/i);
    }
  });

  it('the engine uses the context from earlier messages', async () => {
    const live = () => ({ turn: turnDeps, live: fixtureProvider(['NONE', 'NONE']) });
    let r = await takeConversationTurn(newSession('u', 's'), 'My dad passed away last month and I keep thinking about him.', live());
    r = await takeConversationTurn(r.state, 'i want to kill myself', live());
    expect(r.output.kind).toBe('acute');
    expect((r.output as { response: { context: string } }).response.context).toBe('grief');
  });
});

describe('not repeating itself', () => {
  const prior = ['Feeling that lonely is hard. It might be worth trying to find a community, like a small group at a church.'];

  it('recognises "I already know"', () => {
    for (const t of ['I understand about community', 'yeah i know', 'you said that already', "I've already tried that"]) {
      expect(ALREADY_KNOW.test(t)).toBe(true);
    }
    expect(ALREADY_KNOW.test('I want to know more about prayer')).toBe(false);
  });

  it('rejects the same suggestion again after "I understand about community"', () => {
    expect(repeatsItself('You might try joining a community or small group at church.', prior, 'I understand about community.')).toBe(true);
  });

  it('allows asking about it instead', () => {
    expect(repeatsItself('What makes finding a community hard for you right now?', prior, 'I understand about community.')).toBe(false);
    expect(repeatsItself('That makes sense. What has gotten in the way so far?', prior, 'I understand about community.')).toBe(false);
  });

  it('rejects a near copy of an earlier line', () => {
    expect(repeatsItself('It might be worth trying to find a community, like a small group at church.', prior)).toBe(true);
    expect(repeatsItself('Saturday with Tom sounds like a good day.', prior)).toBe(false);
  });

  it('tells the model what it already said, and that they already know', () => {
    const p = replyPrompt([{ text: 'I feel lonely' }, { text: 'I understand about community' }], prior);
    expect(p).toContain('already said');
    expect(p).toContain('small group at a church');
    expect(p).toMatch(/Do NOT suggest it again/);
    expect(followUpPrompt([{ text: 'I feel lonely' }], prior)).toContain('already said');
    expect(replyPrompt([{ text: 'hi there' }])).not.toContain('already said');
  });

  it('a repeated reply is dropped', async () => {
    const heard = [{ text: 'I feel lonely' }, { text: 'I understand about community.' }];
    expect(await generateReply(fixtureProvider(['You might try joining a community or small group.']), heard, prior)).toBeNull();
  });

  it('in a conversation, the second turn does not repeat the first', async () => {
    const s1 = { turn: turnDeps, live: fixtureProvider([prior[0], 'NONE']) };
    let r = await takeConversationTurn(newSession('u', 's'), 'I have been feeling really lonely since I moved here.', s1);
    expect(r.state.said?.join(' ')).toMatch(/community/);
    const s2 = { turn: turnDeps, live: fixtureProvider(['You might try joining a community or a small group at church.', 'What makes finding a community hard right now?']) };
    r = await takeConversationTurn(r.state, 'I understand about community.', s2);
    const o = r.output as { reply?: string; text?: string };
    expect(o.reply ?? '').not.toMatch(/try joining a community/);
    expect(o.text).toBe('What makes finding a community hard right now?');
  });

  it('the gentle line and the 988 line do not repeat word for word', async () => {
    const live = () => ({ turn: turnDeps, live: fixtureProvider(['NONE', 'NONE']) });
    let r = await takeConversationTurn(newSession('u', 's'), 'work is a lot', live());
    r = await takeConversationTurn(r.state, 'i want to kill myself', live());
    const cares: string[] = [];
    const texts: string[] = [];
    for (const m of ['idk', 'it just hurts', 'everything hurts']) {
      r = await takeConversationTurn(r.state, m, live());
      const o = r.output as { text?: string; care?: { text: string } };
      cares.push(o.care?.text ?? '');
      texts.push(o.text ?? '');
    }
    expect(cares.every((c) => /988/.test(c))).toBe(true);
    for (let i = 1; i < cares.length; i++) expect(cares[i]).not.toBe(cares[i - 1]);
    for (let i = 1; i < texts.length; i++) expect(texts[i]).not.toBe(texts[i - 1]);
  });
});