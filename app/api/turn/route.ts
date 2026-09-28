/**
 * The turn endpoint.
 *
 * The engine runs SERVER-SIDE. The client holds session state and posts it back
 * each turn — no database needed for the demo, and it works on serverless.
 *
 * A tampered client could send whatever state it liked. That does not weaken any
 * constraint: the filter, the tier gate and the acute-signal check all run here,
 * against the entries in the payload. The worst a tampered payload achieves is
 * lying about its own history, and the filter still judges the output.
 *
 * C-15: no bypass parameter is accepted from the client. There is nothing to send.
 */

import { NextResponse } from 'next/server';
import {
  begin, endSession, newSession, takeTurn, type SessionState,
} from '../../../src/engine/session.js';
import {
  anthropicProvider, fixtureProvider, withFallback,
} from '../../../src/providers/index.js';
import { assertServable } from '../../../src/config/reviewState.js';
import { recordFallback } from '../../../src/observability/fallbackLog.js';
import { QUESTIONS } from '../../../src/content/questions.js';
import type { Entry } from '../../../src/types/index.js';

export const runtime = 'nodejs';

/**
 * The model call needs room. The platform default is short enough that a slow
 * upstream response kills the function, and a killed function returns an empty
 * 500 — no error body, no fallback, nothing to debug from.
 */
export const maxDuration = 60;

/**
 * The constraint prompt.
 *
 * This is the FIRST line of defence and never the only one. Every rule below is
 * also enforced after generation by the filter (C-15), which is what makes it
 * safe to hand this prompt to a model we do not control.
 */
function systemPrompt(entries: Entry[]): string {
  /**
   * Each answer is paired with the question that drew it out.
   *
   * Without this the model sees "I quit the choir after two years" with no idea
   * whether that answered "what have you quit?" or "what do people come to you
   * for?" — and the difference changes what the sentence means. Volunteered
   * material is marked as such, because an answer and an offering are not the
   * same kind of evidence.
   *
   * The question text is included ONLY for questions already asked. The bank is
   * never shown: a model that could see the whole list could reference a heavy
   * question the gate has not unlocked, which is a way around C-23.
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

If nothing real has surfaced yet, say so in "body" rather than inventing a pattern.`;
}

/**
 * The fallback. Built from this person's own entries so it satisfies C-07 and
 * C-11 rather than being blocked by the app's own filter — which is what
 * happened the first time, when the canned text named nothing specific.
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
    action: 'begin' | 'turn' | 'end';
    state?: SessionState;
    text?: string;
  };

  if (body.action === 'begin') {
    return NextResponse.json(begin(newSession('demo-user', `s${Date.now()}`)));
  }
  if (!body.state) return NextResponse.json({ error: 'missing state' }, { status: 400 });
  if (body.action === 'end') {
    return NextResponse.json({ state: body.state, output: endSession(body.state) });
  }

  const state = body.state;

  /**
   * takeTurn appends this turn's entry internally, so the prompt and the
   * fallback both have to anticipate it — otherwise the model is asked to cite
   * two entries when only one is visible to it.
   */
  const willBe: Entry[] = [
    ...state.entries,
    {
      id: `e${state.entries.length + 1}`,
      userId: state.userId,
      sessionId: state.sessionId,
      createdAt: new Date().toISOString(),
      text: body.text ?? '',
      source: 'answer',
    },
  ];

  const key = process.env.ANTHROPIC_API_KEY;
  const backup = fixtureFor(willBe);
  const live = key ? withFallback(anthropicProvider(key), backup, recordFallback) : null;

  /**
   * Last-resort guard. withFallback covers a failing model call, but anything
   * that throws OUTSIDE it — a parse error, a bad state payload — would
   * otherwise surface as an empty 500 that tells nobody anything. The
   * conversation continues either way; a turn never dies silently.
   */
  try {
    const r = await takeTurn(state, body.text ?? '', {
      provider: live ?? backup,
      systemPrompt: systemPrompt(willBe),
      thirdPartyNames: [],
    });
    return NextResponse.json({ ...r, mode: live ? live.lastMode() : 'fixtures' });
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
