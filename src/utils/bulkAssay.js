// Background bulk-assay runner. Singleton in-memory + prospector_assay_progress
// localStorage cooperatively shared with AccountsPage's user-triggered bulk loop.
// Emits `prospector_assay_updated` window events so the AssayBanner stays live.

import { clientAssay, getActiveIntel, getActiveExamples, preserveManualEdits } from './assay';

const PROGRESS_KEY = 'prospector_assay_progress';
const EVENT_NAME = 'prospector_assay_updated';
const BATCH_SAVE_EVERY = 10;
const PER_ACCOUNT_DELAY_MS = 1500;

let runner = null;

export function isBulkAssayRunning() { return !!runner; }

export function loadAssayProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null'); } catch { return null; }
}

function writeProgress(state) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...state, savedAt: Date.now() })); } catch {}
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: state }));
}

export async function startBulkAssay({ accounts, onSaveAccounts }) {
  if (runner) return false;
  if (!accounts?.length || !onSaveAccounts) return false;
  // Don't double-up with an in-flight run from AccountsPage (different code path,
  // same progress key). If a recent progress entry exists and isn't marked done, skip.
  const existing = loadAssayProgress();
  if (existing && !existing.done && Date.now() - (existing.savedAt || 0) < 60_000) return false;

  runner = { cancelled: false };

  const queue = accounts.filter(a => !a.score && !a.assay_failed && a.web);
  const total = queue.length;
  if (!total) { runner = null; return false; }

  const customIntel  = getActiveIntel();
  const exampleAccts = getActiveExamples();
  let completed = 0;
  let current = [...accounts];

  writeProgress({ completed, total, source: 'background', name: queue[0]?.name || '' });

  for (const acc of queue) {
    if (runner.cancelled) break;
    try {
      // account-taxonomy-and-creation-upgrade-v1 Stage 7 - per-account
      // combine, same reasoning as AccountsPage.js's assayOneWithRetry:
      // customIntel is the shared global library for this whole background
      // run, combined per-account here rather than shared across accounts.
      const combinedIntel = [acc.handoffNotes, customIntel].filter(Boolean).join('\n\n---\n\n');
      const parsed = await clientAssay({
        name: acc.name, web: acc.web, vert: acc.vert,
        customIntel: combinedIntel, exampleAccts, stage: acc.stage || 'Prospecting',
        relationshipType: acc.relationshipType,
      });
      // accounts-reassay-fallback-precision-v1's pattern, applied here too:
      // clientAssay() throws on failure, so reaching this line means `parsed`
      // is the real answer. The old `parsed.x?.length ? parsed.x : (a.x||[])`
      // shape could not tell a correct empty result from a failed call, so it
      // only ever restored stale values. The catch below is the failure path.
      current = current.map(a => a.id === acc.id ? {
        ...a, ...preserveManualEdits(a, parsed),
        sigs:  parsed.keySignals || [],
        ucs:   parsed.useCases   || [],
        prods: [...new Set(parsed.products || [])],
        bm:    parsed.businessModel || '',
        pf:    parsed.productFit || '',
        dis:   parsed.disqualifier !== undefined ? parsed.disqualifier : a.dis,
        linkedin: parsed.linkedin || a.linkedin || '',
        analyzed: true,
      } : a);
    } catch {
      current = current.map(a => a.id === acc.id ? { ...a, assay_failed: true } : a);
    }
    completed++;
    writeProgress({ completed, total, source: 'background', name: queue[Math.min(completed, queue.length-1)]?.name || '' });
    if (completed % BATCH_SAVE_EVERY === 0 || completed === total) {
      try { onSaveAccounts([...current]); } catch {}
    }
    if (completed < total) await new Promise(r => setTimeout(r, PER_ACCOUNT_DELAY_MS));
  }

  try { onSaveAccounts([...current]); } catch {}
  writeProgress({ completed, total, source: 'background', done: true });
  runner = null;
  return true;
}
