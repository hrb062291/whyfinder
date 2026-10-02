/**
 * §5 state machine — C-23 (tier gate) and C-24 (dosage).
 *
 * C-23's test names deep-linked paths, so the gate is enforced HERE, on
 * question retrieval, and never in the conversation flow or the UI. There is
 * no code path that hands out a question without passing through this module.
 *
 * The gate governs what the app ASKS. It never governs what the app can HEAR.
 * A user who volunteers grief in their first message gets a full response and
 * zero heavy questions. Mentioning a subject does not unlock its row —
 * C-23's "under any path" exists precisely to stop that.
 */

import { QUESTIONS, HEAVY_QUESTIONS, type Question } from '../content/questions.js';
import { heavyTierEnabled } from '../config/reviewState.js';
import type { Tier } from '../types/index.js';

/** C-24: two heavy questions per rolling 24 hours, keyed to the user. */
export const HEAVY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const HEAVY_MAX_PER_WINDOW = 2;

/** Tier gates (§5). */
export const MEDIUM_MIN_ANSWERS = 3;
export const HEAVY_MIN_ANSWERS = 6;
export const HEAVY_MIN_CATEGORIES = 3;

/**
 * Retirement is asymmetric, and the asymmetry is the principle:
 *
 *   A HEAVY question costs something just by being ASKED. The exposure has
 *   happened whether or not the person answered, so re-asking is a second
 *   exposure. Retire on serve, any outcome.
 *
 *   A LIGHT or MEDIUM question costs nothing to ask. The only reason to retire
 *   it is that it has been answered. A deflection means "not now", not "never"
 *   — someone not ready to say what they quit in week one may well be in week
 *   three. Cool down, allow exactly one re-ask, then let it go.
 *
 * This matters most for C-26's constraint questions. Retiring those on a
 * deflection means the app never learns the person is caregiving, and P-11 is
 * dead for them permanently — weekend-retreat suggestions forever because they
 * typed "skip" once.
 */
export const DEFLECTION_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_DEFLECTIONS_BEFORE_RETIRE = 2;

export interface GateState {
  userId: string;
  /** Substantive answers only. Question id -> category. */
  substantiveAnswers: { questionId: string; category: string; at: string }[];
  /** Timestamps of heavy questions SERVED, for the rolling window. */
  heavyServedAt: string[];
  /** Permanently retired — heavy rows, and anything deflected twice. */
  retiredQuestionIds: string[];
  /** Light/medium questions deflected. Cooled down, not burned. */
  deflections: { questionId: string; at: string; count: number }[];
}

export function emptyState(userId: string): GateState {
  return {
    userId,
    substantiveAnswers: [],
    heavyServedAt: [],
    retiredQuestionIds: [],
    deflections: [],
  };
}

export function inCooldown(state: GateState, questionId: string, now: Date): boolean {
  const d = state.deflections.find((x) => x.questionId === questionId);
  if (!d) return false;
  return now.getTime() - new Date(d.at).getTime() < DEFLECTION_COOLDOWN_MS;
}

// ------------------------------------------------------------ substantive

/** Pure deflections. These never count toward a gate. */
const DEFLECTIONS = [
  'skip', 'pass', 'next', 'idk', 'dunno', 'no idea', 'nothing', 'none', 'na', 'n/a',
  'no', 'nope', 'not sure', 'unsure', 'i dont know', "i don't know", 'dont know',
  "don't know", 'cant think of anything', "can't think of anything", 'no comment',
  'nothing really', 'not really', 'maybe', 'hmm', '-', '?', '...',
];

/** Trailing or leading filler that does not change whether an answer deflects. */
const FILLER = /\b(really|honestly|i think|i guess|i mean|sorry|yeah|well|just|like|um|uh)\b/g;

/**
 * Words that carry no content on their own. An answer made only of these is
 * not something a reflection can be built on.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'about', 'from', 'by', 'is', 'am', 'are', 'was', 'were', 'be', 'been',
  'being', 'do', 'does', 'did', 'have', 'has', 'had', 'it', 'its', 'this', 'that',
  'these', 'those', 'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'you', 'your',
  'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'so', 'then', 'than',
  'very', 'quite', 'some', 'any', 'all', 'lot', 'lots', 'much', 'more', 'most',
  'thing', 'things', 'stuff', 'bit', 'kind', 'sort', 'what', 'which', 'who',
]);

/**
 * Usable as C-07 evidence — one threshold serving both rules.
 *
 * This was a word count (five or more) and that was wrong in a way that broke
 * the product. "Fixing the car" and "the garden" are real answers with real
 * nouns, and both were counted as deflections: the medium tier never unlocked,
 * no synthesis was ever possible, and each question went into cooldown. The
 * app walked through light questions forever and never deepened.
 *
 * Length was never the signal. CONTENT is. An answer counts when it is not an
 * outright deflection and contains at least one word that names something.
 *
 * P-03 holds: a bare "I don't know" is a deflection and does not unlock a
 * deeper tier, but "I don't know, I have never thought about it — maybe the
 * allotment" names something and does.
 */
export function isSubstantive(text: string): boolean {
  const raw = text.trim().toLowerCase();
  if (!raw) return false;

  // Strip punctuation and filler before deciding whether it is a pure deflection,
  // so "dunno really" and "nope." read the same as "dunno" and "nope".
  const stripped = raw
    .replace(/[.!,;:]+/g, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return false;
  if (DEFLECTIONS.includes(stripped)) return false;

  const words = stripped.split(/\s+/).filter(Boolean);
  const content = words.filter((w) => !STOPWORDS.has(w.replace(/[^a-z']/g, '')));
  return content.length >= 1;
}

// ------------------------------------------------------------ tier gates

export function distinctCategories(state: GateState): Set<string> {
  return new Set(state.substantiveAnswers.map((a) => a.category));
}

export function tierUnlocked(tier: Tier, state: GateState): boolean {
  const n = state.substantiveAnswers.length;
  switch (tier) {
    case 'light':
      return true;
    case 'medium':
      return n >= MEDIUM_MIN_ANSWERS;
    case 'heavy':
      // Answers at ANY tier count toward breadth (§5).
      return (
        heavyTierEnabled() &&
        n >= HEAVY_MIN_ANSWERS &&
        distinctCategories(state).size >= HEAVY_MIN_CATEGORIES
      );
  }
}

// ------------------------------------------------------------ dosage

export function heavyServedInWindow(state: GateState, now: Date = new Date()): number {
  const cutoff = now.getTime() - HEAVY_WINDOW_MS;
  return state.heavyServedAt.filter((ts) => new Date(ts).getTime() > cutoff).length;
}

/**
 * C-24. Rolling and user-keyed, so closing the tab resets nothing. Volume I
 * says "per session"; no session boundary is defined anywhere in the spec, and
 * every candidate definition leaves a re-entry loophole. Intent preserved,
 * loophole closed — recorded in the decision log.
 */
export function heavyAllowedNow(state: GateState, now: Date = new Date()): boolean {
  return heavyServedInWindow(state, now) < HEAVY_MAX_PER_WINDOW;
}

// ------------------------------------------------------------ selection

function answeredSubstantively(state: GateState, questionId: string): boolean {
  return state.substantiveAnswers.some((a) => a.questionId === questionId);
}

export function eligibleQuestions(state: GateState, now: Date = new Date()): Question[] {
  const all = [...QUESTIONS, ...HEAVY_QUESTIONS];
  return all.filter((q) => {
    if (state.retiredQuestionIds.includes(q.id)) return false;
    if (answeredSubstantively(state, q.id)) return false;
    if (inCooldown(state, q.id, now)) return false;
    if (!tierUnlocked(q.tier, state)) return false;
    if (q.tier === 'heavy' && !heavyAllowedNow(state, now)) return false;
    // A follow-up is meaningless without its parent's answer, and asking it
    // cold would read as the app losing the thread.
    if (q.followsFrom && !answeredSubstantively(state, q.followsFrom)) return false;
    return true;
  });
}

/**
 * Selection order, most specific first:
 *
 *   1. A follow-up whose parent was just answered. Anything else here would
 *      read as the app changing the subject mid-thought.
 *   2. A priority question, once its tier is open. These are the questions
 *      that are the point rather than part of the sweep, and leaving them to
 *      chance in a bank of fifty means most people never see them.
 *   3. A category not yet touched, so the heavy gate's "3+ distinct
 *      categories" is reached by an ordinary conversation rather than by
 *      deliberate navigation.
 */
export function nextQuestion(state: GateState, now: Date = new Date()): Question | null {
  const eligible = eligibleQuestions(state, now);
  if (!eligible.length) return null;

  const followUp = eligible.find((q) => q.followsFrom);
  if (followUp) return followUp;

  const seen = distinctCategories(state);
  const preferFresh = (pool: Question[]) => {
    const fresh = pool.filter((q) => !seen.has(q.category));
    return (fresh.length ? fresh : pool)[0];
  };

  const priority = eligible.filter((q) => q.priority);
  if (priority.length) return preferFresh(priority);

  return preferFresh(eligible);
}

// ------------------------------------------------------------ transitions

export function recordServed(state: GateState, q: Question, now: Date = new Date()): GateState {
  if (q.tier !== 'heavy') return state;
  return { ...state, heavyServedAt: [...state.heavyServedAt, now.toISOString()] };
}

export function recordAnswer(
  state: GateState,
  q: Question,
  answer: string,
  now: Date = new Date(),
): GateState {
  const next: GateState = {
    ...state,
    substantiveAnswers: [...state.substantiveAnswers],
    retiredQuestionIds: [...state.retiredQuestionIds],
    deflections: [...state.deflections],
  };
  const retire = () => {
    if (!next.retiredQuestionIds.includes(q.id)) next.retiredQuestionIds.push(q.id);
  };

  // Heavy: the asking is the cost. Retire regardless of what came back.
  if (q.tier === 'heavy') {
    retire();
    if (isSubstantive(answer)) {
      next.substantiveAnswers.push({ questionId: q.id, category: q.category, at: now.toISOString() });
    }
    return next;
  }

  if (isSubstantive(answer)) {
    next.substantiveAnswers.push({ questionId: q.id, category: q.category, at: now.toISOString() });
    // Answered for real. Ask-once questions (C-26) are done.
    if (q.retireOnAnswer || q.askOnce) retire();
    // A previously-deflected question that finally landed clears its record.
    next.deflections = next.deflections.filter((d) => d.questionId !== q.id);
    return next;
  }

  // Deflection. Not now, not never.
  const existing = next.deflections.find((d) => d.questionId === q.id);
  if (existing) {
    existing.count += 1;
    existing.at = now.toISOString();
    if (existing.count >= MAX_DEFLECTIONS_BEFORE_RETIRE) retire();
  } else {
    next.deflections.push({ questionId: q.id, at: now.toISOString(), count: 1 });
  }
  return next;
}
