/**
 * The output filter.
 *
 * C-15: "C-08 through C-14 are enforced post-generation as well as in the prompt.
 *        Prompt-only enforcement does not satisfy them. The filter sits in the
 *        request path with no bypass flag; an integration test with the prompt
 *        rules removed proves the filter still blocks."
 *
 * There is deliberately NO options argument, NO skip flag and NO environment
 * check in this module. If you are here to add one, read C-15 again.
 *
 * Everything below judges the candidate against the user's ACTUAL stored text.
 * The model's own claims about its output are never trusted.
 */

import type { FilterContext, FilterVerdict, Synthesis, Violation } from '../types/index.js';
import { STATEMENT_KINDS } from '../types/index.js';
import {
  ATTRIBUTION_VERBS,
  CAUSAL_CONNECTIVES,
  DECLARATIVE_SYNTHESIS,
  DIVINE_INTENT,
  HYPOTHESIS_MARKERS,
  IDENTITY_PREDICATES,
  LABEL_VOCABULARY,
  PUBLISHED_NON_POSITIONS,
  CREEDAL_TOPICS,
} from '../config/patterns.js';

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

/** C-12 exempts interrogatives: the app may ASK about a connection. */
function isQuestion(sentence: string): boolean {
  return sentence.trim().endsWith('?');
}

// ---------------------------------------------------------------- C-07

function checkEvidence(s: Synthesis, ctx: FilterContext): Violation[] {
  const distinct = new Set(s.evidence);
  if (distinct.size < 2) {
    return [{
      constraint: 'C-07',
      rule: 'No synthesis unless it rests on two or more distinct user-supplied entries.',
      match: `${distinct.size} distinct`,
    }];
  }
  const missing = [...distinct].filter((id) => !(id in ctx.entriesById));
  if (missing.length) {
    return [{
      constraint: 'C-07',
      rule: 'Every cited entry must resolve to stored user text.',
      match: missing.join(', '),
    }];
  }
  return [];
}

// ---------------------------------------------------------------- C-11

/**
 * The anti-horoscope teeth. A concrete noun must not merely be CLAIMED —
 * it must appear in what the user actually wrote. A model that invents a
 * plausible-sounding detail fails here, not in review.
 */
function checkConcreteNouns(s: Synthesis, ctx: FilterContext): Violation[] {
  if (s.concreteNouns.length === 0) {
    return [{
      constraint: 'C-11',
      rule: 'Every reflection names at least one concrete noun the user supplied.',
    }];
  }
  const corpus = normalize(Object.values(ctx.entriesById).join(' '));
  const fabricated = s.concreteNouns.filter((n) => !corpus.includes(normalize(n)));
  if (fabricated.length) {
    return [{
      constraint: 'C-11',
      rule: 'A cited concrete noun does not appear in the user\'s own text.',
      match: fabricated.join(', '),
    }];
  }
  // The noun must also actually appear in the body it supposedly grounds.
  const body = normalize(s.body);
  const grounded = s.concreteNouns.some((n) => body.includes(normalize(n)));
  if (!grounded) {
    return [{
      constraint: 'C-11',
      rule: 'No supplied concrete noun appears in the reflection itself.',
    }];
  }
  return [];
}

// ---------------------------------------------------------------- C-08

function checkHypothesisFraming(s: Synthesis): Violation[] {
  const out: Violation[] = [];
  const body = s.body.trim();

  const hedged =
    body.includes('?') || HYPOTHESIS_MARKERS.some((re) => re.test(body));

  if (!hedged) {
    out.push({
      constraint: 'C-08',
      rule: 'Every synthesis is phrased as a hypothesis or a question, never a declarative claim.',
    });
  }
  for (const re of DECLARATIVE_SYNTHESIS) {
    const m = body.match(re);
    if (m) {
      out.push({
        constraint: 'C-08',
        rule: 'Declarative claim about the person.',
        match: m[0],
      });
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- C-09

function checkIdentityPredicate(s: Synthesis): Violation[] {
  for (const re of IDENTITY_PREDICATES) {
    const m = s.body.match(re);
    if (m) {
      return [{
        constraint: 'C-09',
        rule: 'Second-person identity predicate.',
        match: m[0],
      }];
    }
  }
  return [];
}

// ---------------------------------------------------------------- C-12

function checkCausalConnective(s: Synthesis): Violation[] {
  for (const sentence of s.body.split(SENTENCE_SPLIT)) {
    if (isQuestion(sentence)) continue; // C-12 permits asking
    for (const re of CAUSAL_CONNECTIVES) {
      const m = sentence.match(re);
      if (m) {
        return [{
          constraint: 'C-12',
          rule: 'App-authored causal connective between a formative experience and a present pattern.',
          match: m[0],
        }];
      }
    }
  }
  return [];
}

// ---------------------------------------------------------------- C-13

/**
 * A stored name of "my mother" must still match "your mother" in generated
 * output — the model refers to the same person in second person. Strip the
 * leading possessive and match the bare noun.
 */
function nameVariants(name: string): string[] {
  const bare = normalize(name).replace(/^(?:my|your|his|her|their|our)\s+/, '');
  return bare === normalize(name) ? [bare] : [normalize(name), bare];
}

function checkThirdPartyAttribution(s: Synthesis, ctx: FilterContext): Violation[] {
  const body = s.body;
  const candidates = ctx.thirdPartyNames.flatMap(nameVariants);
  for (const name of candidates) {
    const idx = normalize(body).indexOf(name);
    if (idx === -1) continue;
    // Look at the clause following the name.
    const after = body.slice(idx, idx + 160);
    for (const re of ATTRIBUTION_VERBS) {
      const m = after.match(re);
      if (m) {
        return [{
          constraint: 'C-13',
          rule: 'Attributes a state, motive or pattern to a person other than the user.',
          match: `${name} … ${m[0]}`,
        }];
      }
    }
  }
  return [];
}

// ---------------------------------------------------------------- C-14

function checkLabels(s: Synthesis, ctx: FilterContext): Violation[] {
  const body = normalize(s.body);
  const userSaid = ctx.userSuppliedLabels.map(normalize);
  for (const label of LABEL_VOCABULARY) {
    const re = new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(body) && !userSaid.includes(normalize(label))) {
      return [{
        constraint: 'C-14',
        rule: 'Diagnostic, clinical or personality-typology label the user did not use first.',
        match: label,
      }];
    }
  }
  return [];
}

// ---------------------------------------------------------------- C-29

function checkKindLabel(s: Synthesis): Violation[] {
  if (!STATEMENT_KINDS.includes(s.kind)) {
    return [{
      constraint: 'C-29',
      rule: 'Output must carry exactly one of the four statement kinds.',
      match: String(s.kind),
    }];
  }
  return [];
}

// ---------------------------------------------------------------- C-30

function checkDivineIntent(s: Synthesis): Violation[] {
  for (const re of DIVINE_INTENT) {
    const m = s.body.match(re);
    if (m) {
      return [{
        constraint: 'C-30',
        rule: 'Output must never assert divine intent, instruction or calling for the user.',
        match: m[0],
      }];
    }
  }
  return [];
}

// ---------------------------------------------------------------- C-31

/**
 * The default that closes C-31's gap: anything outside the Apostles' Creed is
 * treated as a non-position, whether or not it is on the published list.
 */
export function isNonPosition(text: string): boolean {
  const t = normalize(text);
  const listed = PUBLISHED_NON_POSITIONS.some((np) =>
    np.terms.some((term) => t.includes(normalize(term))),
  );
  if (listed) return true;
  const creedal = CREEDAL_TOPICS.some((c) => t.includes(normalize(c)));
  return !creedal && /\b(?:doctrine|theolog|denomination|tradition teaches|the church teaches)\b/i.test(text);
}

function checkNonPositionHandling(s: Synthesis): Violation[] {
  if (!isNonPosition(s.body)) return [];
  const adjudicates =
    /\b(?:the (?:correct|right|biblical) (?:view|position|answer) is|scripture (?:clearly|plainly) teaches|the bible is clear that)\b/i;
  const m = s.body.match(adjudicates);
  if (m) {
    return [{
      constraint: 'C-31',
      rule: 'Adjudicates a non-position. Must name that traditions differ and route to human counsel.',
      match: m[0],
    }];
  }
  const acknowledges = /\btraditions differ|christians (?:disagree|differ)|different traditions\b/i;
  if (!acknowledges.test(s.body)) {
    return [{
      constraint: 'C-31',
      rule: 'Touches a non-position without naming that traditions differ.',
    }];
  }
  return [];
}

// ---------------------------------------------------------------- C-10

function checkAffordances(s: Synthesis): Violation[] {
  const { accept, reject, edit } = s.affordances;
  if (accept && reject && edit) return [];
  return [{
    constraint: 'C-10',
    rule: 'Every displayed synthesis carries accept, reject and edit.',
  }];
}

// ---------------------------------------------------------------- orchestrator

const CHECKS = [
  checkEvidence,
  checkConcreteNouns,
  (s: Synthesis, _c: FilterContext) => checkHypothesisFraming(s),
  (s: Synthesis, _c: FilterContext) => checkIdentityPredicate(s),
  (s: Synthesis, _c: FilterContext) => checkCausalConnective(s),
  checkThirdPartyAttribution,
  checkLabels,
  (s: Synthesis, _c: FilterContext) => checkKindLabel(s),
  (s: Synthesis, _c: FilterContext) => checkDivineIntent(s),
  (s: Synthesis, _c: FilterContext) => checkNonPositionHandling(s),
  (s: Synthesis, _c: FilterContext) => checkAffordances(s),
];

/**
 * Runs every constraint. No bypass. Returns ALL violations rather than
 * short-circuiting, because /filter-demo shows the judge everything that fired.
 */
export function filterSynthesis(s: Synthesis, ctx: FilterContext): FilterVerdict {
  const violations: Violation[] = [];
  for (const check of CHECKS) violations.push(...check(s, ctx));

  const pass = violations.length === 0;
  return {
    pass,
    violations,
    suppressedBody: pass ? undefined : s.body,
    loggedAt: new Date().toISOString(),
  };
}

/**
 * The swap test (hardened prompt § GATE).
 *
 * Take a finished synthesis and evaluate it against a DIFFERENT user's context.
 * If it still passes, it was never about this person — that is horoscope, and
 * no amount of softening fixes it.
 *
 * Returns true when the synthesis correctly FAILS on the foreign context.
 */
export function passesSwapTest(s: Synthesis, foreign: FilterContext): boolean {
  return !filterSynthesis(s, foreign).pass;
}
