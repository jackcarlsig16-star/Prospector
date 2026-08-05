import { useState, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import { MODELS } from '../config/models';
import { WIN_REASONS, saveWinReason } from '../utils/winReasons';

const SYSTEM = `You are a sales analyst. Based on this deal suggest the top 3 win reasons from the list and write a 2-3 sentence win detail.
Return JSON only: { "top3": ["reason1", "reason2", "reason3"], "detail": "freeform summary" }
Reasons must be exact strings from the list. No preamble.`;

function readThreadCache() {
  try { return JSON.parse(localStorage.getItem('prospector_threads_cache') || '{}'); } catch { return {}; }
}

function extractDomain(acc) {
  const raw = (acc?.web || '').toLowerCase().trim();
  if (!raw) return null;
  return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0] || null;
}

function buildUserPrompt(acc) {
  const domain = extractDomain(acc);
  const threadEntry = domain ? readThreadCache()[domain] : null;
  const calls = (acc.calls || []).map(c => c.summary).filter(Boolean).slice(0, 4).join(' | ');
  const nextSteps = (acc.calls || []).flatMap(c => (c.nextSteps || []).map(ns => typeof ns === 'string' ? ns : ns?.text || '')).filter(Boolean).slice(0, 4).join(' | ');
  const medpicc = acc.medpicc ? Object.entries(acc.medpicc).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' | ') : '';
  return `Account: ${acc.name}
Products: ${(acc.prods || acc.products || []).join(', ') || 'unknown'}
Notes: ${(acc.notes || acc.scoutNote || '').slice(0, 400)}
Next steps history: ${nextSteps || 'none'}
MEDPICC: ${medpicc || 'none'}
Call summaries: ${calls || 'none'}
Thread signals: ${threadEntry?.signals?.join(', ') || 'none'}
ACV: ${acc.acv || '—'}

Win reason options:
${WIN_REASONS.join('\n')}`;
}

async function generateSuggestion(acc) {
  const res = await fetch('/proxy/anthropic/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.STANDARD,
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildUserPrompt(acc) }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const top3 = (parsed.top3 || []).filter(r => WIN_REASONS.includes(r)).slice(0, 3);
    return { top3, detail: parsed.detail || '' };
  } catch { return null; }
}

async function pushToSfdc(acc, top3, detail, otherDetail) {
  const accessToken = localStorage.getItem('sfdc_access_token');
  const instanceUrl = localStorage.getItem('sfdc_instance_url');
  if (!accessToken || !instanceUrl) throw new Error('Not connected to Salesforce');
  if (!acc.sfdcOppId && !acc.sfdc) throw new Error('No SFDC Opportunity ID on this account');
  const oppId = acc.sfdcOppId || acc.sfdc;
  const reasonsValue = top3.map(r => r === 'Other' && otherDetail ? `Other: ${otherDetail}` : r).join(';');
  const fields = { Win_Reasons__c: reasonsValue, Win_Detail__c: detail };
  const r = await fetch('/api/sfdc/update-opp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, instanceUrl, oppId, fields }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `SFDC ${r.status}`);
  }
}

export default function WinReasonPanel({ acc, initial=null, onSaved, embedded=false }) {
  const [loading,     setLoading]     = useState(!initial);
  const [selected,    setSelected]    = useState(initial?.top3 || []);
  const [otherDetail, setOtherDetail] = useState(initial?.otherDetail || '');
  const [detail,      setDetail]      = useState(initial?.detail || '');
  const [savingLocal, setSavingLocal] = useState(false);
  const [savingSfdc,  setSavingSfdc]  = useState(false);
  const [toast,       setToast]       = useState(null);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    (async () => {
      const result = await generateSuggestion(acc);
      if (cancelled) return;
      if (result) {
        setSelected(result.top3);
        setDetail(result.detail);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [acc, initial]);

  const showToast = (msg, color = C.green) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 2500);
  };

  const toggle = reason => {
    setSelected(prev => {
      if (prev.includes(reason)) return prev.filter(r => r !== reason);
      if (prev.length >= 3) return [...prev.slice(1), reason];
      return [...prev, reason];
    });
  };

  const payload = () => ({
    top3: selected,
    detail,
    ...(selected.includes('Other') ? { otherDetail } : {}),
  });

  const handleSaveLocal = () => {
    setSavingLocal(true);
    saveWinReason(acc.id, payload());
    setSavingLocal(false);
    showToast('Saved locally ✓', C.green);
    onSaved?.(payload());
  };

  const handleSaveSfdc = async () => {
    setSavingSfdc(true);
    try {
      await pushToSfdc(acc, selected, detail, otherDetail);
      saveWinReason(acc.id, payload());
      showToast('Saved to Salesforce ✓', C.green);
      onSaved?.(payload());
    } catch (err) {
      saveWinReason(acc.id, payload());
      showToast(`SFDC sync failed — saved locally instead (${err.message.slice(0, 60)})`, C.orange);
      onSaved?.(payload());
    } finally {
      setSavingSfdc(false);
    }
  };

  return (
    <div style={{ marginTop: embedded ? 16 : 0, paddingTop: embedded ? 16 : 0, borderTop: embedded ? `1px solid ${C.brd}` : 'none' }}>
      <p style={{ ...mono, margin: '0 0 12px', fontSize: 11, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
        ◆ Win Reason {loading && <span style={{ color: C.purple, fontWeight: 400, marginLeft: 8 }}>analyzing deal…</span>}
      </p>

      {/* Checkboxes */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {WIN_REASONS.map(r => {
          const on = selected.includes(r);
          return (
            <button key={r} onClick={() => toggle(r)} disabled={loading}
              style={{ ...mono, fontSize: 11, padding: '4px 10px', borderRadius: 4,
                background: on ? `${C.gold}18` : 'transparent',
                border: `1px solid ${on ? C.gold : C.brd}`,
                color: on ? C.gold : (loading ? C.dim : C.mut),
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading ? 0.5 : 1 }}>
              {on ? '✓ ' : ''}{r}
            </button>
          );
        })}
      </div>
      <p style={{ ...mono, margin: '0 0 12px', fontSize: 10, color: C.dim }}>
        Max 3 — checking a 4th replaces the oldest · {selected.length}/3 selected
      </p>

      {/* Other → free text */}
      {selected.includes('Other') && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ ...mono, margin: '0 0 4px', fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Specify "Other"</p>
          <input
            value={otherDetail}
            onChange={e => setOtherDetail(e.target.value)}
            placeholder="What was it?"
            style={{ width: '100%', boxSizing: 'border-box', ...mono, fontSize: 12, padding: '7px 10px', background: C.sur, border: `1px solid ${C.brd}`, borderRadius: 5, color: C.txt, outline: 'none' }}
          />
        </div>
      )}

      {/* Detail */}
      <div style={{ marginBottom: 14 }}>
        <p style={{ ...mono, margin: '0 0 4px', fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Win detail</p>
        <textarea
          value={detail}
          onChange={e => setDetail(e.target.value)}
          disabled={loading}
          rows={3}
          placeholder={loading ? 'Analyzing deal…' : 'What sealed the win?'}
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '8px 10px', background: C.sur, border: `1px solid ${C.brd}`, borderRadius: 6, color: C.txt, outline: 'none', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.6, opacity: loading ? 0.5 : 1 }}
        />
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleSaveLocal} disabled={loading || savingLocal || !selected.length}
          style={{ flex: 1, ...mono, fontSize: 12, padding: '9px 0', background: 'transparent', border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 6, cursor: loading || !selected.length ? 'default' : 'pointer', opacity: !selected.length ? 0.5 : 1 }}>
          {savingLocal ? 'Saving…' : 'Save locally'}
        </button>
        <button onClick={handleSaveSfdc} disabled={loading || savingSfdc || !selected.length}
          style={{ flex: 1, ...mono, fontSize: 12, padding: '9px 0', background: `${C.blue}14`, border: `1px solid ${C.blue}55`, color: C.blue, borderRadius: 6, cursor: loading || !selected.length ? 'default' : 'pointer', fontWeight: 600, opacity: !selected.length ? 0.5 : 1 }}>
          {savingSfdc ? 'Syncing…' : 'Save to Salesforce'}
        </button>
      </div>

      {toast && (
        <div style={{ ...mono, marginTop: 10, fontSize: 11, color: toast.color, textAlign: 'center' }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
