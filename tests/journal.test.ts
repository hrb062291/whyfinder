import { describe, expect, it } from 'vitest';
import { journalRequest } from '../src/engine/journalRequest.js';

describe('journalRequest', () => {
  it.each([
    'add this to my journal',
    'Add this to my journal.',
    'please save this to my journal',
    'can you add that to my journal',
    'put it in my journal',
    'journal this',
    'save this',
    'remember this',
    'This is important to me',
    'that is really important to me.',
    'add this',
  ])('"%s" keeps what they said before', (t) => {
    expect(journalRequest(t)).toEqual({ content: null });
  });

  it('keeps the words that follow the command', () => {
    expect(journalRequest('add to my journal: I want to call my sister more')).toEqual({ content: 'I want to call my sister more' });
    expect(journalRequest('save this to my journal - God is near the brokenhearted')).toEqual({ content: 'God is near the brokenhearted' });
    expect(journalRequest('remember this: rest is not laziness')).toEqual({ content: 'rest is not laziness' });
  });

  it('keeps the sentences before a trailing command', () => {
    expect(journalRequest('I miss my dad. Add this to my journal.')).toEqual({ content: 'I miss my dad.' });
    expect(journalRequest('Psalm 34:18 gives me comfort. This is important to me.')).toEqual({ content: 'Psalm 34:18 gives me comfort.' });
  });

  it.each([
    'my family is important to me',
    'This is important to me because my mom is sick',
    'I keep a journal at home',
    'I used to save money for a trip',
    'remember that time we went camping',
    'what does god say about loneliness',
    'I want to add this class to my schedule',
  ])('"%s" is not a save request', (t) => {
    expect(journalRequest(t)).toBeNull();
  });
});