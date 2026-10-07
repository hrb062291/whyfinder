/**
 * Phase flag. Features arrive in steps so the first session stays simple.
 *
 *   1  Questions and syntheses only (the original app).
 *   2  + a short reply to what the person said, and faith Q&A framed as discernment.
 *   3  + one small experiment after the first synthesis, with a quick reflect step.
 *
 * Set WHYFINDER_PHASE in .env.local to step down. Default is the full set.
 */
export const PHASE = Number(process.env.WHYFINDER_PHASE ?? 3);
