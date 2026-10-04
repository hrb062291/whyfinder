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

type Answer = {
  body: string; kind: string; scripture: string[]; questionsToConsider: string[]; counsel: string[];
};
type Experiment = { id: string; title: string };

type Turn =
  | { kind: 'disclosure' }
  | { kind: 'app'; text: string }
  | { kind: 'care'; text: string }
  | { kind: 'you'; text: string }
  | { kind: 'synthesis'; synthesis: Synthesis; quotes: string[] }
  | { kind: 'answer'; answer: Answer }
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

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([{ kind: 'disclosure' }]);
  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | 'crisis' | 'gates'>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    // Strict Mode runs effects twice in dev; begin once.
    if (started.current) return;
    started.current = true;
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
        if (o.care) next.push({ kind: 'care', text: o.care.text });
        if (o.reply) next.push({ kind: 'app', text: o.reply });
        if (o.answer) next.push({ kind: 'answer', answer: o.answer });
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
        if (o.care?.showResources) setSheet('crisis');
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
              {t.kind === 'you' && <p className="you">{t.text}</p>}
              {t.kind === 'synthesis' && <SynthesisCard body={t.synthesis.body} quotes={t.quotes} />}
              {t.kind === 'answer' && <AnswerCard a={t.answer} />}
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

function SynthesisCard({ body, quotes }: { body: string; quotes: string[] }) {
  const [resolved, setResolved] = useState<string | null>(null);
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
      {resolved ? (
        <div className="syn-resolved">{resolved}</div>
      ) : (
        <div className="syn-actions">
          <button className="btn btn-accept"
                  onClick={() => setResolved('Kept. You can change or remove this any time.')}>
            Keep this
          </button>
          <button className="btn"
                  onClick={() => setResolved('Edit it in your own words — what gets saved is exactly what you write.')}>
            Edit
          </button>
          <button className="btn btn-ghost"
                  onClick={() => setResolved('Dropped, along with anything built on it.')}>
            That&rsquo;s not it
          </button>
        </div>
      )}
    </div>
  );
}

/** A faith answer. Labelled by kind, and it ends in questions and people, not a verdict. */
function AnswerCard({ a }: { a: Answer }) {
  return (
    <div className="synthesis">
      <div className="syn-kind">{KIND_LABEL[a.kind] ?? 'A thought to weigh'}</div>
      <div className="syn-body">{a.body}</div>
      {a.scripture.length > 0 && (
        <div className="syn-evidence">
          <div className="syn-evidence-label">Where to read</div>
          {a.scripture.map((s, i) => <p className="quote" key={i}>{s}</p>)}
        </div>
      )}
      {a.questionsToConsider.length > 0 && (
        <div className="syn-evidence">
          <div className="syn-evidence-label">Questions to sit with</div>
          {a.questionsToConsider.map((q, i) => <p className="quote" key={i}>{q}</p>)}
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
