/**
 * Small real-world experiments.
 *
 * The bar is deliberately low. If the ask feels big, people skip it and the
 * feature turns into guilt. Nothing here is scored, streaked or counted (C-27).
 *
 * Sources: 'pattern-suggested' (the app noticed a thread) and 'self' (the person
 * names their own). 'mentor' is reserved for a later phase and is not offered.
 */

import type { Entry } from '../types/index.js';

export interface Experiment {
  id: string;
  title: string;
  /** Needs money, travel or a block of time. Skipped for people with little slack. */
  needsSlack: boolean;
  /** Words in the person's own entries that make this one a fit. */
  cues: RegExp;
}

export const EXPERIMENTS: Experiment[] = [
  { id: 'x1', needsSlack: false, cues: /\b(admire|inspire|learn|curious|read)\w*/i,
    title: 'Message someone whose work you admire and ask them one question.' },
  { id: 'x2', needsSlack: false, cues: /\b(help|teach|explain|people|ask(?:s|ed)? me)\b/i,
    title: 'The next time someone asks you for help, say yes, then notice how you feel an hour later.' },
  { id: 'x3', needsSlack: false, cues: /\b(made|build|built|fix|fixed|garden|shed|create|wire|wired|paint|cook)\w*/i,
    title: 'Give 15 minutes to something you tend to lose track of time doing, and notice what ends it.' },
  { id: 'x4', needsSlack: false, cues: /\b(tired|drain|drained|energy|exhausted|flat)\w*/i,
    title: 'Write down one thing this week that drained you and one that filled you up. A few words each is enough.' },
  { id: 'x5', needsSlack: false, cues: /\b(friend|family|mother|father|wife|husband|brother|sister)\b/i,
    title: 'Ask one person who knows you well what they think you enjoy helping with.' },
  { id: 'x6', needsSlack: false, cues: /\b(pray|prayer|church|scripture|bible|faith|god)\b/i,
    title: 'Read one passage you keep coming back to, slowly, and notice which line stays with you.' },
  { id: 'x7', needsSlack: false, cues: /\b(avoid|dread|procrastinat|hate)\w*/i,
    title: 'Try something you usually avoid for ten minutes, then stop, and notice what it was actually like.' },
  { id: 'x8', needsSlack: true, cues: /\b(curious|wonder|interested|someday)\b/i,
    title: 'Sit in on one conversation, meeting or service of a kind you are curious about.' },
];

export type ExperimentChoice = 'accept' | 'own' | 'skip';
export type Feel = 'more' | 'less' | 'unsure';

export interface ExperimentRecord {
  id: string;
  title: string;
  source: 'pattern-suggested' | 'self';
  offeredAt: string;
  choice?: ExperimentChoice;
  feel?: Feel;
}

/** Whether the person has said something about their available time, money or energy. */
export function hasLimitedSlack(entries: Entry[]): boolean {
  return entries.some((e) => e.questionId === 'co1' || e.questionId === 'co2');
}

/** Pick one experiment from the person's own words. Falls back to the energy one. */
export function pickExperiment(entries: Entry[]): Experiment {
  const text = entries.map((e) => e.text).join(' ');
  const slackFree = hasLimitedSlack(entries);
  const pool = EXPERIMENTS.filter((x) => !(slackFree && x.needsSlack));
  return pool.find((x) => x.cues.test(text)) ?? pool.find((x) => x.id === 'x4')!;
}

interface Holder { experiments?: ExperimentRecord[]; entries: Entry[]; userId: string; sessionId: string }

export function offer<S extends Holder>(s: S, x: Experiment, now: Date): { state: S; record: ExperimentRecord } {
  const record: ExperimentRecord = {
    id: x.id, title: x.title, source: 'pattern-suggested', offeredAt: now.toISOString(),
  };
  return { state: { ...s, experiments: [...(s.experiments ?? []), record] }, record };
}

export function chooseExperiment<S extends Holder>(s: S, id: string, choice: ExperimentChoice): S {
  return {
    ...s,
    experiments: (s.experiments ?? []).map((r) =>
      r.id === id ? { ...r, choice, source: choice === 'own' ? 'self' : r.source } : r),
  };
}

/**
 * The reflect step is two taps: a feeling, and an optional line. The line, when
 * given, becomes an ordinary entry in the person's own words, so later
 * syntheses can build on it. The feeling alone is stored but never quoted back.
 */
export function recordReflection<S extends Holder>(
  s: S, id: string, feel: Feel, note: string | undefined, now: Date,
): S {
  let next: S = {
    ...s,
    experiments: (s.experiments ?? []).map((r) => (r.id === id ? { ...r, feel } : r)),
  };
  const text = note?.trim();
  if (text) {
    next = {
      ...next,
      entries: [...next.entries, {
        id: `e${next.entries.length + 1}`, userId: s.userId, sessionId: s.sessionId,
        createdAt: now.toISOString(), text, source: 'volunteered',
      }],
    };
  }
  return next;
}
