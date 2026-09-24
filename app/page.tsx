'use client';

/**
 * The first screen.
 *
 * Every constraint that matters runs on the server (/api/turn). This component
 * renders what survives the filter and nothing else — there is no client-side
 * path that displays a suppressed body.
 */

import { useEffect, useRef, useState } from 'react';
import type { Synthesis } from '../src/types/index.js';

type Turn =
  | { kind: 'disclosure' }
  | { kind: 'app'; text: string }
  | { kind: 'you'; text: string }
  | { kind: 'synthesis'; synthesis: Synthesis; quotes: string[] };

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
  ['The harder questions',
   'Questions about pain, regret, fear and loss are switched off until a pastoral reviewer has signed off on them.'],
  ['How we label scripture',
   'The scheme that separates what the Bible says from how a tradition reads it has not been reviewed.'],
];

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([{ kind: 'disclosure' }]);
  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | 'crisis' | 'gates'>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
        if (o.synthesis) {
          const quotes: string[] = (o.synthesis.evidence as string[])
            .map((id: string) => (r.state.entries as { id: string; text: string }[])
              .find((e) => e.id === id)?.text)
            .filter(Boolean) as string[];
          next.push({ kind: 'synthesis', synthesis: o.synthesis, quotes });
        }
        if (o.text) next.push({ kind: 'app', text: o.text });
        setTurns((t) => [...t, ...next]);
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
              {t.kind === 'you' && <p className="you">{t.text}</p>}
              {t.kind === 'synthesis' && <SynthesisCard body={t.synthesis.body} quotes={t.quotes} />}
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
