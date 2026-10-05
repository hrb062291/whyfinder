// Plays scripted conversations through the REAL /api/turn route and writes what
// the app actually says to scripts/transcripts.txt. Needs `npm run dev` running.
//   node scripts/try.mjs            (uses http://localhost:3000)
//   node scripts/try.mjs 3001       (different port)
// Sends nothing anywhere except your own local server. Prints no keys.
import { writeFileSync } from 'node:fs';

const BASE = `http://localhost:${process.argv[2] ?? 3000}/api/turn`;

const SCENARIOS = {
  'friends drifting': ['not much', 'I was feeling extremely anxious', 'im feeling extremely lost with my friends. It doesnt feel like we build each other up anymore. We just do different things and when we hang out we drain each other', 'help', "yes it's very urgent. I'm feeling lost and you're not giving me any direction"],
  'bible about anxiety': ['what does the bible say about anxiety', 'I have been overwhelmed with school and work', 'what is the point of you', 'back to the questions'],
  'bible about god': ['what does the bible say about god', 'who is god to me'],
  'ordinary day': ['I spent most of Saturday rewiring the shed with Tom.', 'Mostly running new wire and swapping the breaker.', 'Tom held the flashlight and I did the wiring.', 'We talked about his new job the whole time', 'I guess I like building things with other people'],
  'direction at work': ['I keep wondering if I should quit my job', 'I like the people but the work feels empty', 'how do I know what God wants me to do with my career'],
  'forgiveness': ['Tell me what the Bible says about forgiveness', 'my brother and I have not spoken in a year'],
  'distant from god': ['ive been feeling distant from god', 'connected', 'I think so'],
  'dark moment': ['I do not see the point of going on anymore'],
  'faith doubt': ['I am not sure I believe anymore', 'I stopped praying about six months ago', 'what should I do'],
};

async function post(body) {
  const res = await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

const FALLBACK = 'worth taking to a pastor or a mentor you trust';
const out = [];
for (const [name, lines] of Object.entries(SCENARIOS)) {
  out.push(`\n=================== ${name} ===================`);
  let { state, output } = await post({ action: 'begin' });
  out.push(`APP: ${output?.text ?? ''}`);
  for (const line of lines) {
    out.push(`\nYOU: ${line}`);
    const r = await post({ action: 'turn', state, text: line });
    state = r.state ?? state;
    const o = r.output ?? {};
    if (r.mode) out.push(`  [mode=${r.mode}${r.degraded ? ' DEGRADED' : ''}${r.fallbackReason ? ' reason=' + r.fallbackReason : ''}${r.detail ? ' error=' + r.detail : ''}]`);
    if (o.care) out.push(`  [care] ${o.care.text ?? JSON.stringify(o.care)}`);
    if (o.reply) out.push(`APP reply: ${o.reply}`);
    if (o.answer) {
      const fb = o.answer.body?.includes(FALLBACK);
      out.push(`APP answer${fb ? ' [FALLBACK - model answer was dropped: ' + (o.answer.dropped ?? 'unknown') + ']' : ''}: ${o.answer.body}`);
      if (o.answer.scripture?.length) out.push(`  scripture asked: ${o.answer.scripture.join('; ')}`);
      if (o.answer.passages?.length) out.push(`  verses fetched: ${o.answer.passages.map((p) => p.reference).join('; ')}`);
    }
    if (o.synthesis) out.push(`APP guess card: ${o.synthesis.body}`);
    if (o.support) out.push(`  [SUPPORT CARD SHOWN]`);
    if (o.experiment) out.push(`  [experiment offered: ${o.experiment.title}]`);
    out.push(`APP: ${o.text ?? '(' + o.kind + ')'}`);
  }
}
writeFileSync('scripts/transcripts.txt', out.join('\n'));
console.log(`Done. Wrote scripts/transcripts.txt (${out.length} lines). Paste its contents (or attach the file) and also copy any "[whyfinder] answer dropped" lines from the dev server window.`);
