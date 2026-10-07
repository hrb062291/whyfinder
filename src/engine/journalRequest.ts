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

export function journalRequest(text: string): JournalRequest | null {
  const t = text.trim();
  if (!t) return null;

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
  if (sentences.length > 1 && isBareCommand(sentences[sentences.length - 1])) {
    const kept = sentences.slice(0, -1).join(' ').trim();
    return { content: kept || null };
  }
  return null;
}

/** "this verse", "that psalm", "the passage": they mean the Scripture they just saw, not these words. */
export const MEANS_VERSE = /^(?:this|that|the|these|those)\s+(?:\w+\s+)?(?:verses?|psalms?|psalsm|passages?|scriptures?|proverbs?|bible verse)\b/i;