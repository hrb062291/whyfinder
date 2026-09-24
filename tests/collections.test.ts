/**
 * The three revisions: collection semantics, delete preview, confirm-card cap.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetIds, activeLines, detectContradiction, emptyProfile, exportAll, modelView,
  previewDeleteEntry, previewDeleteLine, reviseLine, userView, write,
} from '../src/profile/store.js';
import {
  MAX_CONFIRM_CARDS_PER_SESSION, newSession, proposeLine,
} from '../src/engine/session.js';

beforeEach(__resetIds);

const C = { confirmed: true };

describe('every field is a collection', () => {
  it.each(['regrets', 'fears', 'recurring_struggles', 'formative_experiences', 'beliefs'])(
    'a second %s does not erase the first', (field) => {
      let p = write(emptyProfile('u'), field, 'the first one', ['e1'], C);
      p = write(p, field, 'the second one', ['e2'], C);
      expect(activeLines(p, field).map((l) => l.value)).toEqual(['the first one', 'the second one']);
    },
  );

  it('energy accumulates rather than overwriting — the §6.4 map needs every point', () => {
    let p = write(emptyProfile('u'), 'energy', 'Drained by long meetings.', ['e1']);
    p = write(p, 'energy', 'Filled up by the workshop.', ['e2']);
    p = write(p, 'energy', 'Flat after admin.', ['e3']);
    expect(activeLines(p, 'energy')).toHaveLength(3);
  });

  it('adding never supersedes', () => {
    let p = write(emptyProfile('u'), 'values', 'first', ['e1']);
    p = write(p, 'values', 'second', ['e2']);
    expect(p.lines.every((l) => l.supersededBy === null)).toBe(true);
  });
});

describe('supersession means the user edited THIS line', () => {
  it('revising chains the old wording behind the new', () => {
    let p = write(emptyProfile('u'), 'fears', 'Being ordinary.', ['e1'], C);
    const id = p.lines[0].id;
    p = reviseLine(p, id, 'Being forgettable.');
    expect(activeLines(p, 'fears').map((l) => l.value)).toEqual(['Being forgettable.']);
    expect(p.lines.find((l) => l.id === id)!.supersededBy).not.toBeNull();
  });

  it('a revision leaves sibling lines untouched', () => {
    let p = write(emptyProfile('u'), 'fears', 'Being ordinary.', ['e1'], C);
    p = write(p, 'fears', 'Running out of time.', ['e2'], C);
    p = reviseLine(p, p.lines[0].id, 'Being forgettable.');
    expect(activeLines(p, 'fears').map((l) => l.value).sort()).toEqual(
      ['Being forgettable.', 'Running out of time.'],
    );
  });

  it('the user still sees the old wording; the model still does not', () => {
    let p = write(emptyProfile('u'), 'fears', 'Being ordinary.', ['e1'], C);
    p = reviseLine(p, p.lines[0].id, 'Being forgettable.');
    expect(JSON.stringify(userView(p))).toMatch(/Being ordinary/);
    expect(JSON.stringify(modelView(p))).not.toMatch(/Being ordinary/);
    expect(modelView(p)[0].revised).toBe(true);
  });
});

describe('C-16 — contradiction is per line, not per field', () => {
  it('returns a question and never leaks the stored wording into it', () => {
    const p = write(emptyProfile('u'), 'beliefs', 'Work should be a calling.', ['e1'], C);
    const c = detectContradiction(p, p.lines[0].id, 'Work is just work now.')!;
    expect(c.mayAsk).toMatch(/has this shifted/i);
    expect(c.mayAsk).not.toMatch(/Work should be a calling/);
  });

  it('two different beliefs are not a contradiction — the caller picks the line', () => {
    let p = write(emptyProfile('u'), 'beliefs', 'Work should be a calling.', ['e1'], C);
    p = write(p, 'beliefs', 'Rest is not laziness.', ['e2'], C);
    // Nothing about the store treats the second as contradicting the first.
    expect(activeLines(p, 'beliefs')).toHaveLength(2);
  });
});

describe('delete preview', () => {
  it('names every line that would go, before anything goes', () => {
    let p = write(emptyProfile('u'), 'values', 'root', ['e1']);
    const rootId = p.lines[0].id;
    p = write(p, 'energy', 'child', ['e2'], { derivedFrom: [rootId] });
    p = write(p, 'energy', 'unrelated', ['e9']);
    const doomed = previewDeleteEntry(p, 'e1');
    expect(doomed.map((l) => l.value).sort()).toEqual(['child', 'root']);
    // Nothing has actually been removed.
    expect(p.lines).toHaveLength(3);
  });

  it('the preview matches what the delete actually does', () => {
    let p = write(emptyProfile('u'), 'values', 'a', ['e1']);
    p = write(p, 'values', 'b', ['e1']);
    p = write(p, 'values', 'c', ['e2']);
    expect(previewDeleteEntry(p, 'e1').map((l) => l.value).sort()).toEqual(['a', 'b']);
  });

  it('previews a single-line delete plus its dependants', () => {
    let p = write(emptyProfile('u'), 'values', 'parent', ['e1']);
    const pid = p.lines[0].id;
    p = write(p, 'energy', 'dependant', ['e2'], { derivedFrom: [pid] });
    expect(previewDeleteLine(p, pid).map((l) => l.value).sort()).toEqual(['dependant', 'parent']);
  });

  it('there is no soft delete — export confirms the line is gone', () => {
    let p = write(emptyProfile('u'), 'values', 'gone', ['e1']);
    const id = p.lines[0].id;
    const after = previewDeleteLine(p, id);
    expect(after).toHaveLength(1);
    const { lines } = exportAll({ ...p, lines: p.lines.filter((l) => l.id !== id) });
    expect(lines.map((l) => l.value)).not.toContain('gone');
  });
});

describe('confirm-card cap', () => {
  it('shows three, then queues', () => {
    let s = newSession('u', 'x');
    for (let i = 0; i < MAX_CONFIRM_CARDS_PER_SESSION; i += 1) {
      const r = proposeLine(s, 'fears', `fear ${i}`, ['e1']);
      s = r.state;
      expect(r.card).toBeDefined();
    }
    const overflow = proposeLine(s, 'fears', 'fear 4', ['e1']);
    expect(overflow.card).toBeUndefined();
    expect(overflow.queued).toBe(true);
    expect(overflow.state.cardQueue).toHaveLength(1);
  });

  it('auto-write fields never consume a card slot', () => {
    let s = newSession('u', 'x');
    for (let i = 0; i < 10; i += 1) {
      const r = proposeLine(s, 'energy', `point ${i}`, ['e1']);
      s = r.state;
      expect(r.autoWritten).toBe(true);
    }
    expect(s.cardsShown).toBe(0);
    expect(s.cardQueue).toHaveLength(0);
  });

  it('queued material is kept, not discarded', () => {
    let s = newSession('u', 'x');
    for (let i = 0; i < 5; i += 1) s = proposeLine(s, 'beliefs', `belief ${i}`, ['e1']).state;
    expect(s.cardQueue.map((q) => q.value)).toEqual(['belief 3', 'belief 4']);
  });
});
