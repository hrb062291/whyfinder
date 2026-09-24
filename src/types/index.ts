/**
 * Core contracts. Frozen before any parallel work (hardened prompt § CONTRACTS).
 *
 * Every constraint is enforced OUTSIDE ModelProvider, on the far side of the
 * vendor boundary, so swapping Gloo for Claude cannot weaken a rule.
 */

export type ReviewState = 'DEMO' | 'BETA' | 'PUBLIC';

/** §9.1 — the four statement kinds (C-29). */
export type StatementKind =
  | 'biblical_teaching'
  | 'christian_interpretation'
  | 'psychological_research'
  | 'ai_inference';

export const STATEMENT_KINDS: StatementKind[] = [
  'biblical_teaching',
  'christian_interpretation',
  'psychological_research',
  'ai_inference',
];

/** §5 — question tiers. */
export type Tier = 'light' | 'medium' | 'heavy';

export interface Entry {
  id: string;
  userId: string;
  sessionId: string;
  createdAt: string;
  text: string;
  source: 'answer' | 'volunteered';
  /** Question the entry answers, when it answers one. */
  questionId?: string;
}

export interface Synthesis {
  id: string;
  userId: string;
  sessionId: string;
  body: string;
  /** C-07: two or more distinct user-supplied entries. */
  evidence: string[];
  /** C-11: at least one concrete noun the user supplied. */
  concreteNouns: string[];
  /** C-29: exactly one kind. Mixing is forbidden — split into units instead. */
  kind: StatementKind;
  status: 'offered' | 'accepted' | 'rejected' | 'edited';
  derivedFrom: string[];
  /** C-10: the affordance must be present on every displayed synthesis. */
  affordances: { accept: boolean; reject: boolean; edit: boolean };
}

/** A single constraint failure, with enough detail to render in /filter-demo. */
export interface Violation {
  constraint: string;
  rule: string;
  /** The exact substring that tripped it, when there is one. */
  match?: string;
}

export interface FilterVerdict {
  pass: boolean;
  violations: Violation[];
  /** Body is withheld on failure. Never partially emitted. */
  suppressedBody?: string;
  loggedAt: string;
}

export interface ProfileLine {
  id: string;
  userId: string;
  field: string;
  value: string;
  writePolicy: 'auto' | 'confirm_required';
  /** Null only when writePolicy === 'auto' (C-17). */
  confirmedAt: string | null;
  sourceEntries: string[];
  derivedFrom: string[];
  status: 'active' | 'retired';
  supersededBy: string | null;
  createdAt: string;
}

export interface CanonEntry {
  id: string;
  title: string;
  authorOrSource: string;
  category: 'book' | 'practice' | 'listen_read' | 'referral';
  themes: string[];
  cost: 'free' | 'low' | 'moderate' | 'high';
  time: 'minutes' | 'hours' | 'ongoing';
  format: 'read' | 'listen' | 'do' | 'contact';
  tradition: string;
  approvedBy: string;
  approvedAt: string;
  lastChecked: string;
}

/** The only place a vendor is named. */
export interface ModelProvider {
  name: 'gloo' | 'anthropic' | 'fixture';
  complete(messages: { role: string; content: string }[], system: string): Promise<string>;
}

/** What the filter needs to judge a candidate. Never the model's own claims. */
export interface FilterContext {
  /** Verbatim user text, keyed by entry id. Ground truth for C-07 and C-11. */
  entriesById: Record<string, string>;
  /** Labels the user has used about themselves, in their own words (C-14). */
  userSuppliedLabels: string[];
  /** Names of third parties the user mentioned (C-13). */
  thirdPartyNames: string[];
  reviewState: ReviewState;
}
