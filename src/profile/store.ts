/**
 * §3 — The Why Profile.
 *
 * C-17 write policy, C-16 contradiction handling, C-20 export and delete
 * propagation, C-10 rejection propagation, C-18 mentor isolation.
 *
 * Default is CONFIRM. Auto-write is the exception, named field by field, so a
 * field added later is safe until someone deliberately makes it otherwise.
 */

import type { ProfileLine } from '../types/index.js';

/** C-17 names exactly two. Everything else confirms. */
export const AUTO_WRITE_FIELDS = ['values', 'energy'] as const;

/** §3 — adding an eighth active hypothesis retires one. */
export const MAX_ACTIVE_HYPOTHESES = 7;

/**
 * EVERY field holds a collection.
 *
 * §3's schema carries `supersededBy` and reads as though a field has one
 * current value with history behind it. Look at C-17's own list, though —
 * regrets, fears, recurring struggles, formative experiences, beliefs — every
 * one is plural. A person has several fears; a second one does not replace the
 * first. Field-level supersession silently ate data in five fields before this
 * was noticed.
 *
 * So `supersededBy` means something narrower than §3 implies: the user EDITED
 * THIS LINE. It is a revision of one statement, not a replacement of a field.
 * Adding a line never supersedes anything — only `reviseLine` does.
 */

export function writePolicyFor(field: string): 'auto' | 'confirm_required' {
  return (AUTO_WRITE_FIELDS as readonly string[]).includes(field) ? 'auto' : 'confirm_required';
}

export interface Profile {
  userId: string;
  lines: ProfileLine[];
}

export function emptyProfile(userId: string): Profile {
  return { userId, lines: [] };
}

let counter = 0;
const nextId = () => `pl${++counter}`;
/** Test hook only. */
export function __resetIds() { counter = 0; }

// ------------------------------------------------------------ confirm cards

/**
 * C-17 requires confirmation of "the exact line". The card carries the precise
 * wording that will be stored — not a paraphrase, not a summary of intent.
 */
export interface ConfirmCard {
  cardId: string;
  field: string;
  /** Exactly what gets written if they save. */
  proposedValue: string;
  sourceEntries: string[];
  actions: ['save', 'edit', 'discard'];
}

export function propose(
  field: string,
  value: string,
  sourceEntries: string[],
): ConfirmCard | { autoWritten: true; field: string; value: string; sourceEntries: string[] } {
  if (writePolicyFor(field) === 'auto') {
    return { autoWritten: true, field, value, sourceEntries };
  }
  return {
    cardId: nextId(),
    field,
    proposedValue: value,
    sourceEntries,
    actions: ['save', 'edit', 'discard'],
  };
}

// ------------------------------------------------------------ writes

export function activeLines(p: Profile, field?: string): ProfileLine[] {
  return p.lines.filter(
    (l) => l.status === 'active' && !l.supersededBy && (field === undefined || l.field === field),
  );
}

/**
 * Write a line. Confirm-required fields REFUSE without a confirmation event —
 * this is the code path C-17's database audit inspects.
 */
export function write(
  p: Profile,
  field: string,
  value: string,
  sourceEntries: string[],
  opts: { confirmed?: boolean; derivedFrom?: string[]; now?: Date } = {},
): Profile {
  const policy = writePolicyFor(field);
  if (policy === 'confirm_required' && !opts.confirmed) {
    throw new Error(
      `C-17: "${field}" requires explicit confirmation of the exact line. ` +
        'No code path writes it without a confirmation event.',
    );
  }
  const now = opts.now ?? new Date();
  const line: ProfileLine = {
    id: nextId(),
    userId: p.userId,
    field,
    value,
    writePolicy: policy,
    confirmedAt: policy === 'confirm_required' ? now.toISOString() : null,
    sourceEntries,
    derivedFrom: opts.derivedFrom ?? [],
    status: 'active',
    supersededBy: null,
    createdAt: now.toISOString(),
  };

  // Adding never supersedes. Fields accumulate.
  return { ...p, lines: [...p.lines, line] };
}

/**
 * The user edited one specific line. The old wording is kept and chained —
 * their timeline, visible to them, never quoted by the app.
 */
export function reviseLine(p: Profile, lineId: string, newValue: string, now?: Date): Profile {
  const old = p.lines.find((l) => l.id === lineId);
  if (!old) throw new Error(`No such line: ${lineId}`);
  const at = (now ?? new Date()).toISOString();
  const revision: ProfileLine = {
    ...old,
    id: nextId(),
    value: newValue,
    confirmedAt: old.writePolicy === 'confirm_required' ? at : null,
    supersededBy: null,
    createdAt: at,
  };
  return {
    ...p,
    lines: [
      ...p.lines.map((l) => (l.id === lineId ? { ...l, supersededBy: revision.id } : l)),
      revision,
    ],
  };
}

export function confirmCard(p: Profile, card: ConfirmCard, editedValue?: string, now?: Date): Profile {
  return write(p, card.field, editedValue ?? card.proposedValue, card.sourceEntries, {
    confirmed: true, now,
  });
}

// ------------------------------------------------------------ C-16

export interface Contradiction {
  field: string;
  storedValue: string;
  statedValue: string;
  /** The app MAY ask this. It may never assert the stored value. */
  mayAsk: string;
}

/**
 * C-16: when a present statement conflicts with the stored profile, the app may
 * ask what changed. It must not assert the stored version against the person.
 *
 * The returned prompt deliberately contains no quotation of the old value.
 * "But you said X" is the failure this rule exists to prevent, and the easiest
 * way to never write it is to never hand the phrasing layer the old string.
 */
export function detectContradiction(
  p: Profile,
  lineId: string,
  statedValue: string,
): Contradiction | null {
  const current = p.lines.find((l) => l.id === lineId);
  if (!current || current.status !== 'active' || current.supersededBy) return null;
  if (current.value.trim().toLowerCase() === statedValue.trim().toLowerCase()) return null;
  return {
    field: current.field,
    storedValue: current.value,
    statedValue,
    mayAsk: 'Has this shifted since we last talked about it?',
  };
}

// ------------------------------------------------------------ views

/**
 * What the MODEL sees. Current values only, plus a flag. Never the history —
 * if the old phrasing is not in context, the app cannot quote it back.
 */
export function modelView(p: Profile): {
  lineId: string; field: string; value: string; revised: boolean;
}[] {
  return activeLines(p).map((l) => ({
    lineId: l.id,
    field: l.field,
    value: l.value,
    // A flag, never the old wording. Deciding whether a new statement
    // contradicts THIS line is a semantic judgement made upstream, which is
    // why detectContradiction takes a lineId rather than guessing from a field.
    revised: p.lines.some((x) => x.supersededBy === l.id),
  }));
}

/**
 * What the USER sees. Their own timeline, in their own words. P-12: the map is
 * theirs to read. P-06: no stage names, no confidence scores, no derivation.
 */
export function userView(p: Profile): {
  field: string;
  current: string[];
  history: { value: string; at: string }[];
}[] {
  const fields = [...new Set(p.lines.map((l) => l.field))];
  return fields.map((field) => {
    const all = p.lines.filter((l) => l.field === field).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt));
    const current = all.filter((l) => !l.supersededBy && l.status === 'active');
    const ids = new Set(current.map((l) => l.id));
    return {
      field,
      current: current.map((l) => l.value),
      history: all.filter((l) => !ids.has(l.id)).map((l) => ({ value: l.value, at: l.createdAt })),
    };
  });
}

/** C-18 — no Why Profile field is exposed to any mentor or moderator surface. */
export function mentorView(_p: Profile): Record<string, never> {
  return {};
}

// ------------------------------------------------------------ hypotheses

export function activeHypotheses(p: Profile): ProfileLine[] {
  return p.lines.filter((l) => l.field === 'hypothesis' && l.status === 'active' && !l.supersededBy);
}

/**
 * Adding an eighth retires the oldest. Retired lines stay stored, exportable
 * and undeleted — they simply stop driving the conversation and stop entering
 * context. Ranking at the profile level, the way the 3-per-session cap forces
 * it at the conversation level.
 */
export function addHypothesis(
  p: Profile, value: string, sourceEntries: string[], now?: Date,
): Profile {
  let next = write(p, 'hypothesis', value, sourceEntries, { confirmed: true, now });
  const active = activeHypotheses(next);
  if (active.length > MAX_ACTIVE_HYPOTHESES) {
    const oldest = [...active].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    next = {
      ...next,
      lines: next.lines.map((l) => (l.id === oldest.id ? { ...l, status: 'retired' } : l)),
    };
  }
  return next;
}

// ------------------------------------------------------------ C-20 / C-10

/**
 * Delete an entry. Every line derived from it goes, transitively.
 * C-20: deletion propagates to inferences derived from it.
 */
export function deleteEntry(p: Profile, entryId: string): Profile {
  const doomed = new Set<string>();
  for (const l of p.lines) if (l.sourceEntries.includes(entryId)) doomed.add(l.id);
  return { ...p, lines: cascade(p.lines, doomed) };
}

/** C-10: rejecting a synthesis removes it and every inference derived from it. */
export function rejectSynthesis(p: Profile, synthesisId: string): Profile {
  const doomed = new Set<string>();
  for (const l of p.lines) if (l.derivedFrom.includes(synthesisId)) doomed.add(l.id);
  return { ...p, lines: cascade(p.lines, doomed) };
}

/** Delete a single line the user picked, plus whatever hangs off it. */
export function deleteLine(p: Profile, lineId: string): Profile {
  return { ...p, lines: cascade(p.lines, new Set([lineId])) };
}

function cascade(lines: ProfileLine[], doomed: Set<string>): ProfileLine[] {
  let changed = true;
  while (changed) {
    changed = false;
    for (const l of lines) {
      if (doomed.has(l.id)) continue;
      if (l.derivedFrom.some((d) => doomed.has(d))) { doomed.add(l.id); changed = true; }
    }
  }
  const kept = lines.filter((l) => !doomed.has(l.id));
  // A superseded pointer into a deleted line must not dangle.
  return kept.map((l) => (l.supersededBy && doomed.has(l.supersededBy)
    ? { ...l, supersededBy: null }
    : l));
}

/**
 * What a delete would take with it.
 *
 * C-20 REQUIRES the cascade — the rule is not negotiable. What the rule does
 * not do is warn anyone, and a user removing one early entry can transitively
 * wipe most of their profile. The UI shows this list and requires an explicit
 * confirm of the whole set.
 *
 * There is no undo. Deleted means gone, which is what the privacy posture
 * promises; a 30-second soft delete would be a hard delete's label on data
 * that still exists.
 */
export function previewDeleteEntry(p: Profile, entryId: string): ProfileLine[] {
  const before = new Set(p.lines.map((l) => l.id));
  const after = new Set(deleteEntry(p, entryId).lines.map((l) => l.id));
  return p.lines.filter((l) => before.has(l.id) && !after.has(l.id));
}

export function previewDeleteLine(p: Profile, lineId: string): ProfileLine[] {
  const after = new Set(deleteLine(p, lineId).lines.map((l) => l.id));
  return p.lines.filter((l) => !after.has(l.id));
}

/** C-20 — export everything. Retired lines and history included. */
export function exportAll(p: Profile): { userId: string; exportedAt: string; lines: ProfileLine[] } {
  return { userId: p.userId, exportedAt: new Date().toISOString(), lines: p.lines };
}
