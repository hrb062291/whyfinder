'use client';

/**
 * The first screen.
 *
 * Every constraint that matters runs on the server (/api/turn). This component
 * renders what survives the filter and nothing else. There is no client-side
 * path that displays a suppressed body.
 *
 * Added: a short reply under what you said, a gentle care line, faith answers
 * labelled by kind, and one small experiment card with a two-tap reflect step.
 * No streaks, counts or badges anywhere (C-27).
 */

import { useEffect, useRef, useState } from 'react';
import type { Synthesis } from '../src/types/index.js';
import './journal.css';

type Answer = {
  body: string; kind: string; scripture: string[]; questionsToConsider: string[]; counsel: string[];
  passages?: { reference: string; text: string; version: string; versionTitle: string; copyright: string; link?: string }[];
};
type Experiment = { id: string; title: string };
type Support = {
  title: string; lead: string; items: { name: string; detail: string }[];
  note: string; showResources: boolean;
};

type Turn =
  | { kind: 'disclosure' }
  | { kind: 'app'; text: string }
  | { kind: 'care'; text: string }
  | { kind: 'notice'; text: string }
  | { kind: 'welcome'; text: string }
  | { kind: 'you'; text: string }
  | { kind: 'synthesis'; synthesis: Synthesis; quotes: string[] }
  | { kind: 'answer'; answer: Answer }
  | { kind: 'support'; support: Support }
  | { kind: 'experiment'; experiment: Experiment };

const RESOURCES = [
  ['988 Suicide & Crisis Lifeline', 'Call or text 988',
   'Free, confidential support, 24 hours a day, 7 days a week.'],
  ['Crisis Text Line', 'Text HOME to 741741',
   'Free, 24/7 support from a trained crisis counselor.'],
  ['SAMHSA National Helpline', '1-800-662-4357',
   'Free, confidential, 24/7 treatment referral and information service.'],
];

const OPEN_GATES = [
  ['Crisis response wording',
   'Borrowed verbatim from 988 and Crisis Text Line. A clinician has not reviewed our own version.'],
  ['Gentle check-in wording',
   'The short lines shown for lower-level distress are ours, and a clinician has not reviewed them.'],
  ['Support card wording',
   'The card that points to counselors, pastors and people nearby is ours, and a clinician and pastoral reviewer have not signed off on it.'],
  ['The harder questions',
   'Questions about pain, regret, fear and loss are switched off until a pastoral reviewer has signed off on them.'],
  ['How we label scripture',
   'The scheme that separates what the Bible says from how a tradition reads it has not been reviewed.'],
];

const KIND_LABEL: Record<string, string> = {
  biblical_teaching: 'What the Bible says',
  christian_interpretation: 'How many Christians read it',
  psychological_research: 'What research suggests',
  ai_inference: 'A guess, not a finding',
};

// ------------------------------------------------------------------ memory on this device

const SAVE_KEY = 'whyfinder.conversation.v1';
const SAVE_DAYS = 30;

type Saved = { state: Record<string, unknown>; turns: Turn[]; at: number };

function loadSaved(): Saved | null {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Saved;
    const said = (v.state?.entries as unknown[] | undefined)?.length ?? 0;
    if (!v.state || !Array.isArray(v.turns) || said === 0 || Date.now() - v.at > SAVE_DAYS * 86_400_000) {
      window.localStorage.removeItem(SAVE_KEY);
      return null;
    }
    // A pause from last time should not still be on. Start with the questions available.
    const support = v.state.support as { active?: boolean } | undefined;
    if (support) v.state = { ...v.state, support: { ...support, active: false } };
    v.turns = v.turns.filter((t) => t.kind !== 'welcome');
    return v;
  } catch {
    return null;
  }
}

function save(state: Record<string, unknown>, turns: Turn[]) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({ state, turns: turns.filter((t) => t.kind !== 'welcome'), at: Date.now() }));
  } catch {
    /* Private window or full storage. The conversation still works. */
  }
}

function clearSaved() {
  try { window.localStorage.removeItem(SAVE_KEY); } catch { /* nothing to clear */ }
}

/** Their own words from last time, never a summary the app wrote about them. */
function welcomeBack(state: Record<string, unknown>): string {
  const entries = (state.entries as { text: string }[] | undefined) ?? [];
  // Quote only something that reads like a sentence a person said: not pasted
  // code or terminal output, and not a wall of text.
  const readable = (t: string) =>
    t.trim().split(/\s+/).length >= 4 && t.length <= 160 && !/[\\<>{}]|\bPS \b|https?:/.test(t);
  const last = [...entries].reverse().find((e) => readable(e.text));
  if (!last) return 'Welcome back. We can pick up where we left off, or you can start somewhere new.';
  const t = last.text.trim();
  const snippet = t.length > 90 ? `${t.slice(0, 90).replace(/\s+\S*$/, '')}\u2026` : t;
  return `Welcome back. Last time you said, \u201c${snippet}\u201d. We can pick up from there, or you can start somewhere new.`;
}

// ------------------------------------------------------------------ the journal (this device only)

const JOURNAL_KEY = 'whyfinder.journal.v1';

/** A guess the person chose to keep, in the exact words they approved. */
type JournalItem = {
  id: string; body: string; original?: string; quotes: string[];
  status: 'kept' | 'edited'; at: number;
};
/** A question from an answer card that the person saved to take to someone. */
type SavedQuestion = { text: string; at: number };
type Journal = { items: JournalItem[]; dropped: string[]; questions: SavedQuestion[] };
const EMPTY_JOURNAL: Journal = { items: [], dropped: [], questions: [] };

function loadJournal(): Journal {
  try {
    const raw = window.localStorage.getItem(JOURNAL_KEY);
    if (!raw) return EMPTY_JOURNAL;
    const v = JSON.parse(raw) as Journal;
    return {
      items: Array.isArray(v.items) ? v.items : [],
      dropped: Array.isArray(v.dropped) ? v.dropped : [],
      questions: Array.isArray(v.questions) ? v.questions : [],
    };
  } catch {
    return EMPTY_JOURNAL;
  }
}

function saveJournal(j: Journal) {
  try { window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(j)); } catch { /* storage unavailable */ }
}

function clearJournal() {
  try { window.localStorage.removeItem(JOURNAL_KEY); } catch { /* nothing to clear */ }
}

type SavedEntry = { id: string; text: string; createdAt?: string };

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([{ kind: 'disclosure' }]);
  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | 'crisis' | 'gates'>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const [restored, setRestored] = useState(false);
  const [journal, setJournal] = useState<Journal>(EMPTY_JOURNAL);
  const [panel, setPanel] = useState(false);
  const journalReady = useRef(false);

  useEffect(() => {
    // Strict Mode runs effects twice in dev; begin once.
    if (started.current) return;
    started.current = true;
    setJournal(loadJournal());
    journalReady.current = true;
    // The top bar stays put while the page scrolls. It needs the page's own
    // background colour so the conversation does not show through it, and the
    // journal panel sits just under it.
    const root = document.documentElement;
    const bg = [document.body, root].map((el) => getComputedStyle(el).backgroundColor)
      .find((c) => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent');
    if (bg) root.style.setProperty('--wf-bg', bg);
    const bar = document.querySelector('.topbar') as HTMLElement | null;
    let ro: ResizeObserver | null = null;
    if (bar) {
      const measure = () => root.style.setProperty('--wf-topbar-h', `${bar.offsetHeight}px`);
      measure();
      if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(bar); }
    }
    // Wide screens have room for the journal beside the conversation.
    if (window.matchMedia('(min-width: 1280px)').matches) setPanel(true);
    const saved = loadSaved();
    if (saved) {
      setState(saved.state);
      setTurns([...saved.turns, { kind: 'welcome', text: welcomeBack(saved.state) }]);
      setRestored(true);
      return;
    }
    fetch('/api/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'begin' }),
    })
      .then((r) => r.json())
      .then((r) => {
        setState(r.state);
        setTurns((t) => [...t, { kind: 'app', text: r.output.then ?? r.output.text }]);
      })
      .catch(() => {
        setTurns((t) => [...t, { kind: 'app', text: "Tell me what's been on your mind lately." }]);
      });
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  // Remember the conversation on this device only. Nothing goes to a server.
  useEffect(() => {
    if (state) save(state, turns);
  }, [state, turns]);

  useEffect(() => {
    if (journalReady.current) saveJournal(journal);
  }, [journal]);

  function startOver() {
    clearSaved();
    clearJournal();
    setJournal(EMPTY_JOURNAL);
    setRestored(false);
    setState(null);
    setTurns([{ kind: 'disclosure' }]);
    started.current = false;
    fetch('/api/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'begin' }),
    })
      .then((r) => r.json())
      .then((r) => {
        setState(r.state);
        setTurns((t) => [...t, { kind: 'app', text: r.output.then ?? r.output.text }]);
      })
      .catch(() => setTurns((t) => [...t, { kind: 'app', text: "Tell me what's been on your mind lately." }]));
  }

  /** Experiment taps update server-shaped state only; no model call. */
  async function post(payload: Record<string, unknown>) {
    try {
      const res = await fetch('/api/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, state }),
      });
      const r = await res.json();
      if (r.state) setState(r.state);
    } catch {
      /* The card still resolves locally; nothing is lost but the note. */
    }
  }

  /** "Back to the questions" after the support pause. Server picks the next one. */
  async function resume() {
    try {
      const res = await fetch('/api/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'resume', state }),
      });
      const r = await res.json();
      if (r.state) setState(r.state);
      if (r.output?.text) setTurns((t) => [...t, { kind: 'app', text: r.output.text }]);
    } catch {
      setTurns((t) => [...t, { kind: 'app', text: 'Something went wrong on my end. Try that again?' }]);
    }
  }

  function keepGuess(id: string, body: string, quotes: string[], edited = false, original?: string) {
    setJournal((j) => ({
      ...j,
      dropped: j.dropped.filter((d) => d !== id),
      items: [...j.items.filter((x) => x.id !== id),
        { id, body, quotes, status: edited ? 'edited' : 'kept', at: Date.now(), ...(edited ? { original } : {}) }],
    }));
  }
  function dropGuess(id: string) {
    setJournal((j) => ({ ...j, items: j.items.filter((x) => x.id !== id), dropped: [...j.dropped.filter((d) => d !== id), id] }));
  }
  function toggleQuestion(text: string) {
    setJournal((j) => ({
      ...j,
      questions: j.questions.some((q) => q.text === text)
        ? j.questions.filter((q) => q.text !== text)
        : [...j.questions, { text, at: Date.now() }],
    }));
  }
  function editKept(id: string, body: string) {
    setJournal((j) => ({
      ...j,
      items: j.items.map((x) => (x.id === id ? { ...x, body, status: 'edited', original: x.original ?? x.body } : x)),
    }));
  }

  async function submit() {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    setValue('');
    if (ta.current) ta.current.style.height = 'auto';
    setTurns((t) => [...t, { kind: 'you', text }]);

    try {
      const res = await fetch('/api/turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'turn', state, text }),
      });
      const r = await res.json();
      setState(r.state);
      const o = r.output;

      if (o.kind === 'acute') {
        setTurns((t) => [
          ...t,
          { kind: 'app', text: o.response.namesConcern },
          { kind: 'app', text: o.response.offersHuman },
        ]);
        setSheet('crisis');
      } else {
        const next: Turn[] = [];
        if (r.degraded) {
          next.push({
            kind: 'notice',
            text: 'I could not reach the language model just now, so I am not offering a reply or a guess this turn. What you wrote is still here.',
          });
        }
        if (o.care) next.push({ kind: 'care', text: o.care.text });
        if (o.reply) next.push({ kind: 'app', text: o.reply });
        if (o.answer) next.push({ kind: 'answer', answer: o.answer });
        if (o.support) next.push({ kind: 'support', support: o.support });
        if (o.synthesis) {
          const quotes: string[] = (o.synthesis.evidence as string[])
            .map((id: string) => (r.state.entries as { id: string; text: string }[])
              .find((e) => e.id === id)?.text)
            .filter(Boolean) as string[];
          next.push({ kind: 'synthesis', synthesis: o.synthesis, quotes });
        }
        if (o.text) next.push({ kind: 'app', text: o.text });
        if (o.experiment) next.push({ kind: 'experiment', experiment: o.experiment });
        setTurns((t) => [...t, ...next]);
        if (o.care?.showResources || o.support?.showResources) setSheet('crisis');
      }
    } catch {
      setTurns((t) => [...t, { kind: 'app', text: 'Something went wrong on my end. Try that again?' }]);
    }
    setBusy(false);
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="wordmark">
            Why<span>Finder</span>
          </div>
          {(restored || turns.length > 2) && (
            <button className="crisis-link" onClick={startOver}>Clear this device</button>
          )}
          <button className="crisis-link j-top" onClick={() => setPanel((o) => !o)} aria-expanded={panel}>
            Journal{journal.items.length + journal.questions.length > 0 ? ` (${journal.items.length + journal.questions.length})` : ''}
          </button>
          <button className="crisis-link" onClick={() => setSheet('crisis')}>
            Need to talk to someone now
          </button>
        </div>
      </header>

      <main>
        <div className="column">
          {turns.map((t, i) => (
            <div className="turn" key={i}>
              {t.kind === 'disclosure' && <Disclosure onGates={() => setSheet('gates')} />}
              {t.kind === 'app' && <p className="app-text">{t.text}</p>}
              {t.kind === 'care' && <p className="app-text">{t.text}</p>}
              {t.kind === 'welcome' && <p className="app-text">{t.text}</p>}
              {t.kind === 'notice' && <p className="reflect-note">{t.text}</p>}
              {t.kind === 'you' && <p className="you">{t.text}</p>}
              {t.kind === 'synthesis' && (
                <SynthesisCard
                  body={t.synthesis.body}
                  quotes={t.quotes}
                  status={journal.items.find((x) => x.id === t.synthesis.id)?.status
                    ?? (journal.dropped.includes(t.synthesis.id) ? 'dropped' : null)}
                  onKeep={() => keepGuess(t.synthesis.id, t.synthesis.body, t.quotes)}
                  onEdit={(words) => keepGuess(t.synthesis.id, words, t.quotes, true, t.synthesis.body)}
                  onDrop={() => dropGuess(t.synthesis.id)}
                  onOpen={() => setPanel(true)}
                />
              )}
              {t.kind === 'answer' && (
                <AnswerCard a={t.answer} saved={journal.questions.map((q) => q.text)} onSave={toggleQuestion} />
              )}
              {t.kind === 'support' && (
                <SupportCardView s={t.support} onResume={() => void resume()}
                                 onResources={() => setSheet('crisis')} />
              )}
              {t.kind === 'experiment' && (
                <ExperimentCard
                  x={t.experiment}
                  onChoose={(choice) => void post({ action: 'experiment', experimentId: t.experiment.id, choice })}
                  onReflect={(feel, note) =>
                    void post({ action: 'reflect', experimentId: t.experiment.id, feel, note })}
                />
              )}
            </div>
          ))}
          <div ref={bottom} />
        </div>
      </main>

      <div className="composer-wrap">
        <div className="composer">
          <div className="composer-box">
            <textarea
              id="composer-input"
              ref={ta}
              rows={1}
              value={value}
              placeholder="Take your time."
              aria-label="Your message"
              onChange={(e) => {
                setValue(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <button className="send" onClick={() => void submit()} disabled={!value.trim() || busy} aria-label="Send">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5" stroke="currentColor"
                      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div className="composer-note">
            Nothing is saved to your profile without you confirming the exact words.
          </div>
        </div>
      </div>

      {panel && (
        <JournalPanel
          journal={journal}
          entries={((state?.entries as SavedEntry[] | undefined) ?? [])}
          verses={turns.flatMap((t) => (t.kind === 'answer' ? (t.answer.passages ?? []) : []))}
          onClose={() => setPanel(false)}
          onEdit={editKept}
          onRemove={dropGuess}
          onRemoveQuestion={toggleQuestion}
          onClear={startOver}
        />
      )}

      {sheet && (
        <Sheet onClose={() => setSheet(null)}
               title={sheet === 'crisis' ? 'People who can help right now' : "What's still open"}
               lead={sheet === 'crisis'
                 ? 'These are free and available around the clock. Nothing here is monitored by us.'
                 : "This build is honest about what hasn't been reviewed yet."}>
          {sheet === 'crisis'
            ? RESOURCES.map(([n, c, d]) => (
                <div className="resource" key={n}>
                  <div className="resource-name">{n}</div>
                  <div className="resource-contact">{c}</div>
                  <div className="resource-detail">{d}</div>
                </div>
              ))
            : OPEN_GATES.map(([n, d]) => (
                <div className="resource" key={n}>
                  <div className="resource-name">{n}</div>
                  <div className="resource-detail">{d}</div>
                </div>
              ))}
        </Sheet>
      )}
    </>
  );
}

function Disclosure({ onGates }: { onGates: () => void }) {
  return (
    <div className="disclosure">
      <p>
        <strong>Before we start, two things.</strong> I&rsquo;m not a therapist, pastor or licensed
        counselor &mdash; I&rsquo;m a tool for thinking out loud. And training on anything you write
        here is off unless you turn it on yourself in settings.
      </p>
      <p>
        This conversation is kept on this device only, so you can come back to it. &ldquo;Clear this
        device&rdquo; at the top erases it.
      </p>
      <div className="proto">
        <div className="proto-dot" />
        <p>
          This is an unreviewed prototype. A clinician and a pastoral reviewer haven&rsquo;t signed
          off yet.{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); onGates(); }}>
            See what&rsquo;s still open
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function SynthesisCard({ body, quotes, status, onKeep, onEdit, onDrop, onOpen }: {
  body: string; quotes: string[];
  status: 'kept' | 'edited' | 'dropped' | null;
  onKeep: () => void; onEdit: (words: string) => void; onDrop: () => void; onOpen: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  return (
    <div className="synthesis">
      <div className="syn-kind">A guess, not a finding</div>
      <div className="syn-body">{body}</div>
      {quotes.length > 0 && (
        <div className="syn-evidence">
          <div className="syn-evidence-label">Because you said</div>
          {quotes.map((q, i) => (
            <p className="quote" key={i}>{q}</p>
          ))}
        </div>
      )}
      {status === 'kept' && (
        <div className="syn-resolved">
          Kept in your journal. <button className="j-link" onClick={onOpen}>Open journal</button>
        </div>
      )}
      {status === 'edited' && (
        <div className="syn-resolved">
          Saved in your own words. <button className="j-link" onClick={onOpen}>Open journal</button>
        </div>
      )}
      {status === 'dropped' && <div className="syn-resolved">Dropped. It is not in your journal.</div>}
      {status === null && editing && (
        <div className="j-edit">
          <label className="j-edit-label" htmlFor="syn-edit">Say it in your own words. What gets saved is exactly what you write.</label>
          <textarea id="syn-edit" className="j-edit-box" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="syn-actions">
            <button className="btn btn-accept" disabled={!draft.trim()}
                    onClick={() => { onEdit(draft.trim()); setEditing(false); }}>Save</button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
      {status === null && !editing && (
        <div className="syn-actions">
          <button className="btn btn-accept" onClick={onKeep}>Keep this</button>
          <button className="btn" onClick={() => { setDraft(body); setEditing(true); }}>Edit</button>
          <button className="btn btn-ghost" onClick={onDrop}>That&rsquo;s not it</button>
        </div>
      )}
    </div>
  );
}

type Verse = { reference: string; versionTitle: string; version: string; link?: string };

/** The journal as plain text. Built here, on this device, only when the person asks. */
function journalText(journal: Journal, entries: SavedEntry[], verses: Verse[]): string {
  const when = (t?: string | number) =>
    t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const out: string[] = [
    'WhyFinder journal',
    `Exported ${when(Date.now())}`,
    'Kept on this device. WhyFinder is a tool for thinking out loud, not a counselor or pastor.',
    '',
    "WHAT I'M NOTICING",
  ];
  if (journal.items.length === 0) out.push('(nothing kept yet)');
  journal.items.forEach((x) => {
    out.push(`- ${x.body}  [${x.status === 'edited' ? 'in my words' : 'a guess I kept'}]`);
    x.quotes.forEach((q) => out.push(`    because I said: "${q}"`));
  });
  out.push('', 'TO BRING TO SOMEONE');
  if (journal.questions.length === 0) out.push('(nothing saved yet)');
  journal.questions.forEach((q) => out.push(`- ${q.text}`));
  out.push('', 'IN MY WORDS');
  if (entries.length === 0) out.push('(nothing yet)');
  entries.forEach((e) => out.push(`[${when(e.createdAt)}] ${e.text}`));
  if (verses.length > 0) {
    out.push('', 'PASSAGES WE LOOKED AT');
    verses.forEach((v) => out.push(`- ${v.reference} (${v.version})${v.link ? ` ${v.link}` : ''}`));
  }
  return out.join('\n');
}

function downloadText(text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = `whyfinder-journal-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * The journal. Everything here comes from this device: the guesses the person
 * kept (in the words they approved), what they said, and the passages we looked at.
 * Nothing in it is sent anywhere.
 */
function JournalPanel({ journal, entries, verses, onClose, onEdit, onRemove, onRemoveQuestion, onClear }: {
  journal: Journal; entries: SavedEntry[]; verses: Verse[];
  onClose: () => void; onEdit: (id: string, body: string) => void; onRemove: (id: string) => void;
  onRemoveQuestion: (text: string) => void; onClear: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const seen = new Set<string>();
  const uniqueVerses = verses.filter((v) => (seen.has(v.reference) ? false : (seen.add(v.reference), true)));
  const said = [...entries].reverse();
  return (
    <aside className="j-panel" aria-label="Journal">
      <div className="j-head">
        <div className="j-title">Your journal</div>
        <button className="j-close" onClick={onClose} aria-label="Close journal">&times;</button>
      </div>
      <p className="j-lead">
        A place to look back. It lives on this device only, and nothing goes in it unless you say so.
      </p>

      <section className="j-section">
        <h2 className="j-h">What I&rsquo;m noticing</h2>
        {journal.items.length === 0 ? (
          <p className="j-empty">
            Nothing kept yet. When I offer a guess, you can keep it, say it in your own words, or drop it.
            Kept guesses will be here.
          </p>
        ) : (
          journal.items.map((x) => (
            <div className="j-card" key={x.id}>
              <div className="j-tag">{x.status === 'edited' ? 'In your words' : 'A guess you kept'}</div>
              {editId === x.id ? (
                <>
                  <textarea className="j-edit-box" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
                  <div className="j-row">
                    <button className="btn btn-accept" disabled={!draft.trim()}
                            onClick={() => { onEdit(x.id, draft.trim()); setEditId(null); }}>Save</button>
                    <button className="btn btn-ghost" onClick={() => setEditId(null)}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="j-body">{x.body}</p>
                  {x.quotes.length > 0 && (
                    <details className="j-why">
                      <summary>Because you said</summary>
                      {x.quotes.map((q, i) => <p className="quote" key={i}>{q}</p>)}
                    </details>
                  )}
                  <div className="j-row">
                    <button className="j-link" onClick={() => { setEditId(x.id); setDraft(x.body); }}>Edit</button>
                    <button className="j-link" onClick={() => onRemove(x.id)}>Remove</button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </section>

      <section className="j-section">
        <h2 className="j-h">To bring to someone</h2>
        {journal.questions.length === 0 ? (
          <p className="j-empty">
            When an answer ends with questions to sit with, you can save the ones worth taking to a pastor,
            a counselor or a friend. They will be here.
          </p>
        ) : (
          <ul className="j-list">
            {journal.questions.map((q) => (
              <li key={q.text}>
                <span>{q.text}</span>
                <button className="j-link" onClick={() => onRemoveQuestion(q.text)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="j-section">
        <h2 className="j-h">In your words</h2>
        {said.length === 0 ? (
          <p className="j-empty">What you write will collect here, newest first.</p>
        ) : (
          <ul className="j-list">
            {said.map((e) => (
              <li key={e.id}>
                <span className="j-time">
                  {e.createdAt ? new Date(e.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                </span>
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {uniqueVerses.length > 0 && (
        <section className="j-section">
          <h2 className="j-h">Passages we looked at</h2>
          <ul className="j-list">
            {uniqueVerses.map((v) => (
              <li key={v.reference}>
                <span>{v.reference} ({v.version}) </span>
                {v.link && <a className="j-link" href={v.link} target="_blank" rel="noreferrer">Read on YouVersion</a>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="j-foot">
        <div className="j-actions">
          <button className="btn" onClick={() => {
            const text = journalText(journal, entries, uniqueVerses);
            const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); };
            if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => downloadText(text));
            else downloadText(text);
          }}>{copied ? 'Copied' : 'Copy'}</button>
          <button className="btn" onClick={() => downloadText(journalText(journal, entries, uniqueVerses))}>Download</button>
        </div>
        <span className="j-foot-note">Your journal as plain text, to keep or to bring to someone. Nothing is sent anywhere.</span>
        <button className="j-link" onClick={() => { if (window.confirm('Erase this conversation and your journal from this device?')) onClear(); }}>Clear this device</button>
        <span className="j-foot-note">Erases the conversation and this journal.</span>
      </div>
    </aside>
  );
}

/** Long passages start collapsed. The full text is one tap away. */
function PassageText({ reference, version, text }: { reference: string; version: string; text: string }) {
  const LIMIT = 320;
  const [open, setOpen] = useState(false);
  const long = text.length > LIMIT;
  const shown = !long || open ? text : `${text.slice(0, LIMIT).replace(/\s+\S*$/, '')}\u2026`;
  return (
    <p className="quote">
      <strong>{reference}</strong> ({version}) {shown}
      {long && (
        <> <button className="j-link" onClick={() => setOpen((o) => !o)}>{open ? 'Show less' : 'Show more'}</button></>
      )}
    </p>
  );
}

/** A faith answer. Labelled by kind, and it ends in questions and people, not a verdict. */
function AnswerCard({ a, saved, onSave }: { a: Answer; saved: string[]; onSave: (q: string) => void }) {
  return (
    <div className="synthesis">
      <div className="syn-kind">{KIND_LABEL[a.kind] ?? 'A thought to weigh'}</div>
      <div className="syn-body">{a.body}</div>
      {a.scripture.length > 0 && (
        <div className="syn-evidence">
          <div className="syn-evidence-label">Where to read</div>
          {a.passages && a.passages.length > 0
            ? a.passages.map((p, i) => (
                <div key={i}>
                  <PassageText reference={p.reference} version={p.version} text={p.text} />
                  <p className="reflect-note">{p.versionTitle}. {p.copyright}{p.link ? <> <a href={p.link} target="_blank" rel="noreferrer">Read on YouVersion</a></> : null}</p>
                </div>
              ))
            : a.scripture.map((s, i) => <p className="quote" key={i}>{s}</p>)}
        </div>
      )}
      {a.questionsToConsider.length > 0 && (
        <div className="syn-evidence">
          <div className="syn-evidence-label">Questions to sit with</div>
          {a.questionsToConsider.map((q, i) => (
            <p className="quote" key={i}>
              {q}{' '}
              <button className="j-link" onClick={() => onSave(q)}>
                {saved.includes(q) ? 'Saved to journal' : 'Save to bring to someone'}
              </button>
            </p>
          ))}
        </div>
      )}
      {a.counsel.length > 0 && (
        <div className="syn-evidence">
          <div className="syn-evidence-label">People worth talking to</div>
          {a.counsel.map((c, i) => <p className="quote" key={i}>{c}</p>)}
        </div>
      )}
    </div>
  );
}

/**
 * Shown once, when the session has felt heavy for a while. Fixed text. It points
 * to people, says out loud that the pause lives only in this conversation, and
 * lets the person choose. Nothing here counts, scores or stores anything (C-27).
 */
function SupportCardView({ s, onResume, onResources }: {
  s: Support; onResume: () => void; onResources: () => void;
}) {
  const [phase, setPhase] = useState<'open' | 'staying' | 'resumed'>('open');
  return (
    <div className="synthesis">
      <div className="syn-kind">{s.title}</div>
      <div className="syn-body">{s.lead}</div>
      <div className="syn-evidence">
        {s.items.map((i) => (
          <div key={i.name}>
            <div className="syn-evidence-label">{i.name}</div>
            <p className="quote">{i.detail}</p>
          </div>
        ))}
      </div>
      <p className="composer-note">{s.note}</p>
      {phase === 'open' ? (
        <div className="syn-actions">
          <button className="btn btn-accept" onClick={() => setPhase('staying')}>Keep talking</button>
          <button className="btn" onClick={() => { setPhase('resumed'); onResume(); }}>
            Back to the questions
          </button>
          <button className="btn btn-ghost" onClick={onResources}>More ways to reach someone</button>
        </div>
      ) : (
        <div className="syn-resolved">
          {phase === 'staying' ? 'I am here. Say whatever is on your mind.' : 'Back to the questions whenever you are ready.'}
        </div>
      )}
    </div>
  );
}

/**
 * One small thing to try. Declining costs nothing and is never remembered
 * against anyone. The reflect step is two taps and an optional line.
 */
function ExperimentCard({ x, onChoose, onReflect }: {
  x: Experiment;
  onChoose: (c: 'accept' | 'own' | 'skip') => void;
  onReflect: (f: 'more' | 'less' | 'unsure', note?: string) => void;
}) {
  const [phase, setPhase] = useState<'offer' | 'accepted' | 'reflect' | 'own' | 'skipped' | 'done'>('offer');
  const [note, setNote] = useState('');
  const [feel, setFeel] = useState<null | 'more' | 'less' | 'unsure'>(null);

  if (phase === 'skipped') return <div className="synthesis"><div className="syn-resolved">No problem. It will keep.</div></div>;
  if (phase === 'own') {
    return (
      <div className="synthesis">
        <div className="syn-resolved">
          Good, your own idea is better. Try it, and tell me here how it went whenever you like.
        </div>
      </div>
    );
  }
  if (phase === 'done') return <div className="synthesis"><div className="syn-resolved">Thank you. That helps.</div></div>;

  return (
    <div className="synthesis">
      <div className="syn-kind">Something small to try</div>
      <div className="syn-body">{x.title}</div>
      {phase === 'offer' ? (
        <div className="syn-actions">
          <button className="btn btn-accept" onClick={() => { onChoose('accept'); setPhase('accepted'); }}>
            I&rsquo;ll try it
          </button>
          <button className="btn" onClick={() => { onChoose('own'); setPhase('own'); }}>
            I have my own idea
          </button>
          <button className="btn btn-ghost" onClick={() => { onChoose('skip'); setPhase('skipped'); }}>
            Not now
          </button>
        </div>
      ) : phase === 'accepted' ? (
        <div className="syn-actions">
          <button className="btn btn-accept" onClick={() => setPhase('reflect')}>
            I&rsquo;ve tried it
          </button>
          <span className="composer-note">Come back to this card whenever you have.</span>
        </div>
      ) : (
        <div className="syn-evidence">
          <div className="syn-evidence-label">Afterwards, how did it feel?</div>
          <div className="syn-actions">
            {(['more', 'less', 'unsure'] as const).map((f) => (
              <button key={f} className={`btn ${feel === f ? 'btn-accept' : ''}`} onClick={() => setFeel(f)}>
                {f === 'more' ? 'More of that' : f === 'less' ? 'Less of that' : 'Not sure'}
              </button>
            ))}
          </div>
          {feel && (
            <>
              <input
                className="reflect-note"
                placeholder="A few words, if you like"
                aria-label="A few words about how it went"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="syn-actions">
                <button className="btn btn-accept"
                        onClick={() => { onReflect(feel, note); setPhase('done'); }}>
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Sheet({ title, lead, children, onClose }: {
  title: string; lead: string; children: React.ReactNode; onClose: () => void;
}) {
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p>{lead}</p>
        {children}
        <button className="btn sheet-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}