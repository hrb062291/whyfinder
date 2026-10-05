/**
 * The support path.
 *
 * concernTier.ts judges one message at a time. This module adds the two things
 * that were missing for someone who is struggling but not in crisis:
 *
 *   1. A running count across the session. "Stuck", then "anxious", then "I need
 *      help" is a pattern that no single message shows.
 *   2. One clear card that points to PEOPLE (a counselor or doctor, a pastor or
 *      small group, one person who knows them), and a pause in the question
 *      bank, guess cards and experiments while that is going on.
 *
 * Rules this keeps:
 *   - The count is a number, lives in the session state the browser already
 *     carries, and is never stored, exported or sent anywhere (C-03, C-19).
 *   - The card says so out loud. It is visible, not hidden.
 *   - No diagnosis and no clinical label (C-14). The app never says what the
 *     person has, only that people nearby can help.
 *   - Distress never goes through a model for the card itself. It is fixed text.
 *   - Acute language is untouched. That is takeTurn's own path.
 *
 * ALL COPY BELOW IS AUTHORED, NOT BORROWED, so it needs clinician and pastoral
 * review before BETA, like the rest of the C-06 path.
 */

import type { ConcernTier } from './concernTier.js';

/** Weight needed before the support card appears. Once per session. */
export const SUPPORT_THRESHOLD = 3;

export interface SupportState {
  /** A number only. Never the words that produced it. */
  score: number;
  /** The card has been shown this session. It is shown once. */
  shown: boolean;
  /** Questions, guesses and experiments are paused until the person goes back. */
  active: boolean;
}

export function emptySupport(): SupportState {
  return { score: 0, shown: false, active: false };
}

// ------------------------------------------------------------------ signals

/** Language of strain, in the person's own register. Weight 2. */
const STRONG: RegExp[] = [
  /\banxi(?:ety|ous)\b/i,
  /\bpanic(?:king|ked| attacks?)?\b/i,
  /\bdepress(?:ed|ion|ing)\b/i,
  /\bcan'?t (?:cope|breathe|sleep|focus|stop worrying|handle (?:this|it|anything))\b/i,
  /\bburn(?:ed|t)[ -]?out\b/i,
  /\bso (?:lonely|alone)\b/i,
  /\bovercome with\b/i,
];

/** Softer strain. Weight 1. */
const SOFT: RegExp[] = [
  /\bstress(?:ed|ful)?\b/i,
  /\bworr(?:y|ied|ying)\b/i,
  /\blonely\b/i,
  /\bscared\b/i,
  /\boverwhelm(?:ed|ing)?\b/i,
  /\bprocrastinat\w*/i,
  /\bcan'?t get (?:out of bed|started|anything done)\b/i,
];

/** Asking for help. Adds 1, but only alongside some other sign of strain. */
const HELP: RegExp[] = [
  /\bi need help\b/i,
  /\bneed (?:some )?help\b/i,
  /\bhelp me\b/i,
  /\bwhat can i do\b/i,
  /\bwhat do i do\b/i,
  /\bdon'?t know what (?:to do|i can do)\b/i,
  /\bhow do i (?:deal|cope|handle|stop|get through)\b/i,
  /\bcan'?t do this\b/i,
];

/**
 * The weight one message adds. Pure, and never returns the matched words.
 * Asking for help on its own ("what can I do about my job?") adds nothing,
 * because that is an ordinary question. It only counts next to real strain.
 */
export function strainWeight(text: string, prior = 0): number {
  const strong = STRONG.some((re) => re.test(text));
  const soft = SOFT.some((re) => re.test(text));
  let w = strong ? 2 : soft ? 1 : 0;
  if (HELP.some((re) => re.test(text)) && (w > 0 || prior > 0)) w += 1;
  return w;
}

/**
 * Fold one message into the running state. Elevated language is worth the whole
 * threshold on its own. Mild language from concernTier counts one.
 */
export function evaluateSupport(
  prev: SupportState | undefined,
  text: string,
  tier: ConcernTier,
): { next: SupportState; showCard: boolean } {
  const p = prev ?? emptySupport();
  const w = tier === 'elevated'
    ? SUPPORT_THRESHOLD
    : Math.max(strainWeight(text, p.score), tier === 'mild' ? 1 : 0);
  const score = p.score + w;
  const showCard = !p.shown && score >= SUPPORT_THRESHOLD;
  return {
    next: { score, shown: p.shown || showCard, active: p.active || showCard },
    showCard,
  };
}

// ------------------------------------------------------------------ the card

export interface SupportCard {
  title: string;
  lead: string;
  items: { name: string; detail: string }[];
  /** Said out loud so the pause is never a hidden flag. */
  note: string;
  /** Elevated only: also open the crisis sheet. */
  showResources: boolean;
}

export function supportCard(tier: ConcernTier): SupportCard {
  return {
    title: 'You do not have to carry this alone',
    lead:
      'A lot of what you have shared sounds heavy. I am a tool for thinking things through, ' +
      'and I cannot be the person who sits with you in it. These people can.',
    items: [
      {
        name: 'A counselor or doctor',
        detail:
          'A school or workplace counseling service, a campus health center, or your own doctor can help with stress and anxiety directly.',
      },
      {
        name: 'A pastor or small group',
        detail:
          'A church community you trust. You can say it plainly: "I have been struggling and I do not want to do it alone."',
      },
      {
        name: 'One person who knows you',
        detail: 'A friend or family member. One honest sentence is enough to start.',
      },
      {
        name: 'Right now, in the US',
        detail: 'Call or text 988 any time. Call 211 to find support near you.',
      },
    ],
    note: 'I have paused the questions while we talk. Nothing about this is reported to anyone.',
    showResources: tier === 'elevated',
  };
}

/** The line under the card on the turn it appears. */
export const SUPPORT_CHECKIN =
  'We can slow down. Tell me more about what is on your mind, or say when you would like to go back to the questions.';

/** The line on later turns while the pause is on. */
export const SUPPORT_CONTINUE =
  'I am listening. Anything else on your mind? You can go back to the questions whenever you like.';

// ------------------------------------------------------------------ thin answers

const THIN =
  /^(?:not much|nothing(?: much)?|idk|i (?:do ?n'?t|dont) know|dunno|no|nope|nah|none|n\/?a|same|fine|ok(?:ay)?|good|nm|whatever|not sure|no idea|stuff|things?|sure|yes|yeah|yep)$/i;

/**
 * An answer that carries nothing to build on ("not much", "idk"). It is still
 * recorded, but it is never evidence for a guess.
 */
export function isThin(text: string): boolean {
  const t = text.trim().replace(/[.!?,\s]+$/g, '');
  if (t.length < 2) return true;
  return THIN.test(t);
}

/**
 * The model is told to say when nothing real has surfaced. That honesty is right,
 * but it must not be dressed as a guess with a "Keep this" button.
 */
const NOTHING_YET =
  /\b(?:nothing|not much)\b[^.]{0,40}\bsurfaced\b|\bwon'?t (?:guess|offer a pattern)\b|\btoo (?:early|soon) to (?:say|guess)\b/i;

export function saysNothingYet(body: string): boolean {
  return NOTHING_YET.test(body);
}