import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_ACTIVE_HYPOTHESES, __resetIds, activeHypotheses, addHypothesis, confirmCard,
  deleteEntry, deleteLine, detectContradiction, emptyProfile, exportAll, mentorView,
  modelView, propose, rejectSynthesis, reviseLine, userView, write, writePolicyFor,
} from '../src/profile/store.js';
import type { ConfirmCard } from '../src/profile/store.js';

beforeEach(__resetIds);

describe('C-17 — write policy', () => {
  it('values and energy auto-write', () => {
    expect(writePolicyFor('values')).toBe('auto');
    expect(writePolicyFor('energy')).toBe('auto');
  });

  it.each(['regrets', 'fears', 'recurring_struggles', 'formative_experiences', 'beliefs', 'constraints'])(
    '%s requires confirmation', (f) => expect(writePolicyFor(f)).toBe('confirm_required'),
  );

  it('a field nobody thought about defaults to confirm', () => {
    expect(writePolicyFor('some_field_added_on_day_12')).toBe('confirm_required');
  });

  it('REFUSES to write a confirm-required field without a confirmation event', () => {
    const p = emptyProfile('u');
    expect(() => write(p, 'fears', 'Being ordinary.', ['e1'])).toThrow(/C-17/);
  });

  it('writes it once confirmed', () => {
    const p = write(emptyProfile('u'), 'fears', 'Being ordinary.', ['e1'], { confirmed: true });
    expect(p.lines[0].confirmedAt).not.toBeNull();
  });

  it('auto fields need no confirmation and record none', () => {
    const p = write(emptyProfile('u'), 'energy', 'Drained by long meetings.', ['e1']);
    expect(p.lines[0].confirmedAt).toBeNull();
  });
});

describe('confirm cards', () => {
  it('carries the exact wording that will be stored, plus save/edit/discard', () => {
    const c = propose('regrets', 'Not going back for the second year.', ['e4']) as ConfirmCard;
    expect(c.proposedValue).toBe('Not going back for the second year.');
    expect(c.actions).toEqual(['save', 'edit', 'discard']);
  });

  it('auto fields bypass the card entirely', () => {
    const r = propose('values', 'Making things with other people.', ['e1']);
    expect('autoWritten' in r && r.autoWritten).toBe(true);
  });

  it('editing stores the edited wording, not the proposal', () => {
    const c = propose('beliefs', 'You believe work should mean something.', ['e2']) as ConfirmCard;
    const p = confirmCard(emptyProfile('u'), c, 'I want work to mean something.');
    expect(p.lines[0].value).toBe('I want work to mean something.');
  });
});

describe('C-16 — contradiction', () => {
  it('detects a conflict and offers a question, never an assertion', () => {
    const p = write(emptyProfile('u'), 'values', 'Independence above all.', ['e1']);
    const c = detectContradiction(p, p.lines[0].id, 'Actually I want to be part of something.')!;
    expect(c.mayAsk).toMatch(/has this shifted/i);
    expect(c.mayAsk).not.toMatch(/but you said|you previously|you told me/i);
  });

  it('the model view carries no history, so the old phrasing cannot be quoted', () => {
    let p = write(emptyProfile('u'), 'values', 'Independence above all.', ['e1']);
    p = reviseLine(p, p.lines[0].id, 'Being part of something.');
    const view = modelView(p);
    expect(JSON.stringify(view)).not.toMatch(/Independence above all/);
    expect(view.find((v) => v.field === 'values')!.value).toBe('Being part of something.');
  });

  it('the user view DOES carry their own timeline', () => {
    let p = write(emptyProfile('u'), 'values', 'Independence above all.', ['e1']);
    p = reviseLine(p, p.lines[0].id, 'Being part of something.');
    const v = userView(p).find((x) => x.field === 'values')!;
    expect(v.current).toEqual(['Being part of something.']);
    expect(v.history.map((h) => h.value)).toContain('Independence above all.');
  });
});

describe('C-18 — mentor isolation', () => {
  it('exposes no field at all', () => {
    const p = write(emptyProfile('u'), 'values', 'Anything.', ['e1']);
    expect(mentorView(p)).toEqual({});
    expect(Object.keys(mentorView(p))).toHaveLength(0);
  });
});

describe('§3 — the 7-hypothesis cap', () => {
  it('retires the oldest when an eighth arrives', () => {
    let p = emptyProfile('u');
    for (let i = 1; i <= MAX_ACTIVE_HYPOTHESES; i += 1) {
      p = addHypothesis(p, `hypothesis ${i}`, ['e1'], new Date(2026, 0, i));
    }
    expect(activeHypotheses(p)).toHaveLength(7);
    p = addHypothesis(p, 'hypothesis 8', ['e1'], new Date(2026, 0, 20));
    expect(activeHypotheses(p)).toHaveLength(7);
    expect(activeHypotheses(p).map((h) => h.value)).not.toContain('hypothesis 1');
  });

  it('a retired hypothesis is still stored and still exportable', () => {
    let p = emptyProfile('u');
    for (let i = 1; i <= 8; i += 1) {
      p = addHypothesis(p, `hypothesis ${i}`, ['e1'], new Date(2026, 0, i));
    }
    const exported = exportAll(p);
    expect(exported.lines.map((l) => l.value)).toContain('hypothesis 1');
    expect(exported.lines.find((l) => l.value === 'hypothesis 1')!.status).toBe('retired');
  });
});

describe('C-20 / C-10 — deletion propagates', () => {
  it('deleting an entry removes lines derived from it', () => {
    let p = write(emptyProfile('u'), 'values', 'From entry one.', ['e1']);
    p = write(p, 'energy', 'From entry two.', ['e2']);
    p = deleteEntry(p, 'e1');
    expect(p.lines.map((l) => l.value)).toEqual(['From entry two.']);
  });

  it('cascades transitively', () => {
    let p = write(emptyProfile('u'), 'values', 'root', ['e1']);
    const rootId = p.lines[0].id;
    p = write(p, 'energy', 'child', ['e2'], { derivedFrom: [rootId] });
    const childId = p.lines[1].id;
    p = write(p, 'energy', 'grandchild', ['e3'], { derivedFrom: [childId] });
    p = deleteEntry(p, 'e1');
    expect(p.lines).toHaveLength(0);
  });

  it('rejecting a synthesis removes everything derived from it (C-10)', () => {
    let p = write(emptyProfile('u'), 'values', 'kept', ['e1']);
    p = write(p, 'energy', 'from syn1', ['e2'], { derivedFrom: ['syn1'] });
    p = rejectSynthesis(p, 'syn1');
    expect(p.lines.map((l) => l.value)).toEqual(['kept']);
  });

  it('never leaves a dangling supersededBy pointer', () => {
    let p = write(emptyProfile('u'), 'values', 'old', ['e1']);
    p = write(p, 'values', 'new', ['e2']);
    const newest = p.lines[1].id;
    p = deleteLine(p, newest);
    const old = p.lines.find((l) => l.value === 'old')!;
    expect(old.supersededBy).toBeNull();
  });
});

describe('C-20 — export completeness', () => {
  it('returns everything, including history and retired lines', () => {
    let p = write(emptyProfile('u'), 'values', 'first', ['e1']);
    p = write(p, 'values', 'second', ['e2']);
    const e = exportAll(p);
    expect(e.lines).toHaveLength(2);
    expect(e.lines.map((l) => l.value)).toEqual(['first', 'second']);
    expect(e.userId).toBe('u');
  });
});
