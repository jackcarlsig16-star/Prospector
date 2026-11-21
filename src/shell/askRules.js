// app-shell-v2 Q6 / Q7 - the two rules of the header's one field, pure (the browser and the server tests read this file).
// Q6: what the field holds is a QUESTION (Ask Scout is the default row, so Enter asks) when it ends with "?", starts
// with a question word, starts with a verb Scout knows, or runs to five or more words. Anything else is a search, with
// Ask Scout as the last row.
export const QUESTION_WORDS = ['who', 'what', 'which', 'how', 'when', 'where', 'why', 'should', 'can', 'do', 'does', 'is', 'are', 'did', 'will'];
export const SCOUT_VERBS = ['draft', 'write', 'assign', 'snooze', 'mark', 'add', 'show', 'pull', 'find', 'review', 'prep', "what's"];
const firstWord = text => (text.split(/\s+/)[0] || '').toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z']/g, '');

export function isQuestion(input) {
  const text = String(input || '').trim();
  if (!text) return false;
  if (text.endsWith('?')) return true;
  const first = firstWord(text);
  if (QUESTION_WORDS.includes(first) || SCOUT_VERBS.includes(first) || first === 'whats') return true;
  return text.split(/\s+/).length >= 5;
}

// Q7: an answer stays in the panel when it is a brief of one record or one sentence / number with no rows - the ask
// route came back with 0 sections, or 1 section holding at most 1 row. A list, a confirm card, a draft or a follow-up
// opens the Scout page with the thread carried.
export function staysInPanel(answer) {
  if (!answer || answer.offer || answer.plan || answer.draft || answer.resolved) return false;
  const sections = answer.sections || [];
  if (sections.length === 0) return true;
  return sections.length === 1 && (sections[0].rows || []).length <= 1;
}
