import { getACV } from './ledgerEngine';
import { inferCloseProbability } from './scoringEngine';
import { daysSinceIso } from './dates';

const fmtAcv = v => v == null ? '—' : `$${Math.round(Number(v)).toLocaleString()}`;
const fmtDate = iso => { if (!iso) return '—'; try { const d = new Date(iso); return `${d.getMonth()+1}/${d.getDate()}`; } catch { return '—'; } };
const trunc = (s, n) => !s ? '' : s.length > n ? s.slice(0, n) + '…' : s;

function getCompliance(accId) {
  try {
    const all = JSON.parse(localStorage.getItem('prospector_compliance') || '{}');
    return all[accId] || null;
  } catch { return null; }
}

function fmtCompliance(comp) {
  if (!comp) return 'Not started';
  const steps = comp.steps || [];
  const parts = steps.map(s => {
    const label = s.id === 'prod_request' ? 'PR' : s.id === 'security_q' ? 'SecQ' : s.id === 'live' ? 'Live' : s.id;
    return `${label}:${s.status}`;
  });
  return parts.join(' | ') || 'Not started';
}

function getLastTouch(acc) {
  const days = daysSinceIso(acc.last);
  return days === null ? null : `${days}d ago`;
}

function getLastCallSummary(acc) {
  const calls = acc.calls || [];
  if (!calls.length) return null;
  const last = [...calls].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  return trunc(last.summary || last.notes || '', 200);
}

function getBlockers(acc) {
  const calls = acc.calls || [];
  if (!calls.length) return [];
  const last = [...calls].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  return (last.blockers || []).map(b => typeof b === 'string' ? b : b.text).filter(Boolean).slice(0, 3);
}

function extractDomain(acc) {
  const raw = (acc.web || '').toLowerCase().trim();
  if (!raw) return null;
  return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0] || null;
}

function readThreadCache() {
  try { return JSON.parse(localStorage.getItem('prospector_threads_cache') || '{}'); } catch { return {}; }
}

export function buildScoutContext(accounts, aeMap = {}) {
  const lines = [];
  const threadCache = readThreadCache();
  for (const acc of accounts) {
    const acv    = getACV(acc);
    const prob   = inferCloseProbability(acc);
    const comp   = getCompliance(acc.id);
    const touch  = getLastTouch(acc);
    const summary = getLastCallSummary(acc);
    const blockers = getBlockers(acc);
    const prStatus = comp?.steps?.find(s => s.id === 'prod_request')?.status || 'Not Started';
    const domain = extractDomain(acc);
    const thread = domain ? threadCache[domain] : null;

    lines.push(`### ${acc.name}`);
    lines.push(`Stage: ${acc.stage || '—'} | Tier: ${acc.tier || '—'} | ACV: ${fmtAcv(acv)} | Close: ${fmtDate(acc.closeDate)} | Close%: ${prob}%`);
    const loc = [acc.city, acc.state].filter(Boolean).join(', ');
    if (loc) lines.push(`Location: ${loc}`);
    const aeName = acc.aeId ? aeMap[acc.aeId] : null;
    if (aeName) lines.push(`AE: ${aeName}`);
    lines.push(`Forecast: ${acc.forecastCategory || 'auto'} | Health: ${acc.healthScore || '?'}/10 | Last touch: ${touch || '—'}`);
    lines.push(`Compliance: ${fmtCompliance(comp)} | PR: ${prStatus}`);
    if (acc.pathToClose) lines.push(`Path: ${trunc(acc.pathToClose, 200)}`);
    if (summary)         lines.push(`Last call: ${summary}`);
    if (blockers.length) lines.push(`Blockers: ${blockers.join(' | ')}`);
    if (acc.scoutNote)   lines.push(`Note: ${trunc(acc.scoutNote, 300)}`);
    if (thread) {
      lines.push(`Recent email sentiment: ${thread.sentiment}`);
      if (thread.signals?.length) lines.push(`Key signals: ${thread.signals.join(' · ')}`);
      lines.push(`Last contact: ${thread.last_contact_direction}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
