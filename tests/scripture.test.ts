import { beforeEach, describe, expect, it } from 'vitest';
import { clearScriptureCache, fetchPassage, fetchPassages, parseReference } from '../src/content/scripture.js';
import { takeConversationTurn } from '../src/engine/conversation.js';
import { newSession } from '../src/engine/session.js';
import { fixtureProvider } from '../src/providers/index.js';

const META = { id: 3034, abbreviation: 'BSB', title: 'Berean Standard Bible', copyright: 'Public domain.', youversion_deep_link: 'https://www.bible.com/bible/3034' };
const okJson = (o: unknown) => ({ ok: true, status: 200, json: async () => o }) as Response;

function mockFetch(calls: { url: string; headers: Record<string, string> }[] = []) {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    if (/\/passages\//.test(url)) {
      if (/ROM\.12\.2/.test(url)) return okJson({ id: 'ROM.12.2', reference: 'Romans 12:2', content: 'Do not conform to this age,   but be transformed.' });
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }
    return okJson(META);
  }) as unknown as typeof fetch;
}

beforeEach(() => clearScriptureCache());

describe('parseReference', () => {
  it.each([
    ['Romans 12:2', 'ROM.12.2'], ['Proverbs 3:5-6', 'PRO.3.5-6'], ['Psalm 23', 'PSA.23'],
    ['1 Corinthians 13:4', '1CO.13.4'], ['First John 4:8', '1JN.4.8'], ['Song of Solomon 2:4', 'SNG.2.4'],
    ['Philippians 4:6–7', 'PHP.4.6-7'], ['Jer 29:11', 'JER.29.11'],
  ])('%s', (ref, usfm) => expect(parseReference(ref)?.usfm).toBe(usfm));
  it.each(['Hezekiah 1:1', 'Romans 12:2-3:4', 'Romans', 'Romans 12:5-2', ''])('rejects %s', (r) => {
    expect(parseReference(r)).toBeNull();
  });
});

describe('fetchPassage', () => {
  it('returns real text with version and copyright, sending only the key and the reference', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const p = await fetchPassage('Romans 12:2', { appKey: 'K', fetchImpl: mockFetch(calls) });
    expect(p?.text).toBe('Do not conform to this age, but be transformed.');
    expect(p?.version).toBe('BSB');
    expect(p?.copyright).toBe('Public domain.');
    expect(calls.every((c) => c.headers['X-YVP-App-Key'] === 'K')).toBe(true);
    expect(calls.some((c) => c.url.endsWith('/bibles/3034/passages/ROM.12.2?format=text'))).toBe(true);
  });
  it('is off without a key', async () => {
    expect(await fetchPassage('Romans 12:2', { appKey: '', fetchImpl: mockFetch() })).toBeNull();
  });
  it('returns null on 404, bad reference, or a thrown fetch', async () => {
    expect(await fetchPassage('John 99:99', { appKey: 'K', fetchImpl: mockFetch() })).toBeNull();
    expect(await fetchPassage('nonsense', { appKey: 'K', fetchImpl: mockFetch() })).toBeNull();
    const boom = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await fetchPassage('Romans 12:2', { appKey: 'K', fetchImpl: boom })).toBeNull();
  });
  it('truncates long passages', async () => {
    const long = (async (url: string) => okJson(/passages/.test(url)
      ? { reference: 'Psalm 119', content: 'word '.repeat(600) } : META)) as unknown as typeof fetch;
    const p = await fetchPassage('Psalm 119', { appKey: 'K', fetchImpl: long });
    expect(p?.truncated).toBe(true);
    expect(p!.text.length).toBeLessThanOrEqual(1201);
  });
  it('keeps the ones that worked', async () => {
    const ps = await fetchPassages(['Romans 12:2', 'John 99:99'], { appKey: 'K', fetchImpl: mockFetch() });
    expect(ps.map((p) => p.reference)).toEqual(['Romans 12:2']);
  });
});

describe('verses in a faith answer', () => {
  const answer = JSON.stringify({
    body: 'Many Christians see work as one place to serve. It is worth weighing slowly.',
    kind: 'christian_interpretation', scripture: ['Romans 12:2'],
    questionsToConsider: ['What does this job give others?', 'What would you miss?'],
    counsel: ['A pastor or mentor you trust'],
  });
  const deps = (scripture?: { appKey: string; fetchImpl: typeof fetch }) => ({
    turn: { provider: fixtureProvider(['']), systemPrompt: 'X', thirdPartyNames: [] },
    live: fixtureProvider([answer]), scripture,
  });
  it('attaches passages when configured', async () => {
    const r = await takeConversationTurn(newSession('u', 's'), 'How do I know what God wants me to do with my job?',
      deps({ appKey: 'K', fetchImpl: mockFetch() }));
    expect(r.output.answer?.passages?.[0].text).toMatch(/transformed/);
  });
  it('shows plain references without a key', async () => {
    const r = await takeConversationTurn(newSession('u', 's'), 'How do I know what God wants me to do with my job?', deps());
    expect(r.output.answer?.passages).toBeUndefined();
    expect(r.output.answer?.scripture).toEqual(['Romans 12:2']);
  });
});