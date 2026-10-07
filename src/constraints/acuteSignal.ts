/**
 * C-06 — acute-signal response. ***PROVISIONAL.***
 *
 * Volume I marks this rule as an assumption, not a decision: the response was
 * inferred from Q02/Q03 rather than chosen. It must be confirmed by the
 * clinical reviewer before it counts as a gate. It has not been.
 *
 * Two failure directions, and they are NOT symmetric:
 *
 *   False negative — real distress is missed. Injures a person.
 *   False positive — lament is treated as crisis. E2 exists because this is
 *                    what stops honest journaling, which removes the only
 *                    thing that made the app useful.
 *
 * Volume I's E2 suite sets a false-positive bar with the clinician. Until one
 * exists, this module errs toward NOT firing on grief in psalm register, and
 * relies on C-05's always-present affordance as the floor.
 */

/**
 * Plain-language acute signals. Deliberately narrow: explicit statements of
 * intent, of inability to continue, or of self-harm.
 */
const ACUTE_PATTERNS: RegExp[] = [
  // Inflections matter. "killing myself" must match as surely as "kill myself" —
  // an earlier version missed it, which is a false negative on the most
  // dangerous statement a user can make. E2 caught it. Keep the (?:ing)?.
  /\b(?:kill|hurt|harm)(?:ing)? myself\b/i,
  /\bend(?:ing)? (?:it all|my life)\b/i,
  /\btak(?:e|ing) my own life\b/i,
  /\b(?:want|going) to die\b/i,
  /\bnot (?:want|wanting) to (?:be here|wake up|exist)\b/i,
  /\bbetter off without me\b/i,
  /\bno (?:point|reason) (?:in )?(?:going on|living|carrying on)\b/i,
  /\bcan(?:'t|not) (?:go on|keep going|do this any ?more)\b/i,
  /\bnothing (?:matters|will ever change)\b/i,
  /\bcan(?:'t|not) (?:get out of bed|function|cope)\b/i,
  /\bhaven(?:'t| not) (?:eaten|slept|left the house) (?:in|for) (?:days|weeks)\b/i,
  /\bsuicid/i,
  /\bself[- ]harm/i,
  /\bend(?:ing)? myself\b/i,
  /\bno reason to (?:live|go on|keep going)\b/i,
  /\bwish (?:i|that i) (?:was|were) dead\b/i,
  /\bwant(?:ed)? to end it\b/i,
];

// ------------------------------------------------------------------ typos and slang
//
// A person in crisis does not proofread. "I want to kill myslef" was missed in a
// live test and got a stock question back: the most dangerous false negative
// there is. Each message is checked as written AND after this normalisation.

/** Optimal string alignment distance: edits plus swapped neighbours ("myslef"). */
function osa(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * Words worth correcting, and how far off they may be. "suicide" allows only one
 * edit, so "subside" (two away) is never read as "suicide".
 */
const CANON: { word: string; max: number }[] = [
  { word: 'myself', max: 2 },
  { word: 'suicide', max: 1 },
  { word: 'suicidal', max: 1 },
  { word: 'killing', max: 1 },
];

export function normalizeForSignal(text: string): string {
  const t = text.toLowerCase().replace(/[‘’]/g, "'")
    .replace(/\bkms\b/g, 'kill myself')
    .replace(/\bunalive\b/g, 'kill')
    .replace(/\bwanna\b/g, 'want to')
    .replace(/\bgonna\b/g, 'going to')
    .replace(/\bkil+\b/g, 'kill')
    .replace(/\bmy\s+(?:self|slef|sefl)\b/g, 'myself');
  return t.replace(/[a-z]+/g, (w) => {
    if (w.length < 4) return w;
    for (const c of CANON) {
      if (w === c.word || w[0] !== c.word[0] || Math.abs(w.length - c.word.length) > c.max) continue;
      if (osa(w, c.word) <= c.max) return c.word;
    }
    return w;
  });
}

/**
 * Lament exemptions. Grief in psalm register — the language of Job and the
 * Psalms — is NOT an acute signal. These phrases, absent an ACUTE_PATTERNS
 * match, must not fire.
 *
 * "I don't know how to go on without her" is grief about a person.
 * "I can't go on" is about the self. The difference is the whole of E2.
 */
const LAMENT_MARKERS: RegExp[] = [
  /\bwithout (?:her|him|them|my \w+)\b/i,
  /\bhow long,? (?:o )?lord\b/i,
  /\bwhy (?:have you|has god) (?:forsaken|abandoned|left)\b/i,
  /\bi miss (?:her|him|them)\b/i,
  /\bgrie(?:f|ving)\b/i,
  /\bmourn(?:ing)?\b/i,
  /\bsince (?:she|he|they) died\b/i,
  /\bthe funeral\b/i,
];

export interface AcuteSignalResult {
  fired: boolean;
  /** Which pattern matched, for the eval harness. Never shown to a user. */
  matched?: string;
  /** True when a lament marker suppressed an otherwise-matching phrase. */
  lamentExempted: boolean;
}

export function detectAcuteSignal(raw: string): AcuteSignalResult {
  const r = detectOn(raw);
  if (r.fired) return r;
  const norm = normalizeForSignal(raw);
  return norm === raw.toLowerCase() ? r : detectOn(norm);
}

function detectOn(text: string): AcuteSignalResult {
  const lamentPresent = LAMENT_MARKERS.some((re) => re.test(text));

  for (const re of ACUTE_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;

    // A lament marker in the same message exempts the softer patterns —
    // "I can't go on without her" is grief, not intent. It never exempts
    // explicit self-harm or suicide language.
    const explicit =
      /(?:\bsuicid|\bself[- ]harm|\b(?:kill|hurt|harm)(?:ing)? myself\b|\bend(?:ing)? my life\b|\btak(?:e|ing) my own life\b)/i.test(
        text,
      );
    if (lamentPresent && !explicit) {
      return { fired: false, lamentExempted: true };
    }
    return { fired: true, matched: m[0], lamentExempted: false };
  }
  return { fired: false, lamentExempted: false };
}

/**
 * Crisis resources — BORROWED VERBATIM, not authored.
 *
 * No clinician is needed to approve words WhyFinder did not write. These are
 * reproduced from the organisations' own published partner language, with
 * attribution. Nothing original appears on this path in DEMO.
 *
 * US-only for the hackathon. International coverage is an open decision.
 */
export const CRISIS_RESOURCES = [
  {
    name: '988 Suicide & Crisis Lifeline',
    contact: 'Call or text 988',
    detail: 'Free, confidential support, 24 hours a day, 7 days a week.',
    source: 'https://988lifeline.org',
  },
  {
    name: 'Crisis Text Line',
    contact: 'Text HOME to 741741',
    detail: 'Free, 24/7 support from a trained crisis counselor.',
    source: 'https://www.crisistextline.org',
  },
  {
    name: 'SAMHSA National Helpline',
    contact: '1-800-662-4357',
    detail: 'Free, confidential, 24/7 treatment referral and information service.',
    source: 'https://www.samhsa.gov/find-help/national-helpline',
  },
];

/**
 * The C-06 response shape. Four musts, three must-nots.
 *
 * MUST:     stop the purpose exercise; name the concern plainly; surface the
 *           crisis line in the conversation; offer a human.
 * MUST NOT: diagnose; label; continue the prior exercise.
 *
 * P-18: warm handoff, never a warning screen. No red interstitial, no
 * "your message has been flagged" — which C-02 bans as copy anyway.
 * C-04: nothing stops, locks or rate-limits. The app stays fully usable.
 */
/**
 * The one verse shown on the crisis path. Fixed, not chosen by a model, and the
 * text is exactly what the YouVersion API returned for this reference in the
 * Berean Standard Bible (public domain), so it works with no network at all.
 */
export const CRISIS_VERSE = {
  reference: 'Psalm 34:18',
  text: 'The Lord is near to the brokenhearted; He saves the contrite in spirit.',
  version: 'BSB',
  versionTitle: 'Berean Standard Bible',
  copyright: 'Public Domain',
  link: 'https://www.bible.com/versions/3034',
};

/** Also exactly as YouVersion returned it (BSB). A psalm that prays loneliness out loud. */
export const LONELY_VERSE = {
  ...CRISIS_VERSE,
  reference: 'Psalm 25:16',
  text: 'Turn to me and be gracious, for I am lonely and afflicted.',
};

/**
 * What the person has been talking about. Read from what they said, so the
 * crisis response can meet them where they are. The safety parts (stop, name
 * it, 988, a real person, "this is beyond an app") never change.
 */
export type CrisisContext = 'grief' | 'family' | 'lonely' | 'general';

const GRIEF = /\b(?:died|dying|passed away|passed on|lost my|losing my|loss of|funeral|grave|death of|since (?:she|he|they|my \w+) (?:died|passed)|miss (?:my|her|him) so)\b/i;
const FAMILY = /\b(?:parents?|mom|mum|dad|mother|father|stepdad|stepmom|family|brother|sister)\b/i;
const CONFLICT = /\b(?:argu\w*|fight\w*|fought|yell\w*|scream\w*|angry|mad at|hate|lectur\w*|(?:don'?t|never|won'?t) (?:listen|hear me|understand)|kicked me out)\b/i;
const LONELY = /\b(?:lone?l(?:y|iness)|alone|isolated|no friends|no one (?:cares|talks|to talk)|nobody (?:cares|talks|to talk)|left out|invisible)\b/i;

export function crisisContext(texts: string[]): CrisisContext {
  const recent = texts.slice(-6);
  const all = recent.join(' \n ');
  if (GRIEF.test(all)) return 'grief';
  if (recent.some((t) => FAMILY.test(t) && CONFLICT.test(t)) || (FAMILY.test(all) && CONFLICT.test(all))) return 'family';
  if (LONELY.test(all)) return 'lonely';
  return 'general';
}

/**
 * WhyFinder is not a crisis service. The first time, it says so warmly, points to
 * people and keeps the door open. If the person comes back to it, the wording
 * gets plainer and shorter, and it never repeats a hotline on ordinary turns.
 * ALL OF THIS COPY IS AUTHORED AND UNREVIEWED: it needs clinical and pastoral review.
 */
const OPENING: Record<CrisisContext, string> = {
  general: 'I’m really glad you told me.',
  grief: 'I’m so sorry about who you have lost, and I’m really glad you told me this.',
  family: 'It sounds like things at home have been really hard, and I’m really glad you told me.',
  lonely: 'Feeling this alone can make everything look darker, and I’m really glad you told me.',
};

/** Who to reach. At home the conflict may be with a parent, so a parent is not the first name offered. */
const REACH: Record<CrisisContext, string> = {
  general: 'a pastor, a counselor, a friend or family member',
  grief: 'a family member, a pastor, a counselor or a friend',
  family: 'a relative you trust, a pastor, a school counselor or a friend',
  lonely: 'a pastor, a counselor, a relative or anyone you trust, even someone you have not talked to in a while',
};

/** The first time: the team's own words. */
export const FIRST_MESSAGE =
  'I want to take a moment to remind you that we’re not a licensed psychologist or pastor, but we still care about your well-being. Having these feelings is normal and a part of your journey. A big part is remembering that we are meant for community. We are not meant to walk the world alone. We encourage you to reach out if your thoughts are feeling too heavy to carry alone.';

export const FIRST_CLOSING = 'Would you like to keep talking? I’ll be right here.';

/** The second time: plainer, and it says this conversation is not the place for it. */
export const SECOND_MESSAGE =
  'We are not licensed for counseling, and it is not what this app is for. We believe in real human interaction for thoughts of this nature. We see you and are glad that you’re here sharing this with us. The first step in traveling outside this season and these feelings is reaching out. Humans are not meant to go through life alone and are meant to support one another. Here are people that care about you and want to help. We’re here when you’re ready to continue, but we strongly encourage you to take that next step.';

/** The third time and every time after. */
export const REPEAT_MESSAGE =
  'Here are people that care about you and want to help. We’re here when you’re ready to continue, but we strongly encourage you to take that next step.';

export function acuteResponse(context: CrisisContext = 'general', count = 1): {
  stopsExercise: boolean;
  namesConcern: string;
  resources: typeof CRISIS_RESOURCES;
  offersHuman: string;
  /** The main message. AUTHORED, UNREVIEWED: needs pastoral and clinical review. */
  faith: string;
  verse?: typeof CRISIS_VERSE;
  closing?: string;
  context: CrisisContext;
  /** How many times this has come up in this conversation: 1, 2, or 3 and after. */
  level: 1 | 2 | 3;
} {
  if (count >= 3) {
    return {
      stopsExercise: true, namesConcern: REPEAT_MESSAGE, resources: CRISIS_RESOURCES,
      offersHuman: '', faith: '', context, level: 3,
    };
  }
  if (count === 2) {
    return {
      stopsExercise: true, namesConcern: SECOND_MESSAGE, resources: CRISIS_RESOURCES,
      offersHuman: '', faith: '', context, level: 2,
    };
  }
  return {
    stopsExercise: true,
    namesConcern: OPENING[context],
    resources: CRISIS_RESOURCES,
    faith: FIRST_MESSAGE,
    // C-06: the crisis line appears once, here. It is not repeated on later turns.
    offersHuman: `Please reach out to someone you trust today: ${REACH[context]}. If you are in danger right now, call or text 988, or call 911.`,
    verse: context === 'lonely' ? LONELY_VERSE : CRISIS_VERSE,
    closing: FIRST_CLOSING,
    context,
    level: 1,
  };
}