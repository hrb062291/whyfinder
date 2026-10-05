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
import { nextQuestion, recordServed } from '../constraints/questionGate.js';
import {
  SUPPORT_CHECKIN, SUPPORT_CONTINUE, evaluateSupport, isThin, saysNothingYet, supportCard,
  type SupportCard, type SupportState,
} from '../constraints/support.js';
import { QUESTIONS } from '../content/questions.js';
import {
  offer, pickExperiment, type Experiment, type ExperimentRecord,
} from '../content/experiments.js';
import { fetchPassages, type Passage, type YvConfig } from '../content/scripture.js';
import { STATEMENT_KINDS, type Entry, type ModelProvider, type StatementKind, type Synthesis } from '../types/index.js';
import { NO_OP, OPENING, takeTurn, type SessionState, type TurnDeps, type TurnOutput } from './session.js';

export type ConvState = SessionState & {
  experiments?: ExperimentRecord[];
  support?: SupportState;
  /** How many follow-ups in a row we have asked. After two, the bank gets a turn. */
  followStreak?: number;
};

export interface FaithAnswer {
  body: string;
  kind: StatementKind;
  /** References only, never quoted text. */
  scripture: string[];
  questionsToConsider: string[];
  counsel: string[];
  /** Real verse text from YouVersion, when configured. Never written by the model. */
  passages?: Passage[];
}

export type ConversationOutput = TurnOutput & {
  care?: Care;
  reply?: string;
  answer?: FaithAnswer;
  /** Shown once, when the session has felt heavy for a while. Fixed text. */
  support?: SupportCard;
  experiment?: { id: string; title: string; source: ExperimentRecord['source'] };
};

export interface ConvDeps {
  /** What takeTurn needs. */
  turn: TurnDeps;
  /** The LIVE model only. Left undefined on fixtures: replies and answers need a real model. */
  live?: ModelProvider;
  phase?: number;
  now?: Date;
  /** YouVersion. Left undefined, answers show plain references. */
  scripture?: YvConfig;
}

const MAX_FOLLOW_STREAK = 2;

// ------------------------------------------------------------------ prompts

function said(entries: { text: string }[]): string {
  return entries.map((e, i) => `  ${i + 1}. ${e.text}`).join('\n');
}

export function replyPrompt(entries: { text: string }[]): string {
  return `You are the mentor voice in WhyFinder, a journal and navigator for noticing patterns in one's own life. You are not a therapist, pastor or counselor.

What this person has told you so far, oldest first:
${said(entries)}

Write ONE or TWO plain sentences responding to the most recent thing they said.

- Name something specific they just told you, in their own words, so they feel heard.
- If something they said EARLIER connects to it, you may set the two side by side as a question, using their own words: "Earlier you mentioned the billing system; does explaining things come up here too?" Never say one caused the other.
- Warm and plain, like a thoughtful friend. No advice, no diagnosis, no explaining why they feel or act this way.
- Never write "you are a", "your purpose is", "that's why", "because", or anything about what God wants.
- Never describe the inner life of anyone but this person.
- Only if the message is empty of anything concrete, reply with exactly: NONE
Return only the sentences, no JSON.`;
}

export function followUpPrompt(entries: { text: string }[]): string {
  // The questions go a little deeper as the conversation does, so it has a direction.
  const real = entries.filter((e) => !isThin(e.text)).length;
  const aim =
    real <= 2
      ? 'what they actually did or what it involved: the concrete details.'
      : real <= 4
        ? 'how it was for them: what held their attention, what drained them, or who it was for.'
        : 'what they might want more of, or one small thing they could try next to find out.';
  return `You are the mentor voice in WhyFinder. You are not a therapist, pastor or counselor.

What this person has told you so far, oldest first:
${said(entries)}

Ask ONE short follow-up question about something concrete in their MOST RECENT message: a thing they did, a person, a place, a task. The kind of question a curious friend asks to hear more.

Aim the question at ${aim}

- Use one of their own words for the thing you are asking about.
- Open-ended: it should invite a sentence or two, not yes or no.
- Under 140 characters. One question mark. No advice and no explanation.
- Do not start with "Why". Do not guess how they feel. Do not mention purpose, calling or God unless they did.
- If their message has nothing concrete to ask about, reply with exactly: NONE
Return only the question.`;
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
- Avoid "because", "that is why" and "which explains" when linking their feelings to causes. Put two separate observations side by side instead.
- If they describe anxiety, low mood or distress: acknowledge it plainly in one sentence, never diagnose or name a condition, and give no medical advice. Ordinary, low-risk steps (writing the worry down, a short walk, telling one person) are fine. Say that a doctor or licensed counselor can help, and put one of those in "counsel" alongside a pastor or trusted friend.
- "questionsToConsider" has two or three questions. "counsel" has one or two entries.`;
}

// ------------------------------------------------------------------ detection

const INTERROGATIVE = /^(?:how|what|why|should|does|do|is|can|will|where|who|when|am|are|would|could)\b/i;
const FAITH_OR_DIRECTION =
  /\b(god|jesus|christ|bible|scripture|pray|prayer|faith|sin|church|calling|called|purpose|direction|meaning|career|job|quit|leave|marry|move|anxiety|anxious|stress|stressed|worry|worried|lonely|depressed|overwhelmed|cope|afraid|scared)\b/i;

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

const STOP = new Set(['that','this','with','what','when','where','which','about','there','their','them','they',
  'then','than','have','were','been','your','from','just','like','really','very','some','more','much','also',
  'into','over','only','still','would','could','should','because','while','after','before','being','doing',
  'most','many','spent','life','time','things','thing','matters','matter','feel','feels','want','wants','mean','means']);

const contentWords = (t: string): Set<string> =>
  new Set((t.toLowerCase().match(/[a-z']{4,}/g) ?? []).filter((w) => !STOP.has(w)));

/**
 * One short follow-up about something the person actually said. It is checked,
 * not trusted: it must be a single question, pass the prose filter, and reuse
 * at least one of their own words. Anything else becomes null and the bank asks.
 */
export async function generateFollowUp(
  live: ModelProvider, entries: { text: string }[],
): Promise<string | null> {
  const raw = (await live.complete(
    entries.map((e) => ({ role: 'user', content: e.text })), followUpPrompt(entries),
  )).trim().replace(/^["“]|["”]$/g, '');
  if (!raw || /^none\b/i.test(raw)) return null;
  if (raw.length > 180 || (raw.match(/\?/g) ?? []).length !== 1 || !raw.endsWith('?')) return null;
  if (/^why\b/i.test(raw) || /\b(?:purpose|calling)\b/i.test(raw)) return null;
  if (!filterProse(raw, { maxChars: 200 }).pass) return null;
  const last = entries[entries.length - 1]?.text ?? '';
  const theirs = contentWords(last);
  const used = [...contentWords(raw)].some((w) => theirs.has(w));
  return used ? raw : null;
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

/**
 * Passed to takeTurn when no guess should be attempted. It returns nothing, so
 * the engine's own parse step finds no candidate and moves on. The entry is
 * still recorded; only the guess is withheld.
 */
const NO_SYNTHESIS: ModelProvider = { name: 'fixture', async complete() { return ''; } };

/** Back to the question bank after the support pause. No model call. */
export function resumeQuestions(
  s: ConvState, now: Date = new Date(),
): { state: ConvState; output: ConversationOutput } {
  const support = s.support ? { ...s.support, active: false } : undefined;
  const q = nextQuestion(s.gate, now);
  if (!q) return { state: { ...s, support }, output: { kind: 'exhausted', text: NO_OP } };
  return {
    state: { ...s, support, gate: recordServed(s.gate, q, now), currentQuestionId: q.id },
    output: { kind: 'question', text: q.text, questionId: q.id },
  };
}

export async function takeConversationTurn(
  s: ConvState, text: string, deps: ConvDeps,
): Promise<{ state: ConvState; output: ConversationOutput }> {
  const phase = deps.phase ?? PHASE;
  const now = deps.now ?? new Date();
  const { tier } = concernTier(text);
  const live = deps.live;

  // The running count. Acute language never reaches it: that is takeTurn's path.
  const ev = phase >= 2 && tier !== 'acute'
    ? evaluateSupport(s.support, text, tier)
    : { next: s.support, showCard: false };
  const paused = phase >= 2 && Boolean(ev.next?.active);
  const checkin = ev.showCard ? SUPPORT_CHECKIN : SUPPORT_CONTINUE;

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
    if (answer && deps.scripture && answer.scripture.length > 0) {
      const passages = await fetchPassages(answer.scripture, deps.scripture).catch(() => []);
      if (passages.length > 0) answer = { ...answer, passages };
    }
    const q = currentQuestion(s);
    const care = (ev.showCard && tier === 'mild' ? null : careFor(tier)) ?? undefined;
    return {
      state: { ...s, support: ev.next },
      output: {
        kind: 'question',
        text: paused ? checkin : q.text,
        questionId: paused ? 'support' : q.id,
        care,
        support: ev.showCard ? supportCard(tier) : undefined,
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

  // A short follow-up about what they just said, every other turn, never when
  // they are struggling, giving a thin answer, or the pause is on.
  const followP: Promise<string | null> =
    phase >= 2 && live && tier === 'none' && !paused && !isThin(text) && (s.followStreak ?? 0) < MAX_FOLLOW_STREAK
      ? generateFollowUp(live, heard).catch(() => null)
      : Promise.resolve(null);

  // No guess while the pause is on, after a thin answer, or before two real ones.
  const realAnswers = heard.filter((e) => !isThin(e.text)).length;
  const hold = phase >= 2 && (paused || isThin(text) || realAnswers < 2);

  const before = s.synthesesOffered.length;
  const r = await takeTurn(s, text, {
    ...deps.turn,
    provider: hold ? NO_SYNTHESIS : deps.turn.provider,
  });
  let state = { ...r.state, experiments: s.experiments, support: ev.next } as ConvState;
  let output: ConversationOutput = { ...r.output };

  if (output.kind === 'acute') return { state, output };

  // The support pause. The bank does not advance; the entry is already recorded.
  if (paused) {
    state = {
      ...state,
      gate: { ...state.gate, heavyServedAt: s.gate.heavyServedAt },
      currentQuestionId: 'support',
    };
    output = { kind: 'question', text: checkin, questionId: 'support' };
  }

  // The elevated line (it names 988) always stays. The card covers the mild one.
  const care = ev.showCard && tier === 'mild' ? null : careFor(tier);
  if (care) output.care = care;
  if (ev.showCard) output.support = supportCard(tier);

  const reply = await replyP;
  if (reply) output.reply = reply;

  // The model is allowed to say "nothing has surfaced yet". That is honest, but
  // it is not a guess, so it never becomes a card with a "Keep this" button.
  let synthesis = (output as { synthesis?: Synthesis }).synthesis;
  if (synthesis && saysNothingYet(synthesis.body)) {
    delete (output as { synthesis?: Synthesis }).synthesis;
    state = { ...state, synthesesOffered: state.synthesesOffered.slice(0, -1) };
    synthesis = undefined;
  }

  // Swap the bank question for a follow-up. The bank question is not used up:
  // the gate is put back, and the next turn asks it.
  const followUp = await followP;
  const hasGuess = Boolean(synthesis);
  if (followUp && !paused && !hasGuess && output.kind === 'question') {
    state = {
      ...state,
      gate: { ...state.gate, heavyServedAt: s.gate.heavyServedAt },
      currentQuestionId: 'followup',
      followStreak: (s.followStreak ?? 0) + 1,
    };
    output = { ...output, text: followUp, questionId: 'followup' };
  } else {
    state = { ...state, followStreak: 0 };
  }

  // One experiment per session, after the first synthesis is shown, and never
  // to someone the support card has just been shown to.
  if (phase >= 3 && tier === 'none' && synthesis && state.synthesesOffered.length > before
      && !state.support?.shown && (state.experiments ?? []).length === 0) {
    const x: Experiment = pickExperiment(state.entries as Entry[]);
    const o = offer(state, x, now);
    state = o.state;
    output.experiment = { id: o.record.id, title: o.record.title, source: o.record.source };
  }
  return { state, output };
}