/**
 * Post-generation checks for free prose (replies and faith answers).
 *
 * The synthesis filter judges structured candidates. Replies and answers are
 * plain prose, so they get the same pattern lists applied directly. Like the
 * synthesis filter: no options argument, no skip flag, no environment check.
 */

import {
  CAUSAL_CONNECTIVES, DIVINE_INTENT, IDENTITY_PREDICATES, LABEL_VOCABULARY,
} from '../config/patterns.js';
import { isNonPosition } from './filter.js';

/** Declarations of what God is saying to this person. Extra to DIVINE_INTENT. */
const GOD_SPEAKS: RegExp[] = [
  /\bgod (?:is )?(?:telling|saying|speaking to|told) you\b/i,
  /\bgod (?:is )?(?:leading|calling) you (?:to|toward|towards)\b/i,
  /\bthis is (?:a )?sign from god\b/i,
  /\bgod will (?:provide|open|make) (?:you|a way for you)\b/i,
];

export interface ProseVerdict {
  pass: boolean;
  violations: string[];
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function filterProse(
  body: string,
  opts: { userSuppliedLabels?: string[]; maxChars?: number } = {},
): ProseVerdict {
  const v: string[] = [];
  const max = opts.maxChars ?? 900;
  if (!body.trim()) v.push('EMPTY');
  if (body.length > max) v.push('LENGTH');
  if (body.trim().startsWith('{')) v.push('NOT-PROSE');

  if (IDENTITY_PREDICATES.some((re) => re.test(body))) v.push('C-09');

  for (const sentence of body.split(/(?<=[.!?])\s+/)) {
    if (sentence.trim().endsWith('?')) continue;
    if (CAUSAL_CONNECTIVES.some((re) => re.test(sentence))) { v.push('C-12'); break; }
  }

  const said = (opts.userSuppliedLabels ?? []).map((l) => l.toLowerCase());
  const lower = body.toLowerCase();
  for (const label of LABEL_VOCABULARY) {
    if (new RegExp(`\\b${esc(label)}\\b`, 'i').test(lower) && !said.includes(label)) {
      v.push('C-14');
      break;
    }
  }

  if (DIVINE_INTENT.some((re) => re.test(body)) || GOD_SPEAKS.some((re) => re.test(body))) {
    v.push('C-30');
  }

  if (isNonPosition(body) && !/\btraditions differ|christians (?:disagree|differ)|different traditions\b/i.test(body)) {
    v.push('C-31');
  }

  return { pass: v.length === 0, violations: v };
}
