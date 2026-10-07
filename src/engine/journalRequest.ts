/**
 * "Add this to my journal." Recognises when a person asks to keep something,
 * and works out what they want kept. Pure and side-effect free: the browser
 * calls it before anything is sent, so a save request never reaches the model
 * and never becomes part of the conversation the app reflects on.
 *
 *   journalRequest("add this to my journal")            -> { content: null }   (keep what I said before)
 *   journalRequest("save to my journal: call my sister") -> { content: "call my sister" }
 *   journalRequest("I miss my dad. Add this to my journal.") -> { content: "I miss my dad." }
 *   journalRequest("my family is important to me")      -> null               (not a request)
 */

export type JournalRequest = { content: string | null };

/** Commands that may be followed by what to keep ("save to my journal: ..."). */
const LEADING: RegExp[] = [
  // add / save / put this to my journal
  /^(?:please\s+|can you\s+|could you\s+)?(?:add|save|put|keep|write)\s+(?:this|that|it)\s+(?:to|in|into|on)\s+(?:my|the)\s+journal\b/i,
  // add to my journal
  /^(?:please\s+|can you\s+|could you\s+)?(?:add|save|put|write)\s+(?:to|in|into)\s+(?:my|the)\s+journal\b/i,
  // journal this
  /^journal\s+(?:this|that)\b/i,
];

/** Short commands that only count when nothing else follows, or a colon does. */
const BARE: RegExp[] = [
  /^(?:please\s+)?(?:save|remember)\s+(?:this|that)\b/i,
  /^(?:this|that)\s+(?:is|was|feels)\s+(?:really\s+|very\s+|so\s+)?(?:important|meaningful)\s+to\s+me\b/i,
  /^(?:please\s+)?(?:add|save)\s+(?:this|that)\b/i,
];

const TRAIL = /[\s.!,]*(?:please|thanks|thank you)?[\s.!]*$/i;

function tidy(s: string): string {
  return s.replace(/^[\s:,\-–—.!]+/, '').replace(TRAIL, '').trim();
}

/** Is this whole sentence a save command with nothing to keep in it? */
function isBareCommand(sentence: string): boolean {
  const s = sentence.trim();
  for (const re of [...LEADING, ...BARE]) {
    const m = s.match(re);
    if (m && tidy(s.slice(m[0].length)) === '') return true;
  }
  return false;
}

/**
 * "I'd like to add first Peter to my journal", "can you put Psalm 23 in my journal".
 * What to keep sits between the verb and "journal". Typos like "ad" count. The
 * message must end at "journal", so "I want to put my thoughts in my journal
 * more often" is something they are saying, not a request.
 */
const MIDDLE =
  /^(?:(?:i'?d like to|i would like to|i want(?:ed)? to|can you|could you|will you|can i|could i|may i|let me|i'?ll|please|pls|plz)\s+)?(?:add|ad|save|put|keep|write)\s+(.{1,200}?)\s+(?:to|in|into|on)\s+(?:my|the)\s+journal[\s.!?]*(?:please|thanks|thank you)?[\s.!?]*$/i;

/**
 * "Can I save that verse?", "add Colossians verse", "keep this passage". No word
 * "journal" needed: asking to save a verse can only mean the journal. The whole
 * message must be the request, so "I want to keep that verse in mind" is not one.
 */
const VERSE_SAVE =
  /^(?:(?:can|could|may)\s+i\s+|(?:can|could|will)\s+you\s+|please\s+|i'?d like to\s+|i would like to\s+|i want(?:ed)? to\s+|let me\s+)?(?:save|keep|add|ad|store)\s+((?:(?:this|that|the|these|those)\s+)?(?:[a-z0-9:\-]+\s+){0,3}?(?:verses?|passages?|psalms?|scriptures?|proverbs?|bible verses?))(?:\s+(?:please|for me|for later))?[\s.!?]*$/i;

/** "can I save Ecclesiastes 4:9-10", "add Psalm 23", "keep 1 John 4:18 please". */
const REF_SAVE =
  /^(?:(?:can|could|may)\s+i\s+|(?:can|could|will)\s+you\s+|please\s+|i'?d like to\s+|i would like to\s+|i want(?:ed)? to\s+|let me\s+)?(?:save|keep|add|ad|store)\s+((?:[1-3]\s*)?[a-z]{2,}(?:\s+of\s+[a-z]+)?\s+\d{1,3}(?::\d{1,3}(?:\s*[-\u2013]\s*\d{1,3})?)?)(?:\s+(?:please|for me|for later))?[\s.!?]*$/i;

export function journalRequest(text: string): JournalRequest | null {
  const t = text.trim();
  if (!t) return null;

  const vs = t.match(VERSE_SAVE);
  if (vs) return { content: vs[1].trim() };
  const rs = t.match(REF_SAVE);
  if (rs) return { content: rs[1].trim() };

  const mid = t.match(MIDDLE);
  if (mid) {
    const what = mid[1].trim();
    return { content: /^(?:this|that|it|this one|that one|what i said)$/i.test(what) ? null : what };
  }

  // "add to my journal: ..." or "add this to my journal"
  for (const re of LEADING) {
    const m = t.match(re);
    if (!m) continue;
    const rest = tidy(t.slice(m[0].length));
    return { content: rest || null };
  }

  // "save this", "this is important to me", or "remember this: ..."
  for (const re of BARE) {
    const m = t.match(re);
    if (!m) continue;
    const after = t.slice(m[0].length);
    if (tidy(after) === '') return { content: null };
    if (/^\s*[:\-–—]/.test(after)) return { content: tidy(after) || null };
    // "This is important to me because..." is something they are saying, not a request.
    return null;
  }

  // "I miss my dad. Add this to my journal."
  const sentences = t.split(/(?<=[.!?])\s+/);
  const lastOne = sentences[sentences.length - 1];
  const lastMid = sentences.length > 1 ? lastOne.trim().match(MIDDLE) : null;
  // "Ecclesiastes 4:9-12. I would like to add this to my journal."
  if (lastMid && /^(?:this|that|it|this one|that one)$/i.test(lastMid[1].trim())) {
    const kept = sentences.slice(0, -1).join(' ').trim();
    return { content: kept || null };
  }
  if (sentences.length > 1 && isBareCommand(lastOne)) {
    const kept = sentences.slice(0, -1).join(' ').trim();
    return { content: kept || null };
  }
  return null;
}

/** "this verse", "that psalm", "the passage": they mean the Scripture they just saw, not these words. */
export const MEANS_VERSE = /^(?:this|that|the|these|those)\s+(?:\w+\s+)?(?:verses?|psalms?|psalsm|passages?|scriptures?|proverbs?|bible verse)\b/i;

export type ShownPassage = { reference: string; version: string; text: string };

const VERSE_WORD = /\s*\b(?:bible\s+)?(?:verses?|passages?|psalms?|scriptures?|proverbs?)\s*$/i;
const squash = (x: string) => x.replace(/[.!?,\s]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Which passage(s) they mean, from what was shown (newest group first):
 * "Colossians 3:23" -> that passage; "colossionons verse" -> the passage whose
 * book starts the same way; "that verse" -> the latest passage(s) shown.
 * Null when it is not about a passage at all.
 */
export function pickPassages(content: string | null, groups: ShownPassage[][]): ShownPassage[] | null {
  if (!content || groups.length === 0) return null;
  const c = squash(content);
  const all = groups.flat();
  if (/\d/.test(c) && c.length <= 40) {
    const exact = all.find((p) => squash(p.reference) === c);
    if (exact) return [exact];
  }
  const aboutVerse = MEANS_VERSE.test(content) || VERSE_WORD.test(content);
  if (!aboutVerse) return null;
  const name = c.replace(/^(?:this|that|the|these|those)\s+/, '').replace(VERSE_WORD, '').trim();
  if (name && !/^(?:one|bible|last|first)$/.test(name) && name.length >= 3) {
    const key = name.replace(/^(\d)\s*/, '$1 ').slice(0, 4);
    const byBook = all.find((p) => p.reference.toLowerCase().startsWith(key));
    if (byBook) return [byBook];
    if (!MEANS_VERSE.test(content)) return null;
  }
  return groups[0];
}