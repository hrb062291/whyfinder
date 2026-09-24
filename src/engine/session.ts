/**
 * The conversation engine.
 *
 * Order of operations per turn is not arbitrary. The acute-signal check runs
 * BEFORE anything else, because C-06 requires stopping the purpose exercise —
 * and an exercise that has already generated its reply has not stopped.
 */

import { assertServable } from '../config/reviewState.js';
import { acuteResponse, detectAcuteSignal } from '../constraints/acuteSignal.js';
import { filterSynthesis } from '../constraints/filter.js';
import {
  type GateState, emptyState, isSubstantive, nextQuestion, recordAnswer, recordServed,
} from '../constraints/questionGate.js';
import { CRISIS_RESOURCES } from '../constraints/acuteSignal.js';
import { propose, type ConfirmCard } from '../profile/store.js';
import type { Entry, FilterContext, FilterVerdict, ModelProvider, Synthesis } from '../types/index.js';

/** Hard cap, enforced in code, not in the prompt. */
export const MAX_SYNTHESES_PER_SESSION = 3;

/**
 * Confirm cards get the same discipline as syntheses.
 *
 * A 25-minute session touching fears, regrets, beliefs and constraints could
 * throw up eight or ten confirmation dialogs. That session does not feel like a
 * conversation, and it is what produces the argument for flipping
 * confirm-by-default — which is the wrong fix for the right complaint.
 *
 * Three inline. The rest queue as ordinary entries and can be proposed in a
 * later session; nothing is lost, it is simply not committed to memory today.
 */
export const MAX_CONFIRM_CARDS_PER_SESSION = 3;

/** Bounded retry. Past this the app says nothing rather than trying softer. */
export const MAX_GENERATION_ATTEMPTS = 2;

/**
 * C-22 — stated before the first substantive question. Both statements.
 * No human-review disclosure appears, because C-03 means there is none.
 */
export const FIRST_RUN_DISCLOSURE =
  'Before we start, two things. I am not a therapist, pastor or licensed counselor — ' +
  'I am a tool for thinking out loud. And training on anything you write here is off ' +
  'unless you turn it on yourself in settings.';

/** P-01 — open with what is on their mind. Never the word "purpose". */
export const OPENING = 'Tell me what has been on your mind lately.';

/** P-04 — the honest no-op is a designed state with its own copy. */
export const NO_OP =
  'Nothing new surfaced today, and that is fine — some sessions are just keeping the thread warm.';

export interface SessionState {
  sessionId: string;
  userId: string;
  disclosureShown: boolean;
  entries: Entry[];
  synthesesOffered: Synthesis[];
  /** Critic A audits this for false negatives — what the gate wrongly cut. */
  suppressionLog: { body: string; verdict: FilterVerdict }[];
  gate: GateState;
  currentQuestionId: string | null;
  acuteFired: boolean;
  /** Confirm cards shown this session. Capped. */
  cardsShown: number;
  /** Proposals that hit the cap. Not lost — just not committed today. */
  cardQueue: { field: string; value: string; sourceEntries: string[] }[];
}

export function newSession(userId: string, sessionId: string): SessionState {
  return {
    sessionId, userId,
    disclosureShown: false,
    entries: [],
    synthesesOffered: [],
    suppressionLog: [],
    gate: emptyState(userId),
    currentQuestionId: null,
    acuteFired: false,
    cardsShown: 0,
    cardQueue: [],
  };
}

/**
 * Propose a profile line. Auto-write fields bypass the card entirely (C-17).
 * Confirm-required fields get a card until the session cap is reached, then
 * queue.
 */
export function proposeLine(
  s: SessionState,
  field: string,
  value: string,
  sourceEntries: string[],
): { state: SessionState; card?: ConfirmCard; autoWritten?: boolean; queued?: boolean } {
  const result = propose(field, value, sourceEntries);
  if ('autoWritten' in result) return { state: s, autoWritten: true };

  if (s.cardsShown >= MAX_CONFIRM_CARDS_PER_SESSION) {
    return {
      state: { ...s, cardQueue: [...s.cardQueue, { field, value, sourceEntries }] },
      queued: true,
    };
  }
  return { state: { ...s, cardsShown: s.cardsShown + 1 }, card: result };
}

export type TurnOutput =
  | { kind: 'disclosure'; text: string; then: string }
  | { kind: 'acute'; response: ReturnType<typeof acuteResponse> }
  | { kind: 'question'; text: string; questionId: string; synthesis?: Synthesis }
  | { kind: 'noop'; text: string; synthesis?: Synthesis }
  | { kind: 'exhausted'; text: string };

export function buildContext(s: SessionState, thirdPartyNames: string[] = [],
                             userSuppliedLabels: string[] = []): FilterContext {
  return {
    entriesById: Object.fromEntries(s.entries.map((e) => [e.id, e.text])),
    userSuppliedLabels,
    thirdPartyNames,
    reviewState: 'DEMO',
  };
}

/** C-05 — reachable in one tap from every conversational surface. */
export function crisisAffordance() {
  return { label: 'Need to talk to someone now', resources: CRISIS_RESOURCES };
}

/**
 * Begin. C-22 fires before any substantive question, always.
 */
export function begin(s: SessionState): { state: SessionState; output: TurnOutput } {
  assertServable();
  if (s.disclosureShown) {
    return { state: s, output: { kind: 'question', text: OPENING, questionId: 'opening' } };
  }
  return {
    state: { ...s, disclosureShown: true },
    output: { kind: 'disclosure', text: FIRST_RUN_DISCLOSURE, then: OPENING },
  };
}

export interface TurnDeps {
  provider: ModelProvider;
  systemPrompt: string;
  /** Names the user has mentioned, for C-13. Extracted upstream. */
  thirdPartyNames?: string[];
  /** Labels the user used about themselves, for C-14. */
  userSuppliedLabels?: string[];
  now?: Date;
}

/**
 * One turn.
 *
 * 1. Expiry.       2. Acute signal — before anything else.
 * 3. Record entry. 4. Maybe synthesise (capped, filtered, bounded).
 * 5. Next question, or the honest no-op.
 */
export async function takeTurn(
  s: SessionState,
  userText: string,
  deps: TurnDeps,
): Promise<{ state: SessionState; output: TurnOutput }> {
  assertServable(deps.now);
  const now = deps.now ?? new Date();

  // --- C-06. Stops the exercise. C-04: nothing locks; the app stays usable.
  const signal = detectAcuteSignal(userText);
  if (signal.fired) {
    return {
      state: { ...s, acuteFired: true },
      output: { kind: 'acute', response: acuteResponse() },
    };
  }

  // --- record
  const entry: Entry = {
    id: `e${s.entries.length + 1}`,
    userId: s.userId,
    sessionId: s.sessionId,
    createdAt: now.toISOString(),
    text: userText,
    source: s.currentQuestionId ? 'answer' : 'volunteered',
    questionId: s.currentQuestionId ?? undefined,
  };
  let state: SessionState = { ...s, entries: [...s.entries, entry] };

  if (state.currentQuestionId && state.currentQuestionId !== 'opening') {
    const { QUESTIONS } = await import('../content/questions.js');
    const q = QUESTIONS.find((x) => x.id === state.currentQuestionId);
    if (q) state = { ...state, gate: recordAnswer(state.gate, q, userText, now) };
  } else if (isSubstantive(userText)) {
    // Volunteered material still counts as breadth, under its own pseudo-category.
    state = {
      ...state,
      gate: {
        ...state.gate,
        substantiveAnswers: [
          ...state.gate.substantiveAnswers,
          { questionId: entry.id, category: 'volunteered', at: now.toISOString() },
        ],
      },
    };
  }

  // --- synthesis
  let synthesis: Synthesis | undefined;
  const capReached = state.synthesesOffered.length >= MAX_SYNTHESES_PER_SESSION;
  if (!capReached && state.entries.length >= 2) {
    const attempt = await trySynthesise(state, deps);
    state = attempt.state;
    synthesis = attempt.synthesis;
  }

  // --- next question
  const q = nextQuestion(state.gate, now);
  if (!q) {
    return {
      state,
      output: synthesis
        ? { kind: 'noop', text: NO_OP, synthesis }
        : { kind: 'exhausted', text: NO_OP },
    };
  }
  state = { ...state, gate: recordServed(state.gate, q, now), currentQuestionId: q.id };
  return { state, output: { kind: 'question', text: q.text, questionId: q.id, synthesis } };
}

/**
 * Generate, filter, and give up honestly.
 *
 * Every rejected candidate is logged. Critic A audits the log for false
 * negatives — the real observation the gate wrongly cut. A gate tuned only
 * against noise eventually silences the one thing that mattered.
 */
/**
 * Repair guidance for the second attempt.
 *
 * Passes the RULE, never the matched string. Hand a model the substring that
 * tripped the filter and it learns to route around the pattern while keeping
 * the claim — "everything you've described points to a teacher" satisfies the
 * C-09 regex and violates C-09's intent completely. That is Goodharting the
 * filter, and it is how this architecture rots from the inside.
 *
 * The matched string stays in the suppression log, for humans.
 */
export function buildRepairGuidance(verdict: FilterVerdict): string {
  const rules = [...new Set(verdict.violations.map((v) => `${v.constraint}: ${v.rule}`))];
  return [
    'Your previous candidate was rejected. The observation may well be sound —',
    'what failed is how it was expressed. Re-express it without weakening it:',
    'keep the same evidence and the same concrete details.',
    '',
    ...rules.map((r) => `  - ${r}`),
  ].join('\n');
}

/**
 * A repair must not be a retreat. If the second candidate rests on less of the
 * person's own material than the first did, the model has not fixed the
 * phrasing — it has gone vague enough to slip through, which is the horoscope
 * failure arriving by the back door.
 */
export function isDilution(repaired: Synthesis, blocked: Synthesis): boolean {
  return (
    new Set(repaired.evidence).size < new Set(blocked.evidence).size ||
    repaired.concreteNouns.length < blocked.concreteNouns.length
  );
}

async function trySynthesise(
  s: SessionState,
  deps: TurnDeps,
): Promise<{ state: SessionState; synthesis?: Synthesis }> {
  const ctx = buildContext(s, deps.thirdPartyNames, deps.userSuppliedLabels);
  let state = s;
  let firstBlocked: Synthesis | undefined;
  let guidance = '';

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const system = guidance ? `${deps.systemPrompt}\n\n${guidance}` : deps.systemPrompt;
    const raw = await deps.provider.complete(
      s.entries.map((e) => ({ role: 'user', content: e.text })),
      system,
    );
    const parsed = parseCandidate(raw, s);
    if (!parsed) continue;

    const verdict = filterSynthesis(parsed, ctx);

    if (verdict.pass) {
      // A pass is not enough if it got there by going vague.
      if (firstBlocked && isDilution(parsed, firstBlocked)) {
        state = {
          ...state,
          suppressionLog: [
            ...state.suppressionLog,
            {
              body: parsed.body,
              verdict: {
                ...verdict,
                pass: false,
                violations: [{
                  constraint: 'DILUTION',
                  rule: 'Repair rested on less of the user\'s own material than the blocked candidate.',
                }],
              },
            },
          ],
        };
        return { state };
      }
      return {
        state: { ...state, synthesesOffered: [...state.synthesesOffered, parsed] },
        synthesis: parsed,
      };
    }

    state = { ...state, suppressionLog: [...state.suppressionLog, { body: parsed.body, verdict }] };
    if (!firstBlocked) firstBlocked = parsed;
    guidance = buildRepairGuidance(verdict);
  }
  // Nothing survived. P-04: say nothing rather than ship something softer.
  return { state };
}

/**
 * End of session. P-04 — the honest no-op is a designed state.
 *
 * A session where every candidate was blocked previously ended in silence, with
 * the app simply asking another question. That is not the honest no-op; that is
 * the app changing the subject.
 */
export function endSession(s: SessionState): { kind: 'noop' | 'summary'; text: string } {
  if (s.synthesesOffered.length === 0) return { kind: 'noop', text: NO_OP };
  return {
    kind: 'summary',
    text: `Here is what came up today — ${s.synthesesOffered.length} thing${
      s.synthesesOffered.length === 1 ? '' : 's'
    } worth sitting with. Keep what fits, throw out what does not.`,
  };
}

/**
 * The model returns JSON: { body, evidence[], concreteNouns[], kind }.
 * Anything malformed is discarded — the filter never sees a half-parsed
 * candidate, and a model that will not produce structure does not get to
 * bypass the structure by returning prose.
 */
export function parseCandidate(raw: string, s: SessionState): Synthesis | null {
  let obj: Record<string, unknown>;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof obj.body !== 'string' || !Array.isArray(obj.evidence)) return null;
  return {
    id: `syn${s.synthesesOffered.length + 1}`,
    userId: s.userId,
    sessionId: s.sessionId,
    body: obj.body,
    evidence: (obj.evidence as unknown[]).filter((x): x is string => typeof x === 'string'),
    concreteNouns: Array.isArray(obj.concreteNouns)
      ? (obj.concreteNouns as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    kind: (obj.kind as Synthesis['kind']) ?? 'ai_inference',
    status: 'offered',
    derivedFrom: [],
    affordances: { accept: true, reject: true, edit: true },
  };
}
