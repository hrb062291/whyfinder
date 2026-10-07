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
  /\banxi\w*/i,
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
  /\blone?l(?:y|iness)\b/i,
  /\blost\b/i,
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

const FIRST_PERSON = /\b(?:i|i'?m|i’m|i'?ve|i’ve|i'?d|my|me|myself|we|our|mine)\b/i;
const QUESTION_OPENER =
  /^(?:what|how|why|who|where|when|does|do|is|are|can|should|explain|tell me|teach me)\b/i;

/** A general question or request that never mentions the person themselves. */
export function isInformational(text: string): boolean {
  const t = text.trim().replace(/^[\s"'“”‘’]+/, '');
  return QUESTION_OPENER.test(t) && !FIRST_PERSON.test(t);
}

/**
 * The weight one message adds. Pure, and never returns the matched words.
 * Asking for help on its own ("what can I do about my job?") adds nothing,
 * because that is an ordinary question. It only counts next to real strain.
 */
export function strainWeight(text: string, prior = 0): number {
  // "What does the Bible say about anxiety?" asks about a topic. It says nothing
  // about how this person is doing, so it adds no weight.
  if (isInformational(text)) return 0;
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
    : Math.max(strainWeight(text, p.score), tier === 'mild' ? 0.5 : 0);
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

// ------------------------------------------------------------------ tender moments

/**
 * Hurt that is not a crisis: a friend was unkind, someone feels unseen, someone
 * feels far from God. It does not count toward the support card. It only means
 * the app should stay with what was said instead of moving on to a list
 * question, a guess or an experiment.
 */
const TENDER: RegExp[] = [
  /\bunwell\b/i,
  /\b(?:hurt|hurts|hurting|upset|sad|heartbroken|ashamed|rejected|betrayed|ignored|left out|unseen)\b/i,
  /\bmean to me\b/i,
  /\b(?:don'?t|doesn'?t|do not|does not) (?:really )?care (?:about|for) me\b/i,
  /\bnobody (?:listens|gets me|understands)\b/i,
  /\b(?:dista\w+|far|disconnected|cut off|separated|away|estranged) (?:myself )?from god\b/i,
  /\bgod (?:feels|seems|is) (?:far|distant|absent|silent|gone|quiet)\b/i,
  /\b(?:can'?t|don'?t|do not|cannot) (?:see|feel|hear|sense) god\b/i,
  /\bcr(?:y|ied|ying)\b/i,
];

export function isTender(text: string): boolean {
  return TENDER.some((re) => re.test(text)) || strainWeight(text) >= 1;
}

/** Said when the person is hurting and the model has no good follow-up. */
export const TENDER_LINE = 'Take your time. I am here whenever you want to say more about that.';

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
const NOTHING_YET = new RegExp(
  [
    "\\b(?:nothing|not much|little|not enough)\\b[^.]{0,50}\\b(?:surfaced|emerged|to go on|to work with|to name|to say)\\b",
    "\\bwon'?t (?:guess|offer a pattern|name a pattern|invent)\\b",
    "\\b(?:too|still) (?:early|soon) to (?:say|guess|name|see)\\b",
    "\\bno (?:clear|real) pattern\\b",
    "\\bdon'?t want to invent a pattern\\b",
  ].join('|'),
  'i',
);

export function saysNothingYet(body: string): boolean {
  return NOTHING_YET.test(body);
}

// ------------------------------------------------------------------ typed "back to the questions"

/** Typing it works as well as the button. */
const RESUME =
  /^(?:(?:ok|okay|yes|yeah|sure|alright)[,.!\s]*)?(?:(?:let'?s |lets )?(?:go )?back to (?:the )?questions?|(?:let'?s |lets )?(?:continue|resume|keep going)|(?:the )?next question|i'?m (?:ok|okay|fine|ready)|ready)[.!\s]*$/i;

export function wantsQuestionsBack(text: string): boolean {
  return RESUME.test(text.trim());
}

// ------------------------------------------------------------------ "what is the point of you"

const ASKS_ABOUT_APP =
  /\b(?:point of (?:you|this|whyfinder)|what are you|who are you|what is (?:this|whyfinder)|what do you do|how do you work|are you (?:a |an )?(?:real|human|ai|bot|robot|person|therapist|counselor|pastor)|what is this (?:app|for))\b/i;

export function asksAboutApp(text: string): boolean {
  return ASKS_ABOUT_APP.test(text);
}

/** Fixed text. Said plainly, and never routed through a model. */
export const ABOUT_APP_REPLY =
  'Fair question. I am a tool for thinking out loud: I ask questions, remember what you say in this conversation, and sometimes offer a guess about a pattern for you to keep or throw away. I am not a counselor, a pastor or a friend, and I do not know what God intends for you.';