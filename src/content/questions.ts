/**
 * §5 — The question bank.
 *
 * 34 questions across 12 light and medium categories. The four heavy rows
 * (Pain, Regret, Fear, Death) are UNWRITTEN and DISABLED in DEMO — they are a
 * pastoral-reviewer gate, not an oversight.
 *
 * Every question follows P-13: ask about behavior and pain, not hypothetical
 * opinion. "Tell me about the last time you…" surfaces real entry points;
 * "what's your biggest challenge with…" surfaces a rehearsed answer.
 *
 * And P-01: the word "purpose" appears nowhere in the bank. It raises the
 * stakes of the sentence and invites a performance.
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
}

export const QUESTIONS: Question[] = [
  // ---------------------------------------------------------------- LIGHT

  // daily texture
  { id: 'dt1', tier: 'light', category: 'daily_texture', retireOnAnswer: false,
    text: 'Walk me through yesterday — not the highlights, just what actually happened.' },
  { id: 'dt2', tier: 'light', category: 'daily_texture', retireOnAnswer: false,
    text: 'What did you do this week that nobody asked you to do?' },
  { id: 'dt3', tier: 'light', category: 'daily_texture', retireOnAnswer: false,
    text: 'When in the day do you feel most like yourself?' },

  // work & role
  { id: 'wr1', tier: 'light', category: 'work_role', retireOnAnswer: false,
    text: 'What do people come to you for?' },
  { id: 'wr2', tier: 'light', category: 'work_role', retireOnAnswer: false,
    text: 'Tell me about a recent time someone said "can you just…" and you were glad they asked.' },
  { id: 'wr3', tier: 'light', category: 'work_role', retireOnAnswer: false,
    text: 'If you could keep one part of what you do and drop the rest, which part stays?' },

  // energy
  { id: 'en1', tier: 'light', category: 'energy', retireOnAnswer: false,
    text: 'What did you do in the last week that left you with more energy than you started with?' },
  { id: 'en2', tier: 'light', category: 'energy', retireOnAnswer: false,
    text: 'What task drains you out of all proportion to how hard it actually is?' },
  { id: 'en3', tier: 'light', category: 'energy', retireOnAnswer: false,
    text: 'Think of a time you looked up and hours had gone. What were you doing?' },

  // people
  { id: 'pe1', tier: 'light', category: 'people', retireOnAnswer: false,
    text: 'Who did you last go out of your way for?' },
  { id: 'pe2', tier: 'light', category: 'people', retireOnAnswer: false,
    text: 'Whose work do you quietly pay attention to?' },
  { id: 'pe3', tier: 'light', category: 'people', retireOnAnswer: false,
    text: 'Who would you call if something good happened at eleven at night?' },

  // craft & competence
  { id: 'cc1', tier: 'light', category: 'craft', retireOnAnswer: false,
    text: 'What have you got noticeably better at in the last few years?' },
  { id: 'cc2', tier: 'light', category: 'craft', retireOnAnswer: false,
    text: 'What can you do that you had to learn the hard way?' },
  { id: 'cc3', tier: 'light', category: 'craft', retireOnAnswer: false,
    text: 'What comes easily to you that other people seem to find harder?' },

  // delight
  { id: 'de1', tier: 'light', category: 'delight', retireOnAnswer: false,
    text: 'What do you read about or look up that nobody is paying you to know?' },
  { id: 'de2', tier: 'light', category: 'delight', retireOnAnswer: false,
    text: 'Tell me about the last thing you made — anything, however small.' },
  { id: 'de3', tier: 'light', category: 'delight', retireOnAnswer: false,
    text: 'If a Saturday opened up with nothing in it, what would actually happen?' },

  // faith & practice  (light: practice, not distance)
  { id: 'fp1', tier: 'light', category: 'faith_practice', retireOnAnswer: false,
    text: 'What does a normal week of faith look like for you at the moment?' },
  { id: 'fp2', tier: 'light', category: 'faith_practice', retireOnAnswer: false,
    text: 'When did you last pray about something specific? What was it about?' },
  { id: 'fp3', tier: 'light', category: 'faith_practice', retireOnAnswer: false,
    text: 'Is there a passage or a story you keep coming back to?' },

  // ---------------------------------------------------------------- MEDIUM

  // history & formation
  { id: 'hf1', tier: 'medium', category: 'history', retireOnAnswer: false,
    text: 'Where did you grow up, and what did people there think a good life looked like?' },
  { id: 'hf2', tier: 'medium', category: 'history', retireOnAnswer: false,
    text: 'Who shaped how you think about work? What did they actually say or do?' },
  { id: 'hf3', tier: 'medium', category: 'history', retireOnAnswer: false,
    text: 'What did you want to be at twelve? What happened to it?' },

  // faith & distance
  { id: 'fd1', tier: 'medium', category: 'faith_distance', retireOnAnswer: false,
    text: 'Has there been a stretch where God felt far off? What was going on then?' },
  { id: 'fd2', tier: 'medium', category: 'faith_distance', retireOnAnswer: false,
    text: 'What have you prayed for that you did not get?' },
  { id: 'fd3', tier: 'medium', category: 'faith_distance', retireOnAnswer: false,
    text: 'Is there something you used to believe about God that you do not any more?' },

  // thresholds
  { id: 'th1', tier: 'medium', category: 'thresholds', retireOnAnswer: false,
    text: 'Tell me about something you quit. What was the last straw?' },
  { id: 'th2', tier: 'medium', category: 'thresholds', retireOnAnswer: false,
    text: 'What have you turned down that you still think about?' },
  { id: 'th3', tier: 'medium', category: 'thresholds', retireOnAnswer: false,
    text: 'When did you last walk away from something that looked good on paper?' },

  // disappointment
  { id: 'di1', tier: 'medium', category: 'disappointment', retireOnAnswer: false,
    text: 'What did you expect your life to look like by now?' },
  { id: 'di2', tier: 'medium', category: 'disappointment', retireOnAnswer: false,
    text: 'Tell me about something that did not go the way you thought it would.' },

  // constraint — C-26: asked once, confirm-before-write, never re-asked
  { id: 'co1', tier: 'medium', category: 'constraint', retireOnAnswer: true, askOnce: true,
    text: 'What is actually available to you right now — time, money, energy? I would rather fit things to your real life than an imagined one.' },
  { id: 'co2', tier: 'medium', category: 'constraint', retireOnAnswer: true, askOnce: true,
    text: 'Is there anything you are carrying at the moment that shapes what you can take on?' },
];

/**
 * HEAVY TIER — Pain, Regret, Fear, Death.
 *
 * Intentionally empty. These ten questions are a pastoral-reviewer gate
 * (deferred gate c23-heavy-rows). Writing them here before sign-off would let
 * a DEMO build serve them if the tier flag were ever flipped by accident.
 */
export const HEAVY_QUESTIONS: Question[] = [];

export const LIGHT_CATEGORIES = [
  'daily_texture', 'work_role', 'energy', 'people', 'craft', 'delight', 'faith_practice',
];
export const MEDIUM_CATEGORIES = [
  'history', 'faith_distance', 'thresholds', 'disappointment', 'constraint',
];
export const HEAVY_CATEGORIES = ['pain', 'regret', 'fear', 'death'];
