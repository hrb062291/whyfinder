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
];

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

export function detectAcuteSignal(text: string): AcuteSignalResult {
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
export function acuteResponse(): {
  stopsExercise: boolean;
  namesConcern: string;
  resources: typeof CRISIS_RESOURCES;
  offersHuman: string;
} {
  return {
    stopsExercise: true,
    namesConcern:
      'What you just said sounds heavy, and I want to stay with it rather than carry on with what we were doing.',
    resources: CRISIS_RESOURCES,
    offersHuman:
      'This sounds like something worth talking through with another person, not with me. Is there someone — a pastor, a counselor, a friend — you could reach today?',
  };
}
