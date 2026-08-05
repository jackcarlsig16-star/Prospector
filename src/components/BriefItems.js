import { useState, useMemo } from 'react';
import { C, mono } from '../constants/colors';
import RequestModal from './RequestModal';
import { MODELS } from '../config/models';

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const dismissedKey = () => `prospector_brief_dismissed_${todayStr()}`;
const itemKey = it => `${it.account || 'no-acc'}|${it.headline || it.subject || ''}`;
const loadDismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(dismissedKey()) || '[]')); } catch { return new Set(); } };
const saveDismissed = set => { try { localStorage.setItem(dismissedKey(), JSON.stringify([...set])); } catch {} };

const extractDomain = acc => {
  const raw = (acc?.web || '').toLowerCase().trim();
  if (!raw) return null;
  return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0] || null;
};

const isAutoResolved = (item, accounts, threadCache, generatedAt) => {
  if (!generatedAt) return false;
  const acc = accounts.find(a => a.id === item.account_id) || accounts.find(a => a.name === item.account);
  const domain = extractDomain(acc);
  if (!domain) return false;
  const entry = threadCache[domain];
  if (!entry) return false;
  return entry.last_contact_direction === 'outbound' && (entry.cachedAt || 0) > generatedAt;
};

const ACTION_LABELS = {
  draft_email:    '✉ Draft Email',
  request_se:     '⚙ Request SE',
  request_credit: '💳 Request Credit',
  pre_call_brief: '★ Pre-Call Brief',
  open_sfdc:      '↗ Salesforce',
  view_account:   '→ View Account',
};

function buildSfdcUrl(sfdc) {
  if (!sfdc) return null;
  if (sfdc.startsWith('http')) return sfdc;
  if (/^006[A-Za-z0-9]+/.test(sfdc)) return `https://your-org.lightning.force.com/lightning/r/Opportunity/${sfdc}/view`;
  if (/^001[A-Za-z0-9]+/.test(sfdc)) return `https://your-org.lightning.force.com/lightning/r/Account/${sfdc}/view`;
  return null;
}

async function generateDraftEmail(item, acc) {
  const context = `Account: ${acc.name} (${acc.tier || '?'}, ${acc.stage || '?'})
Products: ${(acc.prods || []).join(', ') || 'none'}
Pain / Objective: ${acc.medpicc?.identify_pain || 'not captured'}
Brief item: ${item.headline || item.subject || ''}
Context: ${item.context || item.summary || ''}
Last call summary: ${(acc.calls?.[0]?.summary || '').slice(0, 300) || 'none'}`;

  const res = await fetch('/proxy/anthropic/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.FAST,
      max_tokens: 300,
      messages: [{ role: 'user', content: `${context}\n\nWrite a short, specific follow-up email for an AE based on the brief item above.\n- Subject line first, then body\n- 3-4 sentences max\n- Tone: professional but warm\n- Reference the specific situation from the brief item\n- End with one clear next step or question\n- Format:\nSubject: [subject line]\n\n[email body]\n\nNo preamble, no sign-off needed.` }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text?.trim() || '';
}

const PRIORITY_C = { immediate: C.red, today: C.orange, fyi: C.dim };

const briefDateKey = () => { const d = new Date(); return `prospector_morning_brief_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

// Props: items, gongThreads, generatedAt, accounts, tasks, onNav, onUpdateTask, onClose
export default function BriefItems({ items=[], gongThreads=[], generatedAt, accounts=[], tasks=[], onNav, onUpdateTask, onClose }) {
  const [dismissed,    setDismissed]    = useState(loadDismissed);
  const [draftingIdx,  setDraftingIdx]  = useState(null);
  const [copiedIdx,    setCopiedIdx]    = useState(null);
  const [requestModal, setRequestModal] = useState(null);
  const [toast,        setToast]        = useState(null);

  const threadCache = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('prospector_threads_cache') || '{}'); } catch { return {}; }
  }, []);

  const visibleItems = useMemo(() => items.filter(it =>
    !dismissed.has(itemKey(it)) && !isAutoResolved(it, accounts, threadCache, generatedAt)
  ), [items, dismissed, accounts, threadCache, generatedAt]);

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const removeItem = (idx, complete) => {
    const item = visibleItems[idx];
    if (!item) return;
    const nextDismissed = new Set(dismissed);
    nextDismissed.add(itemKey(item));
    setDismissed(nextDismissed);
    saveDismissed(nextDismissed);
    try {
      const cached = JSON.parse(localStorage.getItem(briefDateKey()) || '{}');
      const nextCachedItems = (cached.items || []).filter(c => itemKey(c) !== itemKey(item));
      localStorage.setItem(briefDateKey(), JSON.stringify({ ...cached, items: nextCachedItems }));
    } catch {}
    if (complete && item.resolves_task) {
      const task = tasks.find(t => t.title === item.resolves_task && t.status !== 'Done' && t.status !== 'Completed');
      if (task && onUpdateTask) onUpdateTask(task.id, { status: 'Done' });
    }
  };

  const handleDraftEmail = async (item, idx) => {
    const acc = accounts.find(a => a.id === item.account_id) || accounts.find(a => a.name === item.account);
    if (!acc) {
      if (item.account_id) { onNav?.('accounts', item.account_id); onClose?.(); }
      return;
    }
    setDraftingIdx(idx);
    try {
      const text = await generateDraftEmail(item, acc);
      if (text) {
        await navigator.clipboard.writeText(text);
        setCopiedIdx(idx);
        setTimeout(() => setCopiedIdx(null), 2000);
      }
    } catch (err) {
      console.error('[BriefItems] draft email failed:', err);
      onNav?.('accounts', acc.id);
      onClose?.();
    } finally {
      setDraftingIdx(null);
    }
  };

  const handleAction = (action, item, idx) => {
    const acc = accounts.find(a => a.id === item.account_id) || accounts.find(a => a.name === item.account);
    switch (action) {
      case 'draft_email':    handleDraftEmail(item, idx); break;
      case 'pre_call_brief':
        if (acc) { onNav?.('accounts', acc.id); onClose?.(); showToast(`Navigating to ${acc.name} — click ★ Pre-Call to prep`); }
        break;
      case 'request_se':     if (acc) setRequestModal({ type: 'se',     account: acc }); break;
      case 'request_credit': if (acc) setRequestModal({ type: 'credit', account: acc }); break;
      case 'open_sfdc': { const url = buildSfdcUrl(acc?.sfdc); if (url) window.open(url, '_blank'); break; }
      case 'view_account':   if (acc) { onNav?.('accounts', acc.id); onClose?.(); } break;
      default: break;
    }
  };

  return (
    <>
      {/* Gong bucket */}
      {gongThreads.length > 0 && (
        <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${C.brd}22` }}>
          <div style={{ ...mono, fontSize: 9, color: C.mut, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>
            🎙 Gong Transcripts — {gongThreads.length} to log
          </div>
          {gongThreads.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ ...mono, fontSize: 10, color: C.txt, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
              {t.date && <span style={{ ...mono, fontSize: 9, color: C.dim, flexShrink: 0 }}>{(() => { try { const d = new Date(t.date); return `${d.getMonth()+1}/${d.getDate()}`; } catch { return ''; } })()}</span>}
              {t.account_id && (
                <button onClick={() => { onNav?.('accounts', t.account_id); onClose?.(); }}
                  style={{ ...mono, fontSize: 9, color: C.gold, background: 'transparent', border: `1px solid ${C.gold}44`, borderRadius: 3, padding: '1px 6px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  Log Debrief →
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Brief items */}
      {visibleItems.map((item, i) => {
        const color   = item.type === 'urgent' ? C.red : item.type === 'reply_needed' ? C.orange : C.blue;
        const actions = item.actions || [];
        const isDrafting = draftingIdx === i;
        const isCopied   = copiedIdx   === i;
        return (
          <div key={i} style={{ borderLeft: `3px solid ${color}`, background: `${color}08`, borderRadius: '0 5px 5px 0', padding: '5px 8px', marginBottom: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ ...mono, fontSize: 9, color, flexShrink: 0 }}>
                {item.type === 'urgent' ? '⚡' : item.type === 'reply_needed' ? '✉' : '→'}
              </span>
              <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: C.txt, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.headline || item.subject}
              </span>
              {item.account && (
                <span style={{ ...mono, fontSize: 8, color: C.dim, background: `${C.dim}22`, border: `1px solid ${C.dim}44`, borderRadius: 3, padding: '0 5px', flexShrink: 0, maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.account}
                </span>
              )}
              {item.priority && (
                <span style={{ ...mono, fontSize: 8, color: PRIORITY_C[item.priority] || C.dim, flexShrink: 0 }}>{item.priority}</span>
              )}
              <button onClick={() => removeItem(i, true)}  title="Mark complete" style={{ ...mono, fontSize: 10, color: C.green, background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0, lineHeight: 1 }}>✓</button>
              <button onClick={() => removeItem(i, false)} title="Dismiss"        style={{ ...mono, fontSize: 10, color: C.dim,  background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0, lineHeight: 1 }}>✕</button>
            </div>
            {(item.context || item.summary) && (
              <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 3, paddingLeft: 16 }}>
                {item.context || item.summary}
              </div>
            )}
            {actions.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5, paddingLeft: 16 }}>
                {actions.map(action => {
                  const isDraftBtn = action === 'draft_email';
                  return (
                    <button key={action}
                      disabled={isDraftBtn && isDrafting}
                      onClick={() => handleAction(action, item, i)}
                      style={{ ...mono, fontSize: 9, padding: '2px 7px',
                        background: isDraftBtn && isCopied ? `${C.green}12` : 'transparent',
                        border: `1px solid ${isDraftBtn && isCopied ? C.green + '44' : C.brd}`,
                        color: isDraftBtn && isCopied ? C.green : C.mut,
                        borderRadius: 3, cursor: isDraftBtn && isDrafting ? 'default' : 'pointer',
                        whiteSpace: 'nowrap', opacity: isDraftBtn && isDrafting ? 0.6 : 1,
                      }}>
                      {isDraftBtn && isDrafting ? '⟳ Drafting…' : isDraftBtn && isCopied ? '✓ Copied!' : ACTION_LABELS[action] || action}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <RequestModal type={requestModal?.type} account={requestModal?.account} isOpen={!!requestModal} onClose={() => setRequestModal(null)}/>

      {toast && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', zIndex: 5000, background: '#1e293b', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '9px 14px', boxShadow: '0 8px 24px #000a', ...mono, fontSize: 11, color: C.txt, maxWidth: 340, textAlign: 'center' }}>
          {toast}
        </div>
      )}
    </>
  );
}
