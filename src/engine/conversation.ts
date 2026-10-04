/**
 * The conversation layer.
 *
 * Wraps takeTurn() without changing it. takeTurn still owns the acute-signal
 * check, the entry log, the question gate and the synthesis filter. This layer
 * adds, in order of phase:
 *
 *   2  a one-or-two sentence reply to what the person just said, and faith
 *      Q&A framed as discernment. Both pass filterProse() or are dropped.
 *   3  one small experiment after the first synthesis.
 *
 * Distress never goes through a model here. Mild and elevated concern get fixed
 * wording from concernTier.ts, and acute is takeTurn's own path.
 */

import { PHASE } from '../config/phases.js';
import { careFor, concernTier, type Care } from '../constraints/concernTier.js';
import { filterProse } from '../constraints/proseFilter.js';
import { QUESTIONS } from '../content/questions.js';
import {
  offer, pickExperiment, type Experiment, type ExperimentRecord,
} from '../content/experiments.js';
import { STATEMENT_KINDS, type Entry, type ModelProvider, type StatementKind, type Synthesis } from '../types/index.js';
import { OPENING, takeTurn, type SessionState, type TurnDeps, type TurnOutput } from './session.js';

export type ConvState = SessionState & { experiments?: ExperimentRecord[] };

export interface FaithAnswer {
  body: string;
  kind: StatementKind;
  /** References only, never quoted text. */
  scripture: string[];
  questionsToConsider: string[];
  counsel: string[];
}

export type ConversationOutput = TurnOutput & {
  care?: Care;
  reply?: string;
  answer?: FaithAnswer;
  experiment?: { id: string; title: string; source: ExperimentRecord['source'] };
};

export interface ConvDeps {
  /** What takeTurn needs. */
  turn: TurnDeps;
  /** The LIVE model only. Left undefined on fixtures: replies and answers need a real model. */
  live?: ModelProvider;
  phase?: number;
  now?: Date;
}

// ------------------------------------------------------------------ prompts

function said(entries: { text: string }[]): string {
  return entries.map((e, i) => `  ${i + 1}. ${e.text}`).join('\n');
}

export function replyPrompt(entries: { text: string }[]): string {
  return `You are the mentor voice in WhyFinder. You are not a therapist, pastor or counselor.

What this person has told you so far:
${said(entries)}

Write ONE or TWO plain sentences responding to the most recent thing they said.

- Reflect something specific, using words they actually used.
- No advice, no explanation of why they feel or act this way, no diagnosis.
- Never write "you are a", "your purpose is", "that's why", or anything about what God wants.
- Never describe the inner life of anyone but this person.
- If you cannot say anything specific and true, reply with exactly: NONE
Return only the sentences, no JSON.`;
}

export function answerPrompt(entries: { text: string }[]): string {
  return `You are the mentor voice in WhyFinder, a tool for noticing patterns in one's own life. You are not a therapist, pastor or counselor and you do not speak for God.

The person has asked you a question. What they have told you so far:
${said(entries) || '  (nothing yet)'}

Help them DISCERN. Do not decide for them.

Return ONLY a JSON object:
{
  "body": "<2 to 4 short sentences, under 600 characters in total>",
  "kind": "biblical_teaching" | "christian_interpretation" | "psychological_research" | "ai_inference",
  "scripture": ["<reference such as Romans 12:2>"],
  "questionsToConsider": ["<question>", "<question>"],
  "counsel": ["<kind of person to seek out, e.g. a pastor or a trusted mentor>"]
}

Rules. Output that breaks any of these is discarded.
- "kind" is exactly one value, and "body" is only that kind of statement.
- Scripture: give references only. Never quote verses.
- Use "may want to prayerfully consider", "one reading is", "worth asking". Never say God is telling, calling or leading them.
- Where Christians disagree (gifts, women in ministry, divorce, and so on) say that traditions differ and point to a pastor.
- Where relevant, name the good that a choice could bring into their life, as well as the cost.
- Do not use clinical or personality-type labels they did not use first.
- "questionsToConsider" has two or three questions. "counsel" has one or two entries.`;
}

// ------------------------------------------------------------------ detection

const INTERROGATIVE = /^(?:how|what|why|should|does|do|is|can|will|where|who|when|am|are|would|could)\b/i;
const FAITH_OR_DIRECTION =
  /\b(god|jesus|christ|bible|scripture|pray|prayer|faith|sin|church|calling|called|purpose|direction|meaning|career|job|quit|leave|marry|move)\b/i;

/** The person is asking the app something, rather than answering a question. */
export function isAskingUs(text: string): boolean {
  const t = text.trim().replace(/^[\s"'“”‘’]+|[\s"'“”‘’\\]+$/g, '');
  if (!t.includes('?')) return false;
  if (t.split(/\s+/).length < 4) return false;
  return INTERROGATIVE.test(t) && FAITH_OR_DIRECTION.test(t);
}

export const ANSWER_FALLBACK =
  'That is a question worth taking to a pastor or a mentor you trust. Christians differ on it, and I would not want to speak for God. We can pick up where we were whenever you like.';

// ------------------------------------------------------------------ generation

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : [];

export async function generateReply(
  live: ModelProvider, entries: { text: string }[],
): Promise<string | null> {
  const raw = (await live.complete(
    entries.map((e) => ({ role: 'user', content: e.text })), replyPrompt(entries),
  )).trim();
  if (!raw || /^none\b/i.test(raw)) return null;
  return filterProse(raw, { maxChars: 400 }).pass ? raw : null;
}

export async function generateAnswer(
  live: ModelProvider, question: string, entries: { text: string }[],
): Promise<FaithAnswer | null> {
  const raw = await live.complete([{ role: 'user', content: question }], answerPrompt(entries));
  const drop = (why: string): null => {
    console.warn('[whyfinder] answer dropped:', why, '| raw:', raw.slice(0, 400));
    return null;
  };
  const obj = parseJson(raw);
  if (!obj || typeof obj.body !== 'string') return drop('not valid JSON');
  const kind = obj.kind as StatementKind;
  if (!STATEMENT_KINDS.includes(kind)) return drop(`bad kind: ${String(obj.kind)}`);

  const answer: FaithAnswer = {
    body: obj.body,
    kind,
    scripture: strings(obj.scripture, 4),
    questionsToConsider: strings(obj.questionsToConsider, 3),
    counsel: strings(obj.counsel, 2),
  };
  // Judge everything the person will read, not just the body.
  const all = [answer.body, ...answer.questionsToConsider, ...answer.counsel].join(' ');
  // The default 900-character cap is for replies. An answer carries a body, two
  // or three questions and a counsel line, so it gets more room.
  const verdict = filterProse(all, { maxChars: 2000 });
  if (!verdict.pass) return drop(`filter: ${verdict.violations.join(', ')}`);
  // An answer with no way forward is just a verdict.
  if (answer.questionsToConsider.length === 0 || answer.counsel.length === 0) {
    return drop('no questions or no counsel');
  }
  return answer;
}

// ------------------------------------------------------------------ the turn

function currentQuestion(s: SessionState): { text: string; id: string } {
  const q = s.currentQuestionId ? QUESTIONS.find((x) => x.id === s.currentQuestionId) : undefined;
  return q ? { text: q.text, id: q.id } : { text: OPENING, id: s.currentQuestionId ?? 'opening' };
}

export async function takeConversationTurn(
  s: ConvState, text: string, deps: ConvDeps,
): Promise<{ state: ConvState; output: ConversationOutput }> {
  const phase = deps.phase ?? PHASE;
  const now = deps.now ?? new Date();
  const { tier } = concernTier(text);
  const live = deps.live;

  // Faith Q&A. Not an answer to the bank, so it is not recorded as an entry and
  // does not advance the question gate. Acute and elevated skip it entirely.
  if (phase >= 2 && live && (tier === 'none' || tier === 'mild') && isAskingUs(text)) {
    let answer: FaithAnswer | null = null;
    try {
      answer = await generateAnswer(live, text, s.entries);
    } catch (e) {
      console.warn('[whyfinder] answer threw:', e instanceof Error ? e.message : String(e));
      answer = null;
    }
    const q = currentQuestion(s);
    const care = careFor(tier) ?? undefined;
    return {
      state: s,
      output: {
        kind: 'question', text: q.text, questionId: q.id, care,
        answer: answer ?? { body: ANSWER_FALLBACK, kind: 'ai_inference', scripture: [], questionsToConsider: [], counsel: [] },
      },
    };
  }

  // Start the reply alongside the turn. It only needs what the person has said.
  const heard = [...s.entries, { text }];
  const replyP: Promise<string | null> =
    phase >= 2 && live && tier === 'none'
      ? generateReply(live, heard).catch(() => null)
      : Promise.resolve(null);

  const before = s.synthesesOffered.length;
  const r = await takeTurn(s, text, deps.turn);
  let state = r.state as ConvState;
  state = { ...state, experiments: s.experiments };
  const output: ConversationOutput = { ...r.output };

  if (output.kind === 'acute') return { state, output };

  const care = careFor(tier);
  if (care) output.care = care;

  const reply = await replyP;
  if (reply) output.reply = reply;

  // One experiment per session, after the first synthesis is shown.
  const synthesis = (r.output as { synthesis?: Synthesis }).synthesis;
  if (phase >= 3 && tier === 'none' && synthesis && state.synthesesOffered.length > before
      && (state.experiments ?? []).length === 0) {
    const x: Experiment = pickExperiment(state.entries as Entry[]);
    const o = offer(state, x, now);
    state = o.state;
    output.experiment = { id: o.record.id, title: o.record.title, source: o.record.source };
  }
  return { state, output };
}