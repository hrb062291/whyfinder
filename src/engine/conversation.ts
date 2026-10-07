/**
 * The conversation layer.
 *
 * Wraps takeTurn() without changing it. takeTurn still owns the acute-signal
 * check, the entry log, the question gate and the synthesis filter. This layer
 * adds, in order of phase:
 *
 *   2  a one-or-two sentence reply to what the person just said, and faith
 *      Q&A framed as discernment. Both pass filterProse() or are dropped.
 *   3  one small experiment after the first synthesis.
 *
 * Distress never goes through a model here. Mild and elevated concern get fixed
 * wording from concernTier.ts, and acute is takeTurn's own path.
 */

import { PHASE } from '../config/phases.js';
import { careFor, concernTier, type Care } from '../constraints/concernTier.js';
import { acuteResponse, crisisContext } from '../constraints/acuteSignal.js';
import { filterProse } from '../constraints/proseFilter.js';
import { nextQuestion, recordServed } from '../constraints/questionGate.js';
import {
  ABOUT_APP_REPLY, SUPPORT_CHECKIN, SUPPORT_CONTINUE, asksAboutApp, wantsQuestionsBack, TENDER_LINE, evaluateSupport, isThin, isTender, saysNothingYet, strainWeight, supportCard,
  type SupportCard, type SupportState,
} from '../constraints/support.js';
import { QUESTIONS } from '../content/questions.js';
import {
  offer, pickExperiment, type Experiment, type ExperimentRecord,
} from '../content/experiments.js';
import { fetchPassages, type Passage, type YvConfig } from '../content/scripture.js';
import { STATEMENT_KINDS, type Entry, type ModelProvider, type StatementKind, type Synthesis } from '../types/index.js';
import { NO_OP, OPENING, takeTurn, type SessionState, type TurnDeps, type TurnOutput } from './session.js';

export type ConvState = SessionState & {
  experiments?: ExperimentRecord[];
  support?: SupportState;
  /** How many follow-ups in a row we have asked. After two, the bank gets a turn. */
  followStreak?: number;
  /** Number of entries when the last guess was offered. Spaces out guesses. */
  lastGuessAt?: number;
  /** Turns left to stay gentle after something tender was said. */
  tenderLeft?: number;
  /**
   * Set when the person says something about ending their life (acute) or close
   * to it (elevated). `at` is the entry count then. For the next HEAVY_TURNS
   * messages there are no stock questions and no guesses, only staying with them.
   */
  heavyAt?: { at: number; level: 'acute' | 'elevated' };
  /** How many times crisis language has come up in this conversation. Sets which message is shown. */
  crisisCount?: number;
  /** Entry count when the "choose your path" block was last shown. */
  choicesAt?: number;
  /** Entry count when the app last offered Scripture in the chat. */
  bibleOfferAt?: number;
  /** True right after the app asked "Would it help to see what the Bible says?" */
  bibleOffered?: boolean;
  /** The app's own last few lines (replies, questions, answers). Used only so it does not repeat itself. */
  said?: string[];
};

// ------------------------------------------------------------------ not repeating itself

/** "I understand about community", "I know", "you said that already". */
export const ALREADY_KNOW =
  /\b(?:i (?:already )?(?:understand|know|get it|get that|got it|hear you)|(?:yeah|yes|ok|okay),? i know|you (?:already )?said that|i'?ve (?:already )?(?:heard|tried) that|you keep saying|that'?s what you said)\b/i;

/** Advice the app gives. Re-suggesting one of these right after "I know" is repeating itself. */
const SUGGESTION_TOPICS = /\b(community|church|small group|pastor|counselor|counselling|counseling|therapist|friend|friends|reach out|talk to someone|988|pray|prayer|journal|walk|exercise|sleep)\b/gi;
const SUGGEST_VERB = /\b(?:try|trying|consider|find|finding|join|joining|reach out|reaching out|look for|connect with|talk to|talking to|could you|you might|worth|maybe)\b/i;

const words = (t: string): Set<string> =>
  new Set((t.toLowerCase().match(/[a-z']{4,}/g) ?? []).filter((w) => !REPEAT_STOP.has(w)));
const REPEAT_STOP = new Set(['that','this','with','what','when','where','which','about','there','their','them','they',
  'then','than','have','were','been','your','from','just','like','really','very','some','more','much','also','into',
  'over','only','still','would','could','should','because','while','after','before','being','doing','most','many',
  'you\'re','it\'s','i\'m','feel','feels','want','wants','things','thing','time','sounds','something']);

/**
 * True when `candidate` says again what the app already said: most of its words
 * appear in one earlier line, or it re-suggests advice the person just said they
 * already understand.
 */
export function repeatsItself(candidate: string, prior: string[], latest = ''): boolean {
  const c = words(candidate);
  if (c.size >= 4) {
    for (const p of prior) {
      const pw = words(p);
      if (pw.size < 4) continue;
      let shared = 0;
      c.forEach((w) => { if (pw.has(w)) shared++; });
      if (shared / Math.min(c.size, pw.size) >= 0.7) return true;
    }
  }
  // Asking about it ("what makes finding community hard?") is moving on. Telling them again is not.
  const statements = candidate.split(/(?<=[.!?])\s+/).filter((x) => !x.trim().endsWith('?')).join(' ');
  if (statements && ALREADY_KNOW.test(latest)) {
    candidate = statements;
    const topics = new Set([
      ...(latest.match(SUGGESTION_TOPICS) ?? []),
      ...prior.slice(-2).flatMap((p) => p.match(SUGGESTION_TOPICS) ?? []),
    ].map((t) => t.toLowerCase()));
    const again = (candidate.match(SUGGESTION_TOPICS) ?? []).map((t) => t.toLowerCase()).filter((t) => topics.has(t));
    if (again.length > 0 && SUGGEST_VERB.test(candidate)) return true;
  }
  return false;
}

/** The part of each prompt that tells the model what it already said. */
function priorBlock(prior: string[], latest: string): string {
  if (prior.length === 0) return '';
  const list = prior.slice(-6).map((p, i) => `  ${i + 1}. ${p}`).join('\n');
  const knows = ALREADY_KNOW.test(latest)
    ? '\n- Their latest message says they already know or understand something you said. Acknowledge that in a few words and move somewhere new: what makes it hard, what they have already tried, or what they would want instead. Do NOT suggest it again.'
    : '';
  return `\n\nWhat YOU (WhyFinder) have already said to them, most recent last:\n${list}\n\n- Do not repeat any of that, and do not give the same suggestion again in other words.${knows}`;
}

/** When the gentle line was the last thing said, the next one is different. */
const TENDER_MORE = [
  'I am still here. Say as much or as little as you want.',
  'No rush. Whatever you want to say next is fine.',
];
function tenderLine(prior: string[]): string {
  const all = [TENDER_LINE, ...TENDER_MORE];
  return all.find((t) => !prior.slice(-3).includes(t)) ?? all[0];
}

const CONTINUE_MORE = [
  'I am still here. Say whatever comes next, or go back to the questions when you are ready.',
  'Take whatever time you need. You can keep going here or return to the questions.',
];
function continueLine(prior: string[]): string {
  const all = [SUPPORT_CONTINUE, ...CONTINUE_MORE];
  return all.find((t) => !prior.slice(-3).includes(t)) ?? all[0];
}

/** It cannot save anything. A reply that says it did is not true. */
export const CLAIMS_SAVED = /\b(?:saved|noted|added|logged|recorded|written down|put)\b[^.?!]{0,40}\bjournal\b|\bjournal\b[^.?!]{0,25}\b(?:saved|noted|added)\b/i;

/** Keep the app's last few lines, newest last. */
function remember(prior: string[], ...lines: (string | undefined | null)[]): string[] {
  const add = lines.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return [...prior, ...add].slice(-8);
}

/** How many messages after a crisis the app keeps stock questions and guesses away. */
export const HEAVY_TURNS = 6;

export interface FaithAnswer {
  body: string;
  kind: StatementKind;
  /** References only, never quoted text. */
  scripture: string[];
  questionsToConsider: string[];
  counsel: string[];
  /** Real verse text from YouVersion, when configured. Never written by the model. */
  passages?: Passage[];
  /** Why the model's answer was rejected. Set only on the fallback. Never shown. */
  dropped?: string;
}

export type ConversationOutput = TurnOutput & {
  care?: Care;
  reply?: string;
  answer?: FaithAnswer;
  /** Shown once, when the session has felt heavy for a while. Fixed text. */
  support?: SupportCard;
  experiment?: { id: string; title: string; source: ExperimentRecord['source'] };
  /** Show the three-way "where next?" block under this turn. */
  choices?: boolean;
};

// ------------------------------------------------------------------ where next

/** The three paths the person can pick from the block. */
export type ChoicePath = 'thoughts' | 'deeper' | 'bible';

export const CHOICE_LABELS: Record<ChoicePath, string> = {
  thoughts: 'Would you like to hear my thoughts on your situation?',
  deeper: 'Do you want to go deeper?',
  bible: 'Would you like to hear what the Bible says about what you\u2019re going through?',
};

/** Moving on, losing something, not knowing what next: a moment Scripture may speak to. */
const FITTING_MOMENT =
  /\b(?:move on|moving on|new chapter|new season|this season|starting over|start over|lost|losing|gave up|giving up|let go|letting go|taken (?:away )?from me|over for me|don'?t know (?:what|how|where)|what (?:do|should) i do|afraid|scared|grie(?:f|ving)|miss (?:my|her|him|them))\b/i;

/** Asked in the chat, not as a button. Varied, so it never reads like a script. */
const BIBLE_OFFERS = [
  'Would it help to see what the Bible says about something like this?',
  'If it would help, I can share what Scripture says about a season like this. Would you like that?',
  'Would you like to hear a passage from the Bible that speaks to this?',
];

const YES = /^(?:y|ya|yah|yea|yeah|yes|yep|yup|sure|ok|okay|k|please|yes please|sure thing|of course|definitely|i would|i'?d like that|that would help|go ahead|why not|absolutely|ok(?:ay)? sure)\b[\s.!,]*(?:please|thanks|thank you)?[\s.!]*$/i;
const NO = /^(?:no|nah|nope|not now|not really|maybe later|no thanks|no thank you|i'?m (?:ok|okay|good)|pass)\b[\s.!,]*$/i;

const BIBLE_ABOUT_ME = 'What does the Bible say about what I have been going through?';
const THOUGHTS_ABOUT_ME =
  'Based only on what I have told you, share your honest thoughts on my situation: two or three tentative observations, clearly a guess and not a finding, kind "ai_inference".';
const DEEPER_FALLBACK = 'What feels like it is underneath all of this for you?';

export interface ConvDeps {
  /** What takeTurn needs. */
  turn: TurnDeps;
  /** The LIVE model only. Left undefined on fixtures: replies and answers need a real model. */
  live?: ModelProvider;
  phase?: number;
  now?: Date;
  /** YouVersion. Left undefined, answers show plain references. */
  scripture?: YvConfig;
}

const MAX_FOLLOW_STREAK = 2;

// ------------------------------------------------------------------ prompts

function said(entries: { text: string }[]): string {
  return entries.map((e, i) => `  ${i + 1}. ${e.text}`).join('\n');
}

export function replyPrompt(entries: { text: string }[], prior: string[] = []): string {
  const latest = entries[entries.length - 1]?.text ?? '';
  return `You are the mentor voice in WhyFinder, a journal and navigator for noticing patterns in one's own life. You are not a therapist, pastor or counselor.

What this person has told you so far, oldest first:
${said(entries)}

Write ONE or TWO plain sentences responding to the most recent thing they said.

- Name something specific they just told you, in their own words, so they feel heard.
- If something they said EARLIER connects to it, you may set the two side by side as a question, using their own words: "Earlier you mentioned the billing system; does explaining things come up here too?" Never say one caused the other.
- Warm and plain, like a thoughtful friend. No advice, no diagnosis, no explaining why they feel or act this way.
- If their latest message shares a step forward (something they built, tried, finished or started; a new chapter; a strength from something they lost that they are now using somewhere new), begin by genuinely affirming it in specific words: name what they are doing and where it came from, for example that the resilience soccer gave them is showing up in the hackathon. Affirm what they are doing, never who they are. Vary the wording each time; do not open with "Congratulations" every time.
- Vary how you begin. Do not open with "I'm glad you said" or "Thank you for saying", and do not put their words in quotation marks every time. Speak naturally, and be specific rather than generic. Avoid the stock phrases "a lot to carry", "heavy", "a long stretch", "sit with" and "real ache"; find a fresher, plainer way to say it.
- Never write "you are a", "your purpose is", "that's why", "because", or anything about what God wants.
- Never describe the inner life of anyone but this person.
- Never say you saved, noted or added anything to their journal. You cannot; only the app's journal buttons and commands can.
- Never bring up suicide, self-harm, crisis lines or anything they said earlier about wanting to die, unless their latest message does. If they have moved on to something else, move on with them.
- Only if the message is empty of anything concrete, reply with exactly: NONE
Return only the sentences, no JSON.${priorBlock(prior, latest)}`;
}

export function followUpPrompt(entries: { text: string }[], prior: string[] = [], deeper = false): string {
  const latest = entries[entries.length - 1]?.text ?? '';
  // The questions go a little deeper as the conversation does, so it has a direction.
  const real = entries.filter((e) => !isThin(e.text)).length;
  const aim = deeper
    ? 'what is underneath what they have been describing: what it means to them, what they hope for, or what they are afraid of losing. Gentle, not probing.'
    : real <= 2
      ? 'what they actually did or what it involved: the concrete details.'
      : real <= 4
        ? 'how it was for them: what held their attention, what drained them, or who it was for.'
        : 'what they might want more of, or one small thing they could try next to find out.';
  return `You are the mentor voice in WhyFinder. You are not a therapist, pastor or counselor.

What this person has told you so far, oldest first:
${said(entries)}

Ask ONE short follow-up question about something concrete in their MOST RECENT message: a thing they did, a person, a place, a task. The kind of question a curious friend asks to hear more.

Aim the question at ${aim}

- Use one of their own words for the thing you are asking about.
- Open-ended: it should invite a sentence or two, not yes or no.
- Avoid the stock phrases "carry", "heavy" and "long stretch".
- Never bring up suicide, self-harm, crisis lines or anything they said earlier about wanting to die, unless their latest message does.
- Sound natural. Do not recite their earlier words back in quotation marks; refer to them lightly, the way a person would.
- Under 140 characters. One question mark. No advice and no explanation.
- Do not start with "Why". Do not guess how they feel. Do not mention purpose, calling or God unless they did.
- If their message has nothing concrete to ask about, reply with exactly: NONE
Return only the question.${priorBlock(prior, latest)}`;
}

export function answerPrompt(entries: { text: string }[], prior: string[] = [], question = ''): string {
  return `You are the mentor voice in WhyFinder, a tool for noticing patterns in one's own life. You are not a therapist, pastor or counselor and you do not speak for God.

The person has asked you a question. What they have told you so far:
${said(entries) || '  (nothing yet)'}

Help them DISCERN. Do not decide for them.

Return ONLY a JSON object:
{
  "body": "<2 to 4 short sentences, under 600 characters in total>",
  "kind": "biblical_teaching" | "christian_interpretation" | "psychological_research" | "ai_inference",
  "scripture": ["<reference such as Romans 12:2>"],
  "questionsToConsider": ["<question>", "<question>"],
  "counsel": ["<kind of person to seek out, e.g. a pastor or a trusted mentor>"]
}

Rules. Output that breaks any of these is discarded.
- "kind" is exactly one value, and "body" is only that kind of statement.
- Scripture: give references only. Never quote verses.
- Use "may want to prayerfully consider", "one reading is", "worth asking". Never say God is telling, calling or leading them.
- Where Christians disagree (gifts, women in ministry, divorce, and so on) say that traditions differ and point to a pastor.
- Where relevant, name the good that a choice could bring into their life, as well as the cost.
- Do not use clinical or personality-type labels they did not use first.
- Avoid "because", "that is why" and "which explains" when linking their feelings to causes. Put two separate observations side by side instead.
- If they describe anxiety, low mood or distress: acknowledge it plainly in one sentence, never diagnose or name a condition, and give no medical advice. Ordinary, low-risk steps (writing the worry down, a short walk, telling one person) are fine. Say that a doctor or licensed counselor can help, and put one of those in "counsel" alongside a pastor or trusted friend.
- "questionsToConsider" has two or three questions. "counsel" has one or two entries.${priorBlock(prior, question)}`;
}

// ------------------------------------------------------------------ detection

const INTERROGATIVE = /^(?:how|what|why|should|does|do|is|can|will|where|who|when|am|are|would|could)\b/i;
const FAITH_OR_DIRECTION =
  /\b(god|jesus|christ|bible|scripture|pray|prayer|faith|sin|church|calling|called|purpose|direction|meaning|career|job|quit|leave|marry|move|anxiety|anxious|stress|stressed|worry|worried|lonely|depressed|overwhelmed|cope|afraid|scared)\b/i;

const HELP_REQUEST =
  /\b(?:i need (?:some )?help|need (?:some )?help|can you help|help me|how (?:can|do|should) i|what (?:can|should) i do|what do i do)\b/i;
const GROWTH_OR_DIRECTION =
  /\b(?:better person|become|grow|growth|change|direction|path|decision|decide|forgive|forgiveness|trust|faith|god|pray|prayer|calling|career|job|relationship|marriage|habits?|life)\b/i;
/** "Explain…", "tell me…", "what does the Bible say…" asked as an instruction. */
const EXPLAIN_REQUEST =
  /\b(?:explain|tell me|teach me|help me understand|what does the bible say|what do christians (?:believe|think))\b/i;
/** "Who is God to me" with no question mark: a direct question about God or faith. */
const DIRECT_FAITH_QUESTION =
  /^(?:who|what|how|why) (?:is|are|was|does|do|should|can) (?:god|jesus|christ|the bible|prayer|faith|the holy spirit)\b/i;

/**
 * The person is asking the app something, rather than answering a question.
 * Real questions about faith or direction (even when the question word is not
 * first, or the question mark is missing), instructions like "explain…", and
 * plain requests for help ("I need help on how I can become a better person").
 * Anything with signs of strain is not routed here: the support path handles it.
 */
/** "Give me direction", "you're not giving me any guidance": a plain ask for direction. */
const DIRECTION_ASK =
  /\b(?:give me (?:some |any )?(?:direction|guidance)|(?:not|n'?t) giving me (?:any )?(?:direction|guidance|answers?|advice)|need (?:some )?(?:direction|guidance)|where do i (?:start|begin)|(?:any|some) (?:direction|guidance))\b/i;

/** Asking what Scripture says, in the many ways people phrase it, with or without a question mark. */
export const BIBLE_ASK = new RegExp([
  "\\bwhat (?:does |do |did )?(?:the )?(?:bible|scripture|scriptures|god|jesus|god'?s word) (?:says?|teach(?:es)?|think|thinks|have to say|tells? us)\\b",
  "\\b(?:is|are) there (?:anything|something|any verses?|a verse|verses|a passage|passages|any passages?) (?:in|from) (?:the )?(?:bible|scripture|scriptures)\\b",
  "\\b(?:does|did|do) (?:the )?(?:bible|scripture|scriptures) (?:say|talk|speak|mention|have)\\b",
  "\\b(?:a |any |some )?(?:bible )?verses? (?:about|for|on) \\w+",
  "\\b(?:biblical|christian) (?:view|perspective|take) (?:on|of)\\b",
  "\\bwhat(?:'s| is) (?:the |my )?next step\\b",
  "\\bnext step (?:i|that i) should\\b",
].join('|'), 'i');

const SHORT_DIRECTION =
  /^(?:so |ok |okay )?(?:what (?:should|can|do) i do(?: now| then)?|what now|help me|help|where do i (?:start|begin)|what next)\W*$/i;

export function isAskingUs(text: string, hasContext = false): boolean {
  const t = text.trim().replace(/^[\s"'“”‘’]+|[\s"'“”‘’\\]+$/g, '');
  // A short plea ("what should I do", "help") after the person has said something
  // is a request for direction, and it is answered with that context.
  if (hasContext && SHORT_DIRECTION.test(t)) return true;
  if (t.split(/\s+/).length < 4) return false;
  const strained = strainWeight(t) > 0;
  const sentences = t.split(/(?<=[.?!])\s+/).map((x) => x.trim());
  if (t.includes('?') && sentences.some((x) => INTERROGATIVE.test(x)) && FAITH_OR_DIRECTION.test(t)) return true;
  // Asking for direction is a question for us even when the person is struggling.
  if (DIRECTION_ASK.test(t)) return true;
  // "Is there anything in the Bible about…", "I want to know what the Bible says
  // about what I said": asking for Scripture is answered, struggling or not.
  if (BIBLE_ASK.test(t)) return true;
  if (strained) return false;
  if (EXPLAIN_REQUEST.test(t) && FAITH_OR_DIRECTION.test(t)) return true;
  if (DIRECT_FAITH_QUESTION.test(t)) return true;
  return HELP_REQUEST.test(t) && GROWTH_OR_DIRECTION.test(t);
}

/** Said under a faith answer when the last question was a follow-up, not a bank question. */
export const AFTER_ANSWER = 'What stands out to you in that? We can keep going from there.';

export const ANSWER_FALLBACK =
  'That is a question worth taking to a pastor or a mentor you trust. Christians differ on it, and I would not want to speak for God. We can pick up where we were whenever you like.';

// ------------------------------------------------------------------ generation

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : [];

export async function generateReply(
  live: ModelProvider, entries: { text: string }[], prior: string[] = [],
): Promise<string | null> {
  const raw = (await live.complete(
    entries.map((e) => ({ role: 'user', content: e.text })), replyPrompt(entries, prior),
  )).trim();
  if (!raw || /^none\b/i.test(raw)) return null;
  if (repeatsItself(raw, prior, entries[entries.length - 1]?.text ?? '')) return null;
  if (CLAIMS_SAVED.test(raw)) return null;
  return filterProse(raw, { maxChars: 400 }).pass ? raw : null;
}

/** "Sentence one. Sentence two?" becomes "Sentence one." Null if nothing is left. */
export function withoutQuestion(reply: string): string | null {
  const m = reply.trim().match(/^([\s\S]*?[.!])\s+[^.!?]*\?$/);
  return m ? m[1].trim() : null;
}

const STOP = new Set(['that','this','with','what','when','where','which','about','there','their','them','they',
  'then','than','have','were','been','your','from','just','like','really','very','some','more','much','also',
  'into','over','only','still','would','could','should','because','while','after','before','being','doing',
  'most','many','spent','life','time','things','thing','matters','matter','feel','feels','want','wants','mean','means']);

const contentWords = (t: string): Set<string> =>
  new Set((t.toLowerCase().match(/[a-z']{4,}/g) ?? []).filter((w) => !STOP.has(w)));

/**
 * One short follow-up about something the person actually said. It is checked,
 * not trusted: it must be a single question, pass the prose filter, and reuse
 * at least one of their own words. Anything else becomes null and the bank asks.
 */
export async function generateFollowUp(
  live: ModelProvider, entries: { text: string }[], prior: string[] = [], deeper = false,
): Promise<string | null> {
  const raw = (await live.complete(
    entries.map((e) => ({ role: 'user', content: e.text })), followUpPrompt(entries, prior, deeper),
  )).trim().replace(/^["“]|["”]$/g, '');
  if (repeatsItself(raw, prior, entries[entries.length - 1]?.text ?? '')) return null;
  if (CLAIMS_SAVED.test(raw)) return null;
  if (!raw || /^none\b/i.test(raw)) return null;
  if (raw.length > 180 || (raw.match(/\?/g) ?? []).length !== 1 || !raw.endsWith('?')) return null;
  if (/^why\b/i.test(raw) || /\b(?:purpose|calling)\b/i.test(raw)) return null;
  if (!filterProse(raw, { maxChars: 200 }).pass) return null;
  const last = entries[entries.length - 1]?.text ?? '';
  const theirs = contentWords(last);
  const used = [...contentWords(raw)].some((w) => theirs.has(w));
  return used ? raw : null;
}

export async function generateAnswerDetailed(
  live: ModelProvider, question: string, entries: { text: string }[], prior: string[] = [],
): Promise<{ answer: FaithAnswer | null; reason: string | null }> {
  const system = answerPrompt(entries, prior, question);
  const attempt = async (messages: { role: 'user' | 'assistant'; content: string }[]) => {
    const raw = await live.complete(messages, system);
    const fail = (why: string) => {
      console.warn('[whyfinder] answer dropped:', why, '| raw:', raw.slice(0, 400));
      return { answer: null as FaithAnswer | null, reason: why };
    };
    const obj = parseJson(raw);
    if (!obj || typeof obj.body !== 'string') return fail('not valid JSON');
    const kind = obj.kind as StatementKind;
    if (!STATEMENT_KINDS.includes(kind)) return fail(`bad kind: ${String(obj.kind)}`);
    const answer: FaithAnswer = {
      body: obj.body,
      kind,
      scripture: strings(obj.scripture, 4),
      questionsToConsider: strings(obj.questionsToConsider, 3),
      counsel: strings(obj.counsel, 2),
    };
    // Judge everything the person will read, not just the body. The default
    // 900-character cap is for replies; an answer carries more.
    const all = [answer.body, ...answer.questionsToConsider, ...answer.counsel].join(' ');
    const verdict = filterProse(all, { maxChars: 2000 });
    if (!verdict.pass) return fail(`filter: ${verdict.violations.join(', ')}`);
    // An answer with no way forward is just a verdict.
    if (answer.questionsToConsider.length === 0 || answer.counsel.length === 0) {
      return fail('no questions or no counsel');
    }
    if (repeatsItself(answer.body, prior, question)) return fail('repeats what you already told them');
    return { answer, reason: null as string | null };
  };

  const first = await attempt([{ role: 'user', content: question }]);
  if (first.answer) return first;
  // One more try, told what went wrong. The same filter judges the second one.
  return attempt([{
    role: 'user',
    content: `${question}\n\n(Your last reply was rejected: ${first.reason}. Reply again with ONLY the JSON object, fixing that. ` +
      'Keep "body" short, include 2 or 3 questionsToConsider and 1 or 2 counsel entries, and follow every rule.)',
  }]);
}

export async function generateAnswer(
  live: ModelProvider, question: string, entries: { text: string }[],
): Promise<FaithAnswer | null> {
  return (await generateAnswerDetailed(live, question, entries)).answer;
}

// ------------------------------------------------------------------ the turn

function currentQuestion(s: SessionState): { text: string; id: string } {
  const q = s.currentQuestionId ? QUESTIONS.find((x) => x.id === s.currentQuestionId) : undefined;
  return q ? { text: q.text, id: q.id } : { text: OPENING, id: s.currentQuestionId ?? 'opening' };
}

/**
 * Passed to takeTurn when no guess should be attempted. It returns nothing, so
 * the engine's own parse step finds no candidate and moves on. The entry is
 * still recorded; only the guess is withheld.
 */
const NO_SYNTHESIS: ModelProvider = { name: 'fixture', async complete() { return ''; } };

/** Messages the person must send between one guess and the next. */
export const GUESS_SPACING = 3;

/**
 * Guesses are spaced out. A pattern needs new material to stand on, and a card
 * on every turn reads as pushing a conclusion. `lastGuessAt` is a plain count of
 * entries at the time of the last guess; it holds no words.
 */
export function tooSoonForGuess(s: ConvState, entriesNow: number): boolean {
  return typeof s.lastGuessAt === 'number' && entriesNow - s.lastGuessAt < GUESS_SPACING;
}

/** Back to the question bank after the support pause. No model call. */
export function resumeQuestions(
  s: ConvState, now: Date = new Date(),
): { state: ConvState; output: ConversationOutput } {
  const support = s.support ? { ...s.support, active: false } : undefined;
  const q = nextQuestion(s.gate, now);
  if (!q) return { state: { ...s, support }, output: { kind: 'exhausted', text: NO_OP } };
  return {
    state: { ...s, support, gate: recordServed(s.gate, q, now), currentQuestionId: q.id },
    output: { kind: 'question', text: q.text, questionId: q.id },
  };
}

/**
 * A faith answer about the person's own situation, built from what they have
 * said. Used when they say yes to the Scripture offer, or pick a path from the
 * block. Same model, same filters, same YouVersion text as any faith answer.
 */
async function answerAboutThem(
  s: ConvState, deps: ConvDeps, question: string, extra: Partial<ConvState> = {},
): Promise<{ state: ConvState; output: ConversationOutput }> {
  const prior = s.said ?? [];
  let answer: FaithAnswer | null = null;
  let why = 'no live model';
  if (deps.live) {
    try {
      const d = await generateAnswerDetailed(deps.live, question, s.entries, prior);
      answer = d.answer;
      if (d.reason) why = d.reason;
    } catch (e) {
      why = `threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    }
  }
  if (answer && deps.scripture && answer.scripture.length > 0) {
    const passages = await fetchPassages(answer.scripture, deps.scripture).catch(() => []);
    if (passages.length > 0) answer = { ...answer, passages };
  }
  const shown: FaithAnswer = answer
    ?? { body: ANSWER_FALLBACK, kind: 'ai_inference', scripture: [], questionsToConsider: [], counsel: [], dropped: why };
  return {
    state: {
      ...s, ...extra, bibleOffered: false, currentQuestionId: 'followup',
      said: remember(prior, shown.body, ...shown.questionsToConsider),
    },
    output: { kind: 'question', text: AFTER_ANSWER, questionId: 'followup', answer: shown },
  };
}

/**
 * A path picked from the "where next?" block. Nothing is recorded as an entry:
 * picking a button is not something the person said.
 */
export async function takeChoice(
  s: ConvState, path: ChoicePath, deps: ConvDeps,
): Promise<{ state: ConvState; output: ConversationOutput }> {
  if (path === 'bible') return answerAboutThem(s, deps, BIBLE_ABOUT_ME, { bibleOfferAt: s.entries.length });
  if (path === 'thoughts') return answerAboutThem(s, deps, THOUGHTS_ABOUT_ME);
  const prior = s.said ?? [];
  const q = deps.live && s.entries.length > 0
    ? await generateFollowUp(deps.live, s.entries, prior, true).catch(() => null)
    : null;
  const text = q ?? DEEPER_FALLBACK;
  return {
    state: { ...s, bibleOffered: false, currentQuestionId: 'followup', said: remember(prior, text) },
    output: { kind: 'question', text, questionId: 'followup' },
  };
}

export async function takeConversationTurn(
  s: ConvState, text: string, deps: ConvDeps,
): Promise<{ state: ConvState; output: ConversationOutput }> {
  const phase = deps.phase ?? PHASE;
  const now = deps.now ?? new Date();
  const { tier } = concernTier(text);
  const live = deps.live;
  // Still close to a crisis? Then nothing generic: no bank question, no guess.
  const heavy = phase >= 2 && Boolean(s.heavyAt) && s.entries.length - (s.heavyAt as { at: number }).at < HEAVY_TURNS;
  const heavyLevel: 'acute' | 'elevated' | null = heavy ? (s.heavyAt as { level: 'acute' | 'elevated' }).level : null;
  // What the app itself has said lately, so it does not say it again.
  const prior = s.said ?? [];

  // The running count. Acute language never reaches it: that is takeTurn's path.
  const ev = phase >= 2 && tier !== 'acute'
    ? evaluateSupport(s.support, text, tier)
    : { next: s.support, showCard: false };
  const paused = phase >= 2 && Boolean(ev.next?.active);
  const checkin = ev.showCard ? SUPPORT_CHECKIN : SUPPORT_CONTINUE;

  // Typing "back to the questions" works like the button. Not recorded as an entry.
  if (phase >= 2 && tier === 'none' && wantsQuestionsBack(text) && (s.support?.active || s.entries.length > 0)) {
    return resumeQuestions(s, now);
  }

  // The app asked "Would it help to see what the Bible says?" in the chat.
  if (phase >= 2 && s.bibleOffered && (tier === 'none' || tier === 'mild')) {
    const t = text.trim();
    if (YES.test(t)) return answerAboutThem(s, deps, BIBLE_ABOUT_ME);
    if (NO.test(t)) {
      return {
        state: { ...s, bibleOffered: false },
        output: { kind: 'question', text: 'That\u2019s okay. We can keep going wherever you like.', questionId: 'followup' },
      };
    }
  }

  // "What is the point of you?" gets a plain, fixed answer. No model call.
  if (phase >= 2 && (tier === 'none' || tier === 'mild') && asksAboutApp(text)) {
    const asked = s.currentQuestionId;
    const hurtLately = heavy || [...s.entries, { text }].slice(-6).some((e) => isTender(e.text));
    const repeatable = !hurtLately && (!asked || asked === 'opening' || QUESTIONS.some((x) => x.id === asked));
    const q = currentQuestion(s);
    return {
      state: { ...s, support: ev.next, ...(repeatable || paused ? {} : { currentQuestionId: 'followup' }) },
      output: {
        kind: 'question',
        text: paused ? checkin : repeatable ? q.text : 'What would you like to bring to it?',
        questionId: paused ? 'support' : repeatable ? q.id : 'followup',
        reply: ABOUT_APP_REPLY,
      },
    };
  }

  // Faith Q&A. Not an answer to the bank, so it is not recorded as an entry and
  // does not advance the question gate. Acute and elevated skip it entirely.
  if (phase >= 2 && live && (tier === 'none' || tier === 'mild') && isAskingUs(text, s.entries.length > 0)) {
    let answer: FaithAnswer | null = null;
    let droppedWhy = 'no answer';
    try {
      const d = await generateAnswerDetailed(live, text, s.entries, prior);
      answer = d.answer;
      if (d.reason) droppedWhy = d.reason;
    } catch (e) {
      droppedWhy = `threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
      console.warn('[whyfinder] answer threw:', droppedWhy);
      answer = null;
    }
    if (answer && deps.scripture && answer.scripture.length > 0) {
      const passages = await fetchPassages(answer.scripture, deps.scripture).catch(() => []);
      if (passages.length > 0) answer = { ...answer, passages };
    }
    const q = currentQuestion(s);
    // Only repeat the question the person was last asked if it is a real bank
    // question or the opening. After a follow-up, a gentle line is better than
    // repeating "Tell me what has been on your mind lately."
    const asked = s.currentQuestionId;
    const hurtLately = heavy || [...s.entries, { text }].slice(-6).some((e) => isTender(e.text));
    const repeatable = !hurtLately && (!asked || asked === 'opening' || QUESTIONS.some((x) => x.id === asked));
    // A real answer already points to people. The stock mild line only stays if the answer failed.
    const care = ((ev.showCard || answer) && tier === 'mild' ? null : careFor(tier))
      ?? undefined;
    const shown = answer ?? { body: ANSWER_FALLBACK };
    return {
      state: {
        ...s, support: ev.next, ...(repeatable || paused ? {} : { currentQuestionId: 'followup' }),
        bibleOffered: false, bibleOfferAt: s.entries.length,
        said: remember(prior, shown.body, ...(answer?.questionsToConsider ?? []), ...(answer?.counsel ?? [])),
      },
      output: {
        kind: 'question',
        text: paused ? (ev.showCard || !answer ? checkin : AFTER_ANSWER) : repeatable ? q.text : AFTER_ANSWER,
        questionId: paused ? 'support' : repeatable ? q.id : 'followup',
        care,
        support: ev.showCard ? supportCard(tier) : undefined,
        answer: answer ?? { body: ANSWER_FALLBACK, kind: 'ai_inference', scripture: [], questionsToConsider: [], counsel: [], dropped: droppedWhy },
      },
    };
  }

  // Start the reply alongside the turn. It only needs what the person has said.
  const heard = [...s.entries, { text }];
  const replyP: Promise<string | null> =
    phase >= 2 && live && (tier === 'none' || tier === 'mild')
      ? generateReply(live, heard, prior).catch(() => null)
      : Promise.resolve(null);

  // A short follow-up about what they just said, every other turn, never when
  // they are struggling, giving a thin answer, or the pause is on.
  // Tenderness lingers: after something heavy, the next two turns stay gentle
  // too, even if the next message ("connected") has no distress words in it.
  const tenderNow = phase >= 2 && !paused && (tier === 'mild' || tier === 'elevated' || isTender(text));
  const tender = tenderNow || heavy || (phase >= 2 && !paused && (s.tenderLeft ?? 0) > 0);
  const tenderLeft = tenderNow ? 2 : Math.max(0, (s.tenderLeft ?? 0) - 1);
  // Someone who said something hurting in the last few messages is not handed a
  // stock bank question ("Walk me through yesterday"). The follow-up stays on them.
  const recentHurt = phase >= 2 && !paused && heard.slice(-6).some((e) => isTender(e.text));
  const followP: Promise<string | null> =
    phase >= 2 && live && (tier === 'none' || tier === 'mild') && !ev.showCard && !isThin(text)
      && (paused || tender || recentHurt || (s.followStreak ?? 0) < MAX_FOLLOW_STREAK)
      ? generateFollowUp(live, heard, prior).catch(() => null)
      : Promise.resolve(null);

  // No guess while the pause is on, after a thin answer, or before two real ones.
  const realAnswers = heard.filter((e) => !isThin(e.text)).length;
  const hold = phase >= 2 && (paused || tender || isThin(text) || realAnswers < 2 || tooSoonForGuess(s, heard.length));

  const before = s.synthesesOffered.length;
  const r = await takeTurn(s, text, {
    ...deps.turn,
    provider: hold ? NO_SYNTHESIS : deps.turn.provider,
  });
  let state = { ...r.state, experiments: s.experiments, support: ev.next, tenderLeft } as ConvState;
  let output: ConversationOutput = { ...r.output };

  // Remember the crisis, so the next few turns stay with the person.
  if (output.kind === 'acute') {
    // Meet them where they are: grief, home, loneliness. The safety parts never change.
    const count = (s.crisisCount ?? 0) + 1;
    const response = acuteResponse(crisisContext([...s.entries.map((e) => e.text), text]), count);
    return {
      state: { ...state, crisisCount: count, heavyAt: { at: s.entries.length, level: 'acute' }, said: remember(prior, response.namesConcern, response.faith) },
      output: { kind: 'acute', response },
    };
  }
  if (tier === 'elevated') {
    state = { ...state, heavyAt: { at: state.entries.length, level: heavyLevel === 'acute' ? 'acute' : 'elevated' } };
  }

  // The support pause. The bank does not advance; the entry is already recorded.
  let pausedFollow: string | null = null;
  if (paused) {
    state = {
      ...state,
      gate: { ...state.gate, heavyServedAt: s.gate.heavyServedAt },
      currentQuestionId: 'support',
    };
    // While paused, a real follow-up about what they just said beats the stock line.
    pausedFollow = ev.showCard ? null : await followP;
    output = { kind: 'question', text: pausedFollow ?? checkin, questionId: 'support' };
  }

  // The elevated line (it names 988) always stays. The card covers the mild one.
  const care = ev.showCard && tier === 'mild' ? null : careFor(tier);
  if (care) output.care = care;
  if (ev.showCard) output.support = supportCard(tier);

  const reply = await replyP;
  if (reply) output.reply = reply;
  // Paused with no follow-up: if the reply already asks something, that is the
  // question. Otherwise the stock line, but never the same one twice in a row.
  // Paused with a follow-up AND a reply that already asks: one question, not two.
  if (paused && pausedFollow && output.reply && output.reply.trim().endsWith('?')) {
    output = { ...output, text: output.reply };
    delete output.reply;
  }
  if (paused && !pausedFollow && !ev.showCard) {
    if (output.reply && output.reply.trim().endsWith('?')) {
      output = { ...output, text: output.reply };
      delete output.reply;
    } else {
      output = { ...output, text: continueLine(prior) };
    }
  }

  // The model is allowed to say "nothing has surfaced yet". That is honest, but
  // it is not a guess, so it never becomes a card with a "Keep this" button.
  let synthesis = (output as { synthesis?: Synthesis }).synthesis;
  if (synthesis && saysNothingYet(synthesis.body)) {
    delete (output as { synthesis?: Synthesis }).synthesis;
    state = { ...state, synthesesOffered: state.synthesesOffered.slice(0, -1) };
    synthesis = undefined;
  }

  // Stay with what they said. If the reply already asks something, that is the
  // question. Otherwise a follow-up asks. If they are hurting and there is
  // nothing good to ask, say so gently. None of these uses up a bank question:
  // the gate is put back, and the bank gets its turn on a later, lighter turn.
  if (synthesis && state.synthesesOffered.length > before) {
    state = { ...state, lastGuessAt: state.entries.length };
  }
  const followUp = await followP;
  const hasGuess = Boolean(synthesis);
  if (!paused && !hasGuess && output.kind === 'question') {
    const canFollow = tender || recentHurt || (s.followStreak ?? 0) < MAX_FOLLOW_STREAK;
    const replyAsks = Boolean(output.reply && output.reply.trim().endsWith('?'));
    let text: string | null = null;
    if (replyAsks && !canFollow) {
      // The bank gets this turn. Keep the reflection, drop its question, so
      // there is only one question on the screen.
      const kept = withoutQuestion(output.reply as string);
      if (kept) output.reply = kept; else delete output.reply;
    } else if (replyAsks) {
      text = output.reply as string;
      delete output.reply;
    } else if (followUp) {
      text = followUp;
    }
    if (text) {
      state = {
        ...state,
        gate: { ...state.gate, heavyServedAt: s.gate.heavyServedAt },
        currentQuestionId: 'followup',
        followStreak: (s.followStreak ?? 0) + 1,
      };
      output = { ...output, text, questionId: 'followup' };
    } else if (tender || recentHurt) {
      state = {
        ...state,
        gate: { ...state.gate, heavyServedAt: s.gate.heavyServedAt },
        currentQuestionId: 'tender',
        followStreak: 0,
      };
      output = { ...output, text: tenderLine(prior), questionId: 'tender' };
    } else {
      state = { ...state, followStreak: 0 };
    }
  } else {
    // A guess card already asks something. Keep the reflection, drop its question.
    if (hasGuess && output.reply && output.reply.trim().endsWith('?')) {
      const kept = withoutQuestion(output.reply);
      if (kept) output.reply = kept; else delete output.reply;
    }
    // The guess card ends with "Does that fit?". A stock question under it is a
    // second question, and it reads as not listening. The bank waits.
    if (hasGuess && !paused && output.kind === 'question') {
      state = { ...state, gate: { ...state.gate, heavyServedAt: s.gate.heavyServedAt }, currentQuestionId: 'guess' };
      output = { ...output, text: '' };
    }
    state = { ...state, followStreak: 0 };
  }

  // A real, specific reply beats the canned acknowledgement. The canned line
  // stays only when the model gave us nothing (and the support card, when shown,
  // already points to people).
  if (tier === 'mild' && (output.reply || pausedFollow || (output as { questionId?: string }).questionId === 'followup')) {
    delete output.care;
  }
  // After a crisis, if they move on, so does the app: no hotline reminders and no
  // mention of it. The "Need to talk to someone now" link is always at the top.

  // One experiment per session, after the first synthesis is shown, and never
  // to someone the support card has just been shown to.
  if (phase >= 3 && tier === 'none' && !tender && !recentHurt && !heavy && synthesis && state.synthesesOffered.length > before
      && !state.support?.shown && (state.experiments ?? []).length === 0) {
    const x: Experiment = pickExperiment(state.entries as Entry[]);
    const o = offer(state, x, now);
    state = o.state;
    output.experiment = { id: o.record.id, title: o.record.title, source: o.record.source };
  }
  // Where next? Every few messages, or sooner when answers get short, the person
  // picks the path. At a fitting moment, the app offers Scripture in the chat.
  let offered = false;
  if (phase >= 2 && !heavy && !paused && tier !== 'elevated' && output.kind === 'question'
      && !hasGuess && !output.experiment && state.entries.length >= 2) {
    const since = state.entries.length - (s.choicesAt ?? 0);
    const sinceBible = state.entries.length - (s.bibleOfferAt ?? -99);
    const recent = state.entries.slice(-2);
    const stalled = recent.length === 2
      && recent.every((e) => isThin(e.text) || e.text.trim().split(/\s+/).length <= 4);
    if (since >= 5 || (stalled && since >= 3)) {
      output.choices = true;
      state = { ...state, choicesAt: state.entries.length };
    } else if (sinceBible >= 4 && (FITTING_MOMENT.test(text) || tier === 'mild')) {
      if (output.reply && output.reply.trim().endsWith('?')) {
        const kept = withoutQuestion(output.reply);
        if (kept) output.reply = kept; else delete output.reply;
      }
      output = { ...output, text: BIBLE_OFFERS[state.entries.length % BIBLE_OFFERS.length] };
      state = { ...state, bibleOfferAt: state.entries.length };
      offered = true;
    }
  }
  state = { ...state, bibleOffered: offered, said: remember(prior, output.reply, (output as { text?: string }).text) };
  return { state, output };
}