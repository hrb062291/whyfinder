/**
 * Concern tiers, built on top of (never instead of) detectAcuteSignal.
 *
 *   none      carry on.
 *   mild      "stuck", "pointless", "lost". A gentle acknowledgement. Nothing stops.
 *   elevated  heavier language. The crisis line is named in the conversation.
 *             Nothing stops, and nothing is reported anywhere (C-02, C-03, C-04).
 *   acute     handled by takeTurn exactly as before: stop the exercise, hand off.
 *
 * This path never calls a model. Distress gets fixed, reviewable wording.
 * ALL COPY BELOW IS AUTHORED, NOT BORROWED, so it needs clinician review before
 * BETA, like the rest of the C-06 path.
 */

import { detectAcuteSignal } from './acuteSignal.js';

export type ConcernTier = 'none' | 'mild' | 'elevated' | 'acute';

const ELEVATED: RegExp[] = [
  /\bhopeless\b/i,
  /\bworthless\b/i,
  /\bwhat'?s the point\b/i,
  /\bno one (?:cares|would notice|would miss)\b/i,
  /\bnobody (?:cares|would notice|would miss)\b/i,
  /\bhate myself\b/i,
  /\bgiving up\b/i,
  /\bcan'?t stop crying\b/i,
];

const MILD: RegExp[] = [
  /\bpointless\b/i,
  /\bmeaningless\b/i,
  /\bstuck\b/i,
  /\blost\b/i,
  /\bempty\b/i,
  /\bnumb\b/i,
  /\boverwhelmed\b/i,
  /\bexhausted\b/i,
  /\bbehind in life\b/i,
  /\bdon'?t know who i am\b/i,
];

/** Grief in psalm register is lament, not escalation. It caps at mild. */
const LAMENT: RegExp[] = [
  /\bwithout (?:her|him|them)\b/i,
  /\bi miss (?:her|him|them)\b/i,
  /\bgrie(?:f|ving)\b/i,
  /\bmourn/i,
  /\bsince (?:she|he|they) died\b/i,
  /\bthe funeral\b/i,
  /\bhow long,? (?:o )?lord\b/i,
];

export function concernTier(text: string): { tier: ConcernTier; matched?: string } {
  if (detectAcuteSignal(text).fired) return { tier: 'acute' };
  const lament = LAMENT.some((re) => re.test(text));
  for (const re of ELEVATED) {
    const m = text.match(re);
    if (m) return { tier: lament ? 'mild' : 'elevated', matched: m[0] };
  }
  for (const re of MILD) {
    const m = text.match(re);
    if (m) return { tier: 'mild', matched: m[0] };
  }
  return { tier: 'none' };
}

export interface Care {
  tier: 'mild' | 'elevated';
  text: string;
  /** Whether the UI should open the resource sheet. Elevated only. */
  showResources: boolean;
}

export function careFor(tier: ConcernTier): Care | null {
  if (tier === 'mild') {
    return {
      tier,
      showResources: false,
      text:
        'That sounds like a heavy thing to carry, and a lot of people feel this way while they are searching for direction. There is no rush here.',
    };
  }
  if (tier === 'elevated') {
    return {
      tier,
      showResources: true,
      text:
        'That sounds heavy, and I am glad you said it. If it is getting hard to carry, you can call or text 988 any time, and a pastor, counselor or friend could be worth reaching today. We can keep going whenever you like.',
    };
  }
  return null;
}
