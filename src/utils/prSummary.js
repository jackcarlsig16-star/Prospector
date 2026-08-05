import { MODELS } from '../config/models';

const SUMMARIES_KEY = 'prospector_pr_summaries';
const THREAD_CACHE_KEY = 'prospector_threads_cache';
const DELAY_MS = 300;
const MAX_TOKENS = 80;

const extractDomain = (web) => {
  const raw = (web || '').toLowerCase().trim();
  if (!raw) return null;
  return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0] || null;
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const stripWrap = (s) => (s || '')
  .trim()
  .replace(/^["'`]+/, '')
  .replace(/["'`]+$/, '')
  .trim();

const readSummaries = () => {
  try { return JSON.parse(localStorage.getItem(SUMMARIES_KEY) || '{}'); } catch { return {}; }
};
const writeSummaries = (s) => {
  try { localStorage.setItem(SUMMARIES_KEY, JSON.stringify(s)); } catch {}
};

const readThreadCache = () => {
  try { return JSON.parse(localStorage.getItem(THREAD_CACHE_KEY) || '{}'); } catch { return {}; }
};

const gatherContext = (acc, complianceMap, threadCache, prNotes) => {
  const domain = extractDomain(acc.web);
  const thread = domain ? threadCache[domain] : null;

  const calls = (acc.calls || []).filter(c => c && c.date);
  const latestCall = calls.sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

  const comp = complianceMap[acc.id] || null;
  const compSteps = comp?.steps || [];
  const gamingSteps = comp?.gaming?.steps || [];
  const blocked = [...compSteps, ...gamingSteps]
    .filter(s => s.status === 'Blocked')
    .map(s => s.id);

  const prStep = compSteps.find(s => s.id === 'prod_request');
  const rfiNote = prStep?.notes ? String(prStep.notes).trim() : null;

  const manualNote = prNotes[acc.id] ? String(prNotes[acc.id]).trim() : null;

  return { thread, latestCall, blocked, rfiNote, manualNote };
};

const hasAnyContext = (ctx) =>
  ctx.blocked.length > 0 ||
  !!ctx.rfiNote ||
  !!ctx.manualNote ||
  !!ctx.latestCall?.summary ||
  !!(ctx.thread && (ctx.thread.sentiment !== 'unknown' || (ctx.thread.signals || []).length));

const buildPrompt = (acc, ctx) => {
  const callSummary = ctx.latestCall?.summary
    ? String(ctx.latestCall.summary).slice(0, 200)
    : 'none';
  return `You are a sales assistant. In one sentence (max 20 words), surface the most important blocker or status for this production request. Be specific. If nothing is blocking, say so briefly.

Account: ${acc.name}
PR steps blocked: ${ctx.blocked.join(', ') || 'none'}
SFDC RFI note: ${ctx.rfiNote || 'none'}
Gmail sentiment: ${ctx.thread?.sentiment || 'unknown'}
Gmail signals: ${(ctx.thread?.signals || []).join(', ') || 'none'}
Latest call summary: ${callSummary}
Manual note: ${ctx.manualNote || 'none'}

Respond with one sentence only. No preamble.`;
};

const callClaude = async (prompt) => {
  const res = await fetch('/proxy/anthropic/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.FAST,
      max_tokens: MAX_TOKENS,
      system: 'You produce one-sentence sales summaries. No preamble, no quotation marks.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`proxy ${res.status}`);
  const data = await res.json();
  return stripWrap(data?.content?.[0]?.text || '');
};

export async function generatePRSummaries(accounts, complianceMap) {
  if (!accounts?.length || !complianceMap || !Object.keys(complianceMap).length) return;

  const summaries = readSummaries();
  const prNotes = {};
  const threadCache = readThreadCache();

  const queue = accounts.filter(a => a && a.id != null && complianceMap[a.id]);

  for (const acc of queue) {
    const ctx = gatherContext(acc, complianceMap, threadCache, prNotes);
    if (!hasAnyContext(ctx)) continue;

    try {
      const prompt = buildPrompt(acc, ctx);
      const text = await callClaude(prompt);
      if (text) {
        summaries[acc.id] = { text, generatedAt: new Date().toISOString() };
        writeSummaries(summaries);
        try { window.dispatchEvent(new CustomEvent('prospector:pr_summaries_updated')); } catch {}
      }
    } catch (e) {
      console.warn('[prSummary] failed for', acc.name, e?.message || e);
    }
    await sleep(DELAY_MS);
  }
}
