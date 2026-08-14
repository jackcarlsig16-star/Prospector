import { useState, useEffect, useMemo } from 'react';
import { mono } from '../constants/colors';
import { T } from '../constants/tokens';
import { MODELS } from '../config/models';

const FORECAST_COLOR = { 'Commit': '#22c55e', 'Best Case': '#f59e0b', 'Pipeline': '#3b82f6', 'Omit': '#555' };

const fmtAcvK = (v) => v == null ? '—' : `$${Math.round(Number(v) / 1000)}k`;
const fmtMonDay = (d) => {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const trunc = (s, n) => !s ? '—' : (s.length > n ? s.slice(0, n) + '…' : s);

const firstBlocker = (acc) => {
  const last = (acc.calls || [])[acc.calls?.length - 1];
  const b = last?.blockers?.[0];
  if (!b) return null;
  return typeof b === 'string' ? b : (b.text || null);
};

const earliestOpenTask = (acc, tasks) =>
  tasks
    .filter(t => t.accId === acc.id && t.owner === 'AE' && t.status !== 'Done')
    .sort((x, y) => (x.dueDate || 'zzzz').localeCompare(y.dueDate || 'zzzz'))[0] || null;

export default function PipelineReviewModal({ rows = [], tasks = [], onClose }) {
  const [selected, setSelected] = useState(() => new Set(
    rows.filter(r => r.effectiveForecastCat === 'Commit' || r.effectiveForecastCat === 'Best Case').map(r => r.acc.id)
  ));
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [summary, setSummary] = useState(null);
  // Per-account modal-local gap-fills, written by the inline ⚡ Generate
  // button. Not persisted to acc — re-opening the modal recomputes from
  // whatever is on the account at that moment.
  const [generated, setGenerated] = useState({}); // { [accId]: { description, blocker, strategy } }
  const [generatingIds, setGeneratingIds] = useState(new Set());

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selectedRows = useMemo(() => rows.filter(r => selected.has(r.acc.id)), [rows, selected]);

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectAll = () => setSelected(new Set(rows.map(r => r.acc.id)));
  const clearAll = () => setSelected(new Set());

  // Build per-row derivations once for both copy + table render.
  // Existing data first, modal-local generated data as fallback, '—' if both empty.
  const decorated = useMemo(() => selectedRows.map(r => {
    const acc = r.acc;
    const gen = generated[acc.id] || {};
    const description = acc.blurb || (acc.pf ? acc.pf.slice(0, 120) : null) || gen.description || null;
    const products    = (acc.prods || []).slice(0, 3).join(', ') || null;
    const blocker     = firstBlocker(acc) || gen.blocker || null;
    const strategy    = acc.pathToClose || gen.strategy || null;
    const next        = earliestOpenTask(acc, tasks);
    const nextStr     = next
      ? `${next.title}${next.dueDate ? ` · ${fmtMonDay(next.dueDate)}` : ''}`
      : '—';
    const needsGen    = !description && !blocker && !strategy;
    return {
      ...r,
      _description: description || '—',
      _products:    products    || '—',
      _blocker:     blocker     || '—',
      _nextStr:     nextStr,
      _strategy:    strategy    || '—',
      _needsGen:    needsGen,
    };
  }), [selectedRows, tasks, generated]);

  const copyTsv = () => {
    const header = ['Account', 'Forecast', 'ACV', 'Description', 'Products', 'Primary Blocker', 'Next Step + Date', 'Close Strategy'].join('\t');
    const lines = decorated.map(r => [
      r.acc.name,
      r.effectiveForecastCat,
      fmtAcvK(r.acv),
      r._description,
      r._products,
      r._blocker,
      r._nextStr,
      r._strategy,
    ].map(c => String(c).replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t'));
    let tsv = [header, ...lines].join('\n');
    if (summary) tsv += `\n\nSummary:\n${summary}`;
    try { navigator.clipboard.writeText(tsv); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const generateGapsForAccount = async (acc) => {
    setGeneratingIds(prev => { const n = new Set(prev); n.add(acc.id); return n; });
    const recentCalls = (acc.calls || []).slice(-2).map(c => c.summary || c.notes || '').filter(Boolean).join(' | ');
    const prompt = `You are a sales analyst. For this deal, write three short fields. Use only the context provided — be concrete, no fluff.

Account: ${acc.name}
Vertical: ${acc.vert || 'unknown'}
Business model: ${acc.bm || 'unknown'}
Stage: ${acc.stage || 'unknown'}
Products: ${(acc.prods || []).join(', ') || 'none'}
Recent calls: ${recentCalls || 'none'}

Return ONLY a JSON object, no preamble, no markdown:
{
  "description": "1-2 sentences describing what the company does (max 120 chars)",
  "blocker":     "most likely blocker stopping this deal (max 100 chars)",
  "strategy":    "one-sentence path to close (max 100 chars)"
}`;
    try {
      const res = await fetch('/proxy/anthropic/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODELS.FAST,
          max_tokens: 150,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.content?.[0]?.text || '';
        const cleaned = text.replace(/```json\n?/g, '').replace(/```/g, '').trim();
        const match = cleaned.match(/\{[\s\S]+\}/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            setGenerated(prev => ({ ...prev, [acc.id]: parsed }));
          } catch {}
        }
      }
    } catch {}
    setGeneratingIds(prev => { const n = new Set(prev); n.delete(acc.id); return n; });
  };

  const generateSummary = async () => {
    if (!decorated.length) return;
    setGenerating(true);
    setSummary(null);
    const pipelineLines = decorated.map(r =>
      `${r.acc.name}: ${r.effectiveForecastCat}, ${fmtAcvK(r.acv)} ACV, next step: ${r._nextStr}, blocker: ${r._blocker}`
    ).join('\n');
    const prompt = `You are a sales AE. Write a 3-5 sentence pipeline summary for a Friday manager review. Be direct and specific. Cover: total weighted pipeline, deals most likely to close, key blockers, and what needs to happen this week.

Pipeline data:
${pipelineLines}`;
    try {
      const res = await fetch('/proxy/anthropic/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODELS.STANDARD,
          max_tokens: 800,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.content?.[0]?.text || '';
        setSummary(text.trim() || null);
      }
    } catch {}
    setGenerating(false);
  };

  const COL = (w) => ({ width: w, minWidth: w, maxWidth: w, padding: '6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '90vw', height: '85vh',
        background: T.bg.card, border: `1px solid ${T.border.subtle}`,
        borderRadius: 10, display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid ${T.border.subtle}`, flexShrink: 0 }}>
          <div>
            <p style={{ ...mono, margin: '0 0 2px', fontSize: 10, color: T.text.dim, textTransform: 'uppercase', letterSpacing: '0.1em' }}>📋 Pipeline Review</p>
            <p style={{ margin: 0, fontSize: 16, color: T.text.primary }}>
              {selected.size} account{selected.size === 1 ? '' : 's'} selected
            </p>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: T.text.dim, fontSize: 20, cursor: 'pointer', padding: '0 6px' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left: account checklist */}
          <div style={{ width: 260, flexShrink: 0, borderRight: `1px solid ${T.border.subtle}`, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderBottom: `1px solid ${T.border.subtle}` }}>
              <button onClick={selectAll} style={{ ...mono, fontSize: 10, padding: '3px 8px', background: 'transparent', border: `1px solid ${T.border.muted}`, color: T.text.muted, borderRadius: 3, cursor: 'pointer' }}>Select all</button>
              <button onClick={clearAll} style={{ ...mono, fontSize: 10, padding: '3px 8px', background: 'transparent', border: `1px solid ${T.border.muted}`, color: T.text.muted, borderRadius: 3, cursor: 'pointer' }}>Clear</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {rows.map(r => {
                const on = selected.has(r.acc.id);
                const fc = FORECAST_COLOR[r.effectiveForecastCat] || T.text.muted;
                return (
                  <label key={r.acc.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 12px', cursor: 'pointer',
                    background: on ? `${T.neon}08` : 'transparent',
                    borderBottom: `1px solid ${T.border.dim}`,
                  }}>
                    <input type="checkbox" checked={on} onChange={() => toggle(r.acc.id)} style={{ cursor: 'pointer', accentColor: T.neon }} />
                    <span style={{ ...mono, fontSize: 11, color: T.text.primary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.acc.name}</span>
                    <span style={{ ...mono, fontSize: 9, color: fc, flexShrink: 0 }}>{r.effectiveForecastCat[0]}</span>
                    <span style={{ ...mono, fontSize: 10, color: T.text.dim, flexShrink: 0 }}>{fmtAcvK(r.acv)}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Right: preview + actions */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
              {decorated.length === 0 ? (
                <p style={{ ...mono, fontSize: 12, color: T.text.dim, textAlign: 'center', padding: 32 }}>No accounts selected.</p>
              ) : (
                <table style={{ borderCollapse: 'collapse', ...mono, fontSize: 11, width: '100%', tableLayout: 'fixed' }}>
                  <thead>
                    <tr style={{ color: T.text.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      <th style={{ ...COL(140), textAlign: 'left' }}>Account</th>
                      <th style={{ ...COL(72), textAlign: 'left' }}>Forecast</th>
                      <th style={{ ...COL(60), textAlign: 'right' }}>ACV</th>
                      <th style={{ ...COL(200), textAlign: 'left' }}>Description</th>
                      <th style={{ ...COL(120), textAlign: 'left' }}>Products</th>
                      <th style={{ ...COL(160), textAlign: 'left' }}>Primary Blocker</th>
                      <th style={{ ...COL(180), textAlign: 'left' }}>Next Step + Date</th>
                      <th style={{ ...COL(200), textAlign: 'left' }}>Close Strategy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decorated.map(r => {
                      const fc = FORECAST_COLOR[r.effectiveForecastCat] || T.text.muted;
                      const isGenerating = generatingIds.has(r.acc.id);
                      return (
                        <tr key={r.acc.id} style={{ borderTop: `1px solid ${T.border.subtle}`, color: T.text.primary }}>
                          <td style={COL(140)} title={r.acc.name}>
                            {r.acc.name}
                            {r._needsGen && (
                              <button onClick={() => generateGapsForAccount(r.acc)} disabled={isGenerating}
                                title="Generate Description, Blocker, and Strategy via Claude"
                                style={{ ...mono, marginLeft: 6, fontSize: 9, padding: '1px 6px', background: isGenerating ? 'transparent' : `${T.amber}14`, border: `1px solid ${isGenerating ? T.border.muted : `${T.amber}55`}`, color: isGenerating ? T.text.dim : T.amber, borderRadius: 3, cursor: isGenerating ? 'wait' : 'pointer' }}>
                                {isGenerating ? '⟳' : '⚡ Gen'}
                              </button>
                            )}
                          </td>
                          <td style={{ ...COL(72), color: fc }}>{r.effectiveForecastCat}</td>
                          <td style={{ ...COL(60), textAlign: 'right' }}>{fmtAcvK(r.acv)}</td>
                          <td style={{ ...COL(200), color: T.text.muted }} title={r._description}>{trunc(r._description, 120)}</td>
                          <td style={{ ...COL(120), color: T.text.muted }} title={r._products}>{r._products}</td>
                          <td style={{ ...COL(160), color: r._blocker === '—' ? T.text.dim : '#f97316' }} title={r._blocker}>{r._blocker}</td>
                          <td style={COL(180)} title={r._nextStr}>{r._nextStr}</td>
                          <td style={{ ...COL(200), color: T.text.muted }} title={r._strategy}>{trunc(r._strategy, 80)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {summary && (
                <div style={{ marginTop: 16, padding: '12px 14px', background: T.bg.surface, border: `1px solid ${T.border.subtle}`, borderRadius: 6 }}>
                  <p style={{ ...mono, margin: '0 0 6px', fontSize: 9, color: T.text.dim, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Summary</p>
                  <p style={{ margin: 0, fontSize: 12, color: T.text.primary, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{summary}</p>
                </div>
              )}
            </div>

            {/* Action bar */}
            <div style={{ display: 'flex', gap: 8, padding: '10px 16px', borderTop: `1px solid ${T.border.subtle}`, flexShrink: 0, alignItems: 'center' }}>
              <button onClick={copyTsv} disabled={!decorated.length} style={{ ...mono, fontSize: 11, padding: '6px 14px', background: copied ? '#22c55e18' : (decorated.length ? `${T.neon}14` : 'transparent'), border: `1px solid ${copied ? '#22c55e55' : (decorated.length ? T.neon : T.border.muted)}`, color: copied ? '#22c55e' : (decorated.length ? T.neon : T.text.dim), borderRadius: 4, cursor: decorated.length ? 'pointer' : 'not-allowed', fontWeight: 500 }}>
                {copied ? '✓ Copied!' : 'Copy as spreadsheet'}
              </button>
              <button onClick={generateSummary} disabled={!decorated.length || generating} style={{ ...mono, fontSize: 11, padding: '6px 14px', background: 'transparent', border: `1px solid ${decorated.length && !generating ? `${T.cyan}55` : T.border.muted}`, color: decorated.length && !generating ? T.cyan : T.text.dim, borderRadius: 4, cursor: decorated.length && !generating ? 'pointer' : 'not-allowed' }}>
                {generating ? '⟳ Generating…' : (summary ? '↺ Regenerate summary' : '✦ Generate summary')}
              </button>
              <div style={{ flex: 1 }} />
              <button onClick={onClose} style={{ ...mono, fontSize: 11, padding: '6px 14px', background: 'transparent', border: `1px solid ${T.border.muted}`, color: T.text.muted, borderRadius: 4, cursor: 'pointer' }}>✕ Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
