/**
 * The turn endpoint.
 *
 * The engine runs SERVER-SIDE. The client holds session state and posts it back
 * each turn. No database needed for the demo, and it works on serverless.
 *
 * A tampered client could send whatever state it liked. That does not weaken any
 * constraint: the filter, the tier gate and the acute-signal check all run here,
 * against the entries in the payload. The worst a tampered payload achieves is
 * lying about its own history, and the filter still judges the output.
 *
 * C-15: no bypass parameter is accepted from the client. There is nothing to send.
 *
 * Changes in this version: turns go through takeConversationTurn (reply layer,
 * faith Q&A, experiments), and two small actions ('experiment', 'reflect') carry
 * the experiment card's taps. takeTurn itself is untouched.
 */

import { NextResponse } from 'next/server';
import {
  begin, endSession, newSession, type SessionState,
} from '../../../src/engine/session.js';
import { glooEnabled, glooGuardedProvider, withRetry } from '../../../src/providers/gloo.js';
import { resumeQuestions, takeConversationTurn, type ConvState } from '../../../src/engine/conversation.js';
import {
  chooseExperiment, recordReflection, type ExperimentChoice, type Feel,
} from '../../../src/content/experiments.js';
import {
  anthropicProvider, fixtureProvider, withFallback,
} from '../../../src/providers/index.js';
import { assertServable } from '../../../src/config/reviewState.js';
import { recordFallback } from '../../../src/observability/fallbackLog.js';
import { QUESTIONS } from '../../../src/content/questions.js';
import type { Entry, ModelProvider } from '../../../src/types/index.js';

export const runtime = 'nodejs';

/**
 * The model call needs room. A turn can now make up to three model calls (the
 * synthesis, a retry, and the reply), so the ceiling stays generous.
 */
export const maxDuration = 60;

function systemPrompt(entries: Entry[]): string {
  /**
   * Each answer is paired with the question that drew it out. Volunteered
   * material is marked as such. The question text is included ONLY for
   * questions already asked; the bank is never shown (C-23).
   */
  const catalogue = entries
    .map((e) => {
      const q = e.questionId ? QUESTIONS.find((x) => x.id === e.questionId) : undefined;
      if (q) return `  ${e.id}\n    asked: ${q.text}\n    said:  ${e.text}`;
      return `  ${e.id}\n    volunteered: ${e.text}`;
    })
    .join('\n\n');

  return `You are the mentor voice in WhyFinder, a tool that helps a person notice
patterns in their own life. You are not a therapist, pastor or counselor, and you
do not know what God intends for anyone.

Here is everything this person has told you, each with the question that drew it
out. Some entries were volunteered rather than answered — treat those as offered
freely, not as replies.

${catalogue}

Return ONLY a JSON object, no prose around it:

{
  "body": "<one or two sentences>",
  "evidence": ["<id>", "<id>"],
  "concreteNouns": ["<noun>", "<noun>"],
  "kind": "ai_inference"
}

Hard rules. Output that breaks any of these is discarded before the person sees it.

- "evidence" must name at least TWO different ids from the list above. Use the ids
  exactly as written. Never invent one.
- "concreteNouns" must contain words the person themselves wrote — from the
  "said" or "volunteered" lines, never from a question WhyFinder asked. A place,
  role, event, activity or person they actually named. Never a trait word like
  "authenticity" or "connection". Each noun must also appear in "body".
- "body" must be a hypothesis or a question, never a claim about who they are.
  "Worth exploring whether…", "Does that fit?", "might", "seems" are all fine.
- Never write "you are a", "your purpose is", "your calling is", "you're the kind
  of person who", "God wants you to", or anything of that shape.
- Never say that something in their past caused something in their present. You
  may put two of their own statements side by side and ASK whether they connect.
  You may not supply the "because".
- Never describe the inner life of anyone but this person — not a parent, partner,
  friend or colleague they mentioned.
- Never use a clinical or personality-typology label (ADHD, Enneagram, INTJ,
  burnout, attachment style) unless they used that exact word themselves first.
- Describe what they keep DOING, not what they ARE.
- Ignore entries that are only a few words or a deflection ("not much", "idk",
  "nothing"). Never cite one as evidence for anything.

If nothing real has surfaced yet, say so in "body" rather than inventing a pattern.`;
}

/**
 * The fallback. Built from this person's own entries so it satisfies C-07 and
 * C-11 rather than being blocked by the app's own filter.
 */
function fixtureFor(entries: Entry[]) {
  const first = entries.slice(0, 2);
  const phrases = first.map((e) => e.text.split(/\s+/).slice(0, 5).join(' '));
  return fixtureProvider([
    JSON.stringify({
      body: `Two things you have described — "${phrases[0]}…" and "${phrases[1]}…" — both involve working something out alongside another person, rather than on your own. Worth exploring whether that matters?`,
      evidence: first.map((e) => e.id),
      concreteNouns: phrases,
      kind: 'ai_inference',
    }),
  ]);
}

export async function POST(req: Request) {
  try {
    assertServable();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 410 });
  }

  const body = (await req.json()) as {
    action: 'begin' | 'turn' | 'end' | 'experiment' | 'reflect' | 'resume';
    state?: ConvState;
    text?: string;
    experimentId?: string;
    choice?: ExperimentChoice;
    feel?: Feel;
    note?: string;
  };

  if (body.action === 'begin') {
    return NextResponse.json(begin(newSession('demo-user', `s${Date.now()}`)));
  }
  if (!body.state) return NextResponse.json({ error: 'missing state' }, { status: 400 });
  if (body.action === 'end') {
    return NextResponse.json({ state: body.state, output: endSession(body.state as SessionState) });
  }

  // "Back to the questions" after the support pause. No model call.
  if (body.action === 'resume') {
    return NextResponse.json(resumeQuestions(body.state));
  }

  // The experiment card's taps. State only; no model call.
  if (body.action === 'experiment' && body.experimentId && body.choice) {
    return NextResponse.json({
      state: chooseExperiment(body.state, body.experimentId, body.choice),
    });
  }
  if (body.action === 'reflect' && body.experimentId && body.feel) {
    return NextResponse.json({
      state: recordReflection(body.state, body.experimentId, body.feel, body.note, new Date()),
    });
  }

  const state = body.state;

  /**
   * takeTurn appends this turn's entry internally, so the prompt and the
   * fallback both have to anticipate it. It carries the question the person is
   * answering, so the model does not read an answer as volunteered.
   */
  const willBe: Entry[] = [
    ...state.entries,
    {
      id: `e${state.entries.length + 1}`,
      userId: state.userId,
      sessionId: state.sessionId,
      createdAt: new Date().toISOString(),
      text: body.text ?? '',
      source: state.currentQuestionId ? 'answer' : 'volunteered',
      questionId: state.currentQuestionId ?? undefined,
    },
  ];

  const key = process.env.ANTHROPIC_API_KEY;
  // With a live model configured, a failed call must never turn into canned
  // output dressed as a real guess. The backup says nothing, and the person is
  // told plainly. Fixtures stay only for the no-key demo mode.
  const degraded = { v: false };
  const silent: ModelProvider = {
    name: 'fixture',
    async complete() { degraded.v = true; return ''; },
  };
  const backup = key || glooEnabled(process.env) ? silent : fixtureFor(willBe);
  // Gloo is used only when explicitly enabled (key AND C-21 confirmation).
  // Order: Gloo (retry once) -> Anthropic -> recorded fallback.
  const gloo = glooEnabled(process.env)
    ? withFallback(
        withRetry(glooGuardedProvider(process.env.GLOO_API_KEY as string, {
          model: process.env.GLOO_MODEL || undefined,
          tradition: process.env.GLOO_TRADITION || undefined,
        })),
        key ? anthropicProvider(key) : backup,
        recordFallback,
      )
    : null;
  const live = gloo
    ? withFallback(gloo, backup, recordFallback)
    : key ? withFallback(anthropicProvider(key), backup, recordFallback) : null;

  try {
    const r = await takeConversationTurn(state, body.text ?? '', {
      turn: {
        provider: live ?? backup,
        systemPrompt: systemPrompt(willBe),
        thirdPartyNames: [],
      },
      // Replies and answers need the real model. On fixtures they are skipped,
      // never faked.
      live: live ?? undefined,
      // YouVersion verse text. Off without a key. Only references are sent.
      scripture: process.env.YVP_APP_KEY
        ? { appKey: process.env.YVP_APP_KEY, bibleId: process.env.YVP_BIBLE_ID }
        : undefined,
    });
    return NextResponse.json({
      ...r,
      mode: live ? (degraded.v ? 'fallback' : 'primary') : 'fixtures',
      degraded: degraded.v,
      fallbackReason: live ? live.lastError() : null,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[whyfinder] turn failed:', detail);
    return NextResponse.json(
      {
        state,
        output: { kind: 'question', text: 'Say a bit more about that.', questionId: 'recovery' },
        mode: 'error',
        detail: detail.slice(0, 300),
      },
      { status: 200 },
    );
  }
}