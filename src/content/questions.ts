/**
 * §5 — The question bank.
 *
 * 50 questions across 12 light and medium categories. The four heavy rows
 * (Pain, Regret, Fear, Death) are UNWRITTEN and DISABLED in DEMO — they are a
 * pastoral-reviewer gate, not an oversight.
 *
 * Three rules govern every line here, and the test suite enforces all three:
 *
 *   P-13 — ask about BEHAVIOUR, not hypothetical opinion. "Tell me about the
 *   last time you…" surfaces a real entry point; "what do you think your
 *   biggest challenge is" surfaces an answer the person has already rehearsed.
 *   Past tense and concrete nouns beat "would" and "might".
 *
 *   P-01 — the word "purpose" appears nowhere. It raises the stakes of the
 *   sentence and invites a performance.
 *
 *   C-07/C-11 — a question is only useful if its answer can carry a concrete
 *   noun. Questions that invite trait words ("what do you value?") produce
 *   entries the filter will later refuse to build on.
 */

import type { Tier } from '../types/index.js';

export interface Question {
  id: string;
  tier: Tier;
  category: string;
  text: string;
  /** Heavy questions retire permanently on answer (§5). */
  retireOnAnswer: boolean;
  /** C-26: constraint disclosures are asked once and never re-asked. */
  askOnce?: boolean;
  /**
   * Served only after its parent has a substantive answer, and served next
   * when it does. A follow-up with no answered parent is never eligible.
   */
  followsFrom?: string;
  /**
   * Asked as soon as its tier opens, ahead of breadth. For the few questions
   * that are the point rather than part of the sweep.
   */
  priority?: boolean;
  /**
   * Rendered under the question, quieter. Holds the affordance rather than the
   * question — a defer option buried in the question text reads as a wall.
   */
  note?: string;
}

export const QUESTIONS: Question[] = [
  // ================================================================ LIGHT

  // --- daily texture: how the days actually go
  { id: 'dt1', tier: 'light', category: 'daily_texture', retireOnAnswer: false,
    text: 'Walk me through yesterday — not the highlights, just what actually happened.' },
  { id: 'dt2', tier: 'light', category: 'daily_texture', retireOnAnswer: false,
    text: 'What did you do this week that nobody asked you to do?' },
  { id: 'dt3', tier: 'light', category: 'daily_texture', retireOnAnswer: false,
    text: 'When in the day do you feel most like yourself?' },
  { id: 'dt4', tier: 'light', category: 'daily_texture', retireOnAnswer: false,
    text: 'What part of an ordinary week do you find yourself looking forward to?' },

  // --- work & role: what you do and what people bring you
  { id: 'wr1', tier: 'light', category: 'work_role', retireOnAnswer: false,
    text: 'What do people come to you for?' },
  { id: 'wr2', tier: 'light', category: 'work_role', retireOnAnswer: false,
    text: 'Tell me about a recent time someone said "can you just…" and you were glad they asked.' },
  { id: 'wr3', tier: 'light', category: 'work_role', retireOnAnswer: false,
    text: 'When the week gets tight, which part of your work do you protect?' },
  { id: 'wr4', tier: 'light', category: 'work_role', retireOnAnswer: false,
    text: 'What have you quietly fixed at work that nobody noticed?' },
  { id: 'wr5', tier: 'light', category: 'work_role', retireOnAnswer: false,
    text: 'When did someone last thank you for something specific?' },

  // --- energy: what fills and what flattens (feeds the §6.4 map)
  { id: 'en1', tier: 'light', category: 'energy', retireOnAnswer: false,
    text: 'What did you do in the last week that left you with more energy than you started with?' },
  { id: 'en2', tier: 'light', category: 'energy', retireOnAnswer: false,
    text: 'What task drains you out of all proportion to how hard it actually is?' },
  { id: 'en3', tier: 'light', category: 'energy', retireOnAnswer: false,
    text: 'Think of a time you looked up and hours had gone. What were you doing?' },
  { id: 'en4', tier: 'light', category: 'energy', retireOnAnswer: false,
    text: 'What kind of tired do you feel at the end of a good day, compared with a bad one?' },
  { id: 'en5', tier: 'light', category: 'energy', retireOnAnswer: false,
    text: 'Who do you come away from a conversation with feeling lighter?' },

  // --- people: who you serve, learn from, call
  { id: 'pe1', tier: 'light', category: 'people', retireOnAnswer: false,
    text: 'Who did you last go out of your way for?' },
  { id: 'pe2', tier: 'light', category: 'people', retireOnAnswer: false,
    text: 'Whose work do you quietly pay attention to?' },
  { id: 'pe3', tier: 'light', category: 'people', retireOnAnswer: false,
    text: 'Who would you call if something good happened at eleven at night?' },
  { id: 'pe4', tier: 'light', category: 'people', retireOnAnswer: false,
    text: 'Who have you stayed in touch with when it would have been easier not to?' },

  // --- craft & competence: what you can actually do
  { id: 'cc1', tier: 'light', category: 'craft', retireOnAnswer: false,
    text: 'What have you got noticeably better at in the last few years?' },
  { id: 'cc2', tier: 'light', category: 'craft', retireOnAnswer: false,
    text: 'What can you do that you had to learn the hard way?' },
  { id: 'cc3', tier: 'light', category: 'craft', retireOnAnswer: false,
    text: 'What comes easily to you that other people seem to find harder?' },
  { id: 'cc4', tier: 'light', category: 'craft', retireOnAnswer: false,
    text: 'What do you fix, tidy or improve without being asked?' },
  { id: 'cc5', tier: 'light', category: 'craft', retireOnAnswer: false,
    text: 'What would you say you are good at? No need to be modest about it.' },
  { id: 'cc6', tier: 'light', category: 'craft', retireOnAnswer: false,
    text: 'What do you know you are not good at?' },

  // --- delight: what you do when nobody is paying you
  { id: 'de1', tier: 'light', category: 'delight', retireOnAnswer: false,
    text: 'What do you read about or look up that nobody is paying you to know?' },
  { id: 'de2', tier: 'light', category: 'delight', retireOnAnswer: false,
    text: 'Tell me about the last thing you made — anything, however small.' },
  { id: 'de3', tier: 'light', category: 'delight', retireOnAnswer: false,
    text: 'What did you do with the last free Saturday you had?' },
  { id: 'de4', tier: 'light', category: 'delight', retireOnAnswer: false,
    text: 'What did you spend hours on as a kid?' },

  // --- faith & practice: the ordinary shape of it (distance is medium)
  { id: 'fp1', tier: 'light', category: 'faith_practice', retireOnAnswer: false,
    text: 'What does a normal week of faith look like for you at the moment?' },
  { id: 'fp2', tier: 'light', category: 'faith_practice', retireOnAnswer: false,
    text: 'When did you last pray about something specific? What was it about?' },
  { id: 'fp3', tier: 'light', category: 'faith_practice', retireOnAnswer: false,
    text: 'Is there a passage or a story you keep coming back to?' },
  { id: 'fp4', tier: 'light', category: 'faith_practice', retireOnAnswer: false,
    text: 'Where do you feel most at home in a church, and what are you usually doing?' },

  // ================================================================ MEDIUM

  // --- history & formation
  { id: 'hf1', tier: 'medium', category: 'history', retireOnAnswer: false,
    text: 'Where did you grow up, and what did people there think a good life looked like?' },
  { id: 'hf2', tier: 'medium', category: 'history', retireOnAnswer: false,
    text: 'Who shaped how you think about work? What did they actually say or do?' },
  { id: 'hf3', tier: 'medium', category: 'history', retireOnAnswer: false,
    text: 'What did you want to be at twelve? What happened to it?' },
  { id: 'hf4', tier: 'medium', category: 'history', retireOnAnswer: false,
    text: 'What was expected of you growing up, and by whom?' },
  { id: 'hf5', tier: 'medium', category: 'history', retireOnAnswer: false,
    text: 'What did your family do that you assumed every family did?' },

  // --- faith & distance
  { id: 'fd1', tier: 'medium', category: 'faith_distance', retireOnAnswer: false,
    text: 'Has there been a stretch where God felt far off? What was going on then?' },
  { id: 'fd2', tier: 'medium', category: 'faith_distance', retireOnAnswer: false,
    text: 'Which of your prayers have gone unanswered?' },
  { id: 'fd3', tier: 'medium', category: 'faith_distance', retireOnAnswer: false,
    text: 'Is there something you used to believe about God that you do not any more? If so, why?' },
  { id: 'fd4', tier: 'medium', category: 'faith_distance', retireOnAnswer: false,
    text: 'Has your picture of God changed? What moved it?' },
  { id: 'fd5', tier: 'medium', category: 'faith_distance', retireOnAnswer: false,
    followsFrom: 'fd2',
    text: 'This may be an unusual or hard question, but have you ever had a prayer answered in a way you did not expect? What was it?',
    note: 'If you need some time to reflect on this, just say "Let\'s come back to this".' },

  // --- thresholds: what you quit, turned down, walked away from
  { id: 'th1', tier: 'medium', category: 'thresholds', retireOnAnswer: false,
    text: 'Tell me about something you quit. What was the last straw — tell me why, and what happened?' },
  { id: 'th2', tier: 'medium', category: 'thresholds', retireOnAnswer: false,
    text: 'What have you turned down that you still think about?' },
  { id: 'th3', tier: 'medium', category: 'thresholds', retireOnAnswer: false,
    text: 'When did you last walk away from something that looked good on paper?' },
  { id: 'th4', tier: 'medium', category: 'thresholds', retireOnAnswer: false, priority: true,
    text: 'What did you say no to that everyone around you expected you to say yes to?' },
  { id: 'th5', tier: 'medium', category: 'thresholds', retireOnAnswer: false,
    text: 'Is there something you have been on the edge of leaving for a while?' },

  // --- disappointment
  { id: 'di1', tier: 'medium', category: 'disappointment', retireOnAnswer: false, priority: true,
    text: 'What did you expect your life to look like by now?' },
  { id: 'di2', tier: 'medium', category: 'disappointment', retireOnAnswer: false,
    text: 'Tell me about something that did not go the way you thought it would.' },
  { id: 'di3', tier: 'medium', category: 'disappointment', retireOnAnswer: false,
    text: 'What have you worked hard at that did not come to anything?' },
  { id: 'di4', tier: 'medium', category: 'disappointment', retireOnAnswer: false,
    text: 'What is a door you expected to open that did not?' },

  // --- constraint — C-26: asked once, confirm-before-write, never re-asked
  { id: 'co1', tier: 'medium', category: 'constraint', retireOnAnswer: true, askOnce: true,
    text: 'What is actually available to you right now — time, money, energy? I would rather fit things to your real life than an imagined one.' },
  { id: 'co2', tier: 'medium', category: 'constraint', retireOnAnswer: true, askOnce: true,
    text: 'Is anyone depending on you right now — someone you care for, or a commitment you cannot step back from?' },
];

/**
 * HEAVY TIER — Pain, Regret, Fear, Death.
 *
 * Intentionally empty. These ten questions are a pastoral-reviewer gate
 * (deferred gate c23-heavy-rows). Writing them here before sign-off would let
 * a DEMO build serve them if the tier flag were ever flipped by accident, so
 * the safe state is an empty array rather than a commented-out block.
 */
export const HEAVY_QUESTIONS: Question[] = [];

export const LIGHT_CATEGORIES = [
  'daily_texture', 'work_role', 'energy', 'people', 'craft', 'delight', 'faith_practice',
];
export const MEDIUM_CATEGORIES = [
  'history', 'faith_distance', 'thresholds', 'disappointment', 'constraint',
];
export const HEAVY_CATEGORIES = ['pain', 'regret', 'fear', 'death'];
