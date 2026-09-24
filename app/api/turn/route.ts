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
import { begin, endSession, newSession, takeTurn, type SessionState } from '../../../src/engine/session.js';
import { anthropicProvider, fixtureProvider } from '../../../src/providers/index.js';
import { assertServable } from '../../../src/config/reviewState.js';

export const runtime = 'nodejs';

/**
 * The constraint prompt. Volume I is ALSO enforced after generation (C-15) —
 * this is the first line of defence, never the only one.
 */
const SYSTEM = `You are the mentor voice in WhyFinder, a tool that helps people
notice patterns in their own lives. You are not a therapist, pastor or counselor.

Return ONLY JSON: { "body": string, "evidence": string[], "concreteNouns": string[],
"kind": "ai_inference" }

Rules:
- Rest on at least TWO distinct entries. Put their ids in "evidence".
- Name at least one concrete noun the person actually supplied — a place, role,
  event, activity or person. Put them in "concreteNouns" and use them in the body.
- Phrase it as a hypothesis or a question. Never a claim about who they are.
- Never say "you are a", "your purpose is", "your calling is", "God wants you to".
- Never supply a causal link between something in their past and something now.
  You may place two of their statements side by side and ASK.
- Never characterise anyone other than the person themselves.
- Never use a clinical or personality-typology label they did not use first.
- Describe what they keep DOING, not what they ARE.`;

/**
 * Fixtures by default — costs nothing, cannot fail on stage. Set ANTHROPIC_API_KEY
 * in the environment and it switches to live generation with no code change.
 */
function provider() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) return anthropicProvider(key);
  return fixtureProvider([
    JSON.stringify({
      body: 'Both of the things you have described in most detail involve working something out alongside another person, rather than on your own. Worth exploring whether that matters?',
      evidence: ['e1', 'e2'],
      concreteNouns: [],
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
    const r = begin(newSession('demo-user', `s${Date.now()}`));
    return NextResponse.json(r);
  }

  if (!body.state) return NextResponse.json({ error: 'missing state' }, { status: 400 });

  if (body.action === 'end') {
    return NextResponse.json({ state: body.state, output: endSession(body.state) });
  }

  /**
   * Fixture mode needs the concrete nouns to come from what this person actually
   * typed, or C-11 blocks its own canned response. A live model supplies its own.
   */
  const state = body.state;

  /**
   * takeTurn appends this turn's entry internally, so the fixture has to
   * anticipate it — otherwise on turn two it sees one entry, falls back to the
   * generic canned response, and C-11 blocks it for naming nothing.
   */
  const willBe = [
    ...state.entries,
    { id: `e${state.entries.length + 1}`, text: body.text ?? '' },
  ];
  const phrases = willBe.slice(0, 2).map((e) => e.text.split(/\s+/).slice(0, 5).join(' '));

  const fixtureWithNouns = !process.env.ANTHROPIC_API_KEY && willBe.length >= 2
    ? fixtureProvider([
        JSON.stringify({
          body: `Two things you have described — "${phrases[0]}…" and "${phrases[1]}…" — both involve working something out alongside another person, rather than on your own. Worth exploring whether that matters?`,
          evidence: willBe.slice(0, 2).map((e) => e.id),
          concreteNouns: phrases,
          kind: 'ai_inference',
        }),
      ])
    : provider();

  const r = await takeTurn(state, body.text ?? '', {
    provider: fixtureWithNouns,
    systemPrompt: SYSTEM,
  });
  return NextResponse.json(r);
}
