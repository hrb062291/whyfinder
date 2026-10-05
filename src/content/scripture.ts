/**
 * Real verse text, from YouVersion.
 *
 * The model only ever writes REFERENCES ("Romans 12:2"). It is told never to
 * quote a verse, because models misquote Scripture. This module takes each
 * reference, asks YouVersion for the actual text, and returns it with the version
 * name and copyright YouVersion requires on display.
 *
 * What goes over the wire: a reference and an app key. None of the person's
 * words ever reach YouVersion.
 *
 * Failure is quiet by design. If the key is missing, the reference cannot be
 * parsed, or YouVersion is slow or down, the answer still shows its plain
 * references. Verse text is a nicety on top of the answer, never a dependency.
 *
 * The prose filter judges the APP's words. Quoted Scripture is YouVersion's
 * text, shown under its own reference and version, labelled as what the Bible
 * says (C-29), so it is deliberately not run through filterProse.
 *
 * API: GET https://api.youversion.com/v1/bibles/{id}/passages/{USFM}
 *        -> { id, content, reference }
 *      GET https://api.youversion.com/v1/bibles/{id}
 *        -> { abbreviation, title, copyright, youversion_deep_link, ... }
 *      Header: X-YVP-App-Key (an app key is not a secret).
 */

export interface Passage {
  /** For example "Romans 12:2". */
  reference: string;
  text: string;
  /** For example "BSB". */
  version: string;
  versionTitle: string;
  /** Publisher copyright, shown with the text. */
  copyright: string;
  link?: string;
  /** True when the text was shortened. */
  truncated: boolean;
}

export interface YvConfig {
  appKey: string;
  /** 3034 is the Berean Standard Bible, which is public domain. */
  bibleId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const DEFAULT_BIBLE_ID = '3034';
const BASE = 'https://api.youversion.com/v1';
const MAX_CHARS = 1200;

// ------------------------------------------------------------------ references

const BOOKS: [string, string[]][] = [
  ['GEN', ['genesis', 'gen']], ['EXO', ['exodus', 'exod', 'ex']],
  ['LEV', ['leviticus', 'lev']], ['NUM', ['numbers', 'num']],
  ['DEU', ['deuteronomy', 'deut']], ['JOS', ['joshua', 'josh']],
  ['JDG', ['judges', 'judg']], ['RUT', ['ruth']],
  ['1SA', ['1 samuel', '1 sam']], ['2SA', ['2 samuel', '2 sam']],
  ['1KI', ['1 kings']], ['2KI', ['2 kings']],
  ['1CH', ['1 chronicles', '1 chron']], ['2CH', ['2 chronicles', '2 chron']],
  ['EZR', ['ezra']], ['NEH', ['nehemiah', 'neh']], ['EST', ['esther']],
  ['JOB', ['job']], ['PSA', ['psalms', 'psalm', 'ps']],
  ['PRO', ['proverbs', 'prov']], ['ECC', ['ecclesiastes', 'eccl']],
  ['SNG', ['song of solomon', 'song of songs', 'song']],
  ['ISA', ['isaiah', 'isa']], ['JER', ['jeremiah', 'jer']],
  ['LAM', ['lamentations', 'lam']], ['EZK', ['ezekiel', 'ezek']],
  ['DAN', ['daniel', 'dan']], ['HOS', ['hosea']], ['JOL', ['joel']],
  ['AMO', ['amos']], ['OBA', ['obadiah']], ['JON', ['jonah']],
  ['MIC', ['micah']], ['NAM', ['nahum']], ['HAB', ['habakkuk']],
  ['ZEP', ['zephaniah']], ['HAG', ['haggai']], ['ZEC', ['zechariah']],
  ['MAL', ['malachi']],
  ['MAT', ['matthew', 'matt']], ['MRK', ['mark']], ['LUK', ['luke']],
  ['JHN', ['john']], ['ACT', ['acts']], ['ROM', ['romans', 'rom']],
  ['1CO', ['1 corinthians', '1 cor']], ['2CO', ['2 corinthians', '2 cor']],
  ['GAL', ['galatians', 'gal']], ['EPH', ['ephesians', 'eph']],
  ['PHP', ['philippians', 'phil']], ['COL', ['colossians', 'col']],
  ['1TH', ['1 thessalonians', '1 thess']], ['2TH', ['2 thessalonians', '2 thess']],
  ['1TI', ['1 timothy', '1 tim']], ['2TI', ['2 timothy', '2 tim']],
  ['TIT', ['titus']], ['PHM', ['philemon']], ['HEB', ['hebrews', 'heb']],
  ['JAS', ['james']], ['1PE', ['1 peter', '1 pet']], ['2PE', ['2 peter', '2 pet']],
  ['1JN', ['1 john']], ['2JN', ['2 john']], ['3JN', ['3 john']],
  ['JUD', ['jude']], ['REV', ['revelation', 'revelations', 'rev']],
];

const BOOK_INDEX = new Map<string, string>();
for (const [code, names] of BOOKS) for (const n of names) BOOK_INDEX.set(n, code);

function normaliseBook(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\bfirst\b/, '1')
    .replace(/\bsecond\b/, '2')
    .replace(/\bthird\b/, '3')
    .replace(/^([123])\s*/, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ParsedRef { usfm: string }

/**
 * "Romans 12:2" -> ROM.12.2, "Proverbs 3:5-6" -> PRO.3.5-6, "Psalm 23" -> PSA.23.
 * Anything that spans chapters, or that is not a known book, returns null.
 */
export function parseReference(ref: string): ParsedRef | null {
  const m = ref.trim().match(
    /^((?:[1-3]|first|second|third)?\s*[A-Za-z][A-Za-z .']*?)\s+(\d{1,3})(?::(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)?$/i,
  );
  if (!m) return null;
  const code = BOOK_INDEX.get(normaliseBook(m[1]));
  if (!code) return null;
  const [, , ch, v1, v2] = m;
  if (!v1) return { usfm: `${code}.${ch}` };
  if (v2 && Number(v2) <= Number(v1)) return null;
  return { usfm: v2 ? `${code}.${ch}.${v1}-${v2}` : `${code}.${ch}.${v1}` };
}

// ------------------------------------------------------------------ fetching

interface BibleMeta { abbreviation: string; title: string; copyright: string; link?: string }
const metaCache = new Map<string, Promise<BibleMeta | null>>();

/** Test hook. */
export function clearScriptureCache(): void {
  metaCache.clear();
}

async function getJson(url: string, cfg: YvConfig): Promise<unknown | null> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 6000);
  try {
    const res = await doFetch(url, {
      headers: { 'X-YVP-App-Key': cfg.appKey, Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (!res.ok) {
      console.warn('[whyfinder] scripture:', res.status, url.replace(BASE, ''));
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[whyfinder] scripture failed:', e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function getMeta(bibleId: string, cfg: YvConfig): Promise<BibleMeta | null> {
  const hit = metaCache.get(bibleId);
  if (hit) return hit;
  const p = getJson(`${BASE}/bibles/${bibleId}`, cfg).then((j): BibleMeta | null => {
    const o = j as Record<string, unknown> | null;
    if (!o || typeof o.abbreviation !== 'string' || typeof o.copyright !== 'string') return null;
    return {
      abbreviation: o.abbreviation,
      title: typeof o.title === 'string' ? o.title : o.abbreviation,
      copyright: o.copyright,
      link: typeof o.youversion_deep_link === 'string' ? o.youversion_deep_link : undefined,
    };
  });
  metaCache.set(bibleId, p);
  // A failure must not stick. Try again next time.
  void p.then((m) => { if (!m) metaCache.delete(bibleId); });
  return p;
}

function tidy(text: string): { text: string; truncated: boolean } {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= MAX_CHARS) return { text: t, truncated: false };
  const cut = t.slice(0, MAX_CHARS);
  return { text: `${cut.slice(0, cut.lastIndexOf(' '))}…`, truncated: true };
}

/** One reference to one passage. Never throws; null means "show the plain reference". */
export async function fetchPassage(ref: string, cfg: YvConfig): Promise<Passage | null> {
  const parsed = parseReference(ref);
  if (!parsed || !cfg.appKey) return null;
  const bibleId = cfg.bibleId || DEFAULT_BIBLE_ID;
  const [pj, meta] = await Promise.all([
    getJson(`${BASE}/bibles/${bibleId}/passages/${parsed.usfm}?format=text`, cfg),
    getMeta(bibleId, cfg),
  ]);
  const p = pj as Record<string, unknown> | null;
  if (!p || typeof p.content !== 'string' || !p.content.trim() || !meta) return null;
  const { text, truncated } = tidy(p.content);
  return {
    reference: typeof p.reference === 'string' ? p.reference : ref,
    text,
    version: meta.abbreviation,
    versionTitle: meta.title,
    copyright: meta.copyright,
    link: meta.link,
    truncated,
  };
}

/** Several references at once. Keeps the model's order and drops the ones that failed. */
export async function fetchPassages(refs: string[], cfg: YvConfig): Promise<Passage[]> {
  const got = await Promise.all(refs.slice(0, 4).map((r) => fetchPassage(r, cfg)));
  return got.filter((p): p is Passage => p !== null);
}