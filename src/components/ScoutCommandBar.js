import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { C, mono } from '../constants/colors';
import { T } from '../constants/tokens';
import { MODELS } from '../config/models';
import { SCOUT_LAYERS, filterAccountsByLayers } from '../utils/scoutLayers';
import { buildScoutContext } from '../utils/buildScoutContext';
import { subscribeIndexerStatus } from '../utils/threadIndexer';
import ScoutActionButtons from './ScoutActionButtons';

const RECENT_QUERIES_KEY = 'prospector_scout_recent_queries';
const MAX_RECENT_QUERIES = 5;

const SUGGESTED = [
  'Rank my top 5 deals by close confidence',
  "What's stale and needs a touch today?",
  'Write a forecast brief for Angie',
  'What do I owe people this week?',
  'Which deals are at risk this month?',
];

const PAGES = [
  { lb: 'Accounts',  pg: 'accounts',  ic: '◈', c: '#60A8F0' },
  { lb: 'Ledger',    pg: 'ledger',    ic: '⌬', c: T.cyan },
  { lb: 'Outbound',  pg: 'outbound',  ic: '🌵', c: '#A878F0' },
  { lb: 'Ideas',     pg: 'ideas',     ic: '◉', c: T.amber },
  { lb: 'Frontier',  pg: 'outbound',  tab: 'The Frontier', ic: '🌵', c: '#A878F0' },
  { lb: 'Pricing',   pg: 'tools',     ic: '$', c: '#FFD700' },
  { lb: 'ROI',       pg: 'tools',     tab: 'roi', ic: '↗', c: '#42E890' },
];

const VERBS_RE = /^(rank|list|show|give|find|write|draft|summarize|tell|forecast|brief|build|create|what|who|where|why|when|how|which)\b/i;

const SYSTEM = `You are a world-class sales analyst embedded in Prospector, an internal AE sales tool.
You have access to the AE's full pipeline. Be direct, specific, and opinionated.
Use the deal data to answer precisely — no hedging, no generic advice.
Format responses in clean markdown. Use tables for rankings. Use bullets for summaries.
Never invent data that isn't in the context.`;

const mdComponents = {
  h1: ({ children }) => <div style={{ fontSize:16, fontWeight:700, color:'#cfe8d4', marginBottom:8, marginTop:16 }}>{children}</div>,
  h2: ({ children }) => <div style={{ fontSize:14, fontWeight:600, color:'#cfe8d4', marginBottom:6, marginTop:14 }}>{children}</div>,
  h3: ({ children }) => <div style={{ ...mono, fontSize:11, fontWeight:600, color:T.neon, marginBottom:4, marginTop:12, textTransform:'uppercase', letterSpacing:'0.06em' }}>{children}</div>,
  p:  ({ children }) => <div style={{ fontSize:13, color:'#cfe8d4', lineHeight:1.7, marginBottom:4 }}>{children}</div>,
  li: ({ children }) => <div style={{ display:'flex', gap:8, marginBottom:4 }}><span style={{ color:`${T.neon}88`, flexShrink:0 }}>·</span><span style={{ fontSize:13, color:'#cfe8d4', lineHeight:1.6 }}>{children}</span></div>,
  ul: ({ children }) => <div style={{ marginBottom:8 }}>{children}</div>,
  ol: ({ children }) => <div style={{ marginBottom:8 }}>{children}</div>,
  strong: ({ children }) => <strong style={{ color:'#f1f5f9', fontWeight:600 }}>{children}</strong>,
  code: ({ inline, children }) => inline
    ? <code style={{ background:'#1a1a1a', padding:'1px 5px', borderRadius:3, fontFamily:'monospace', fontSize:11, color:T.amber }}>{children}</code>
    : <pre style={{ background:'#0d0d0d', border:`0.5px solid ${T.neon}33`, borderRadius:6, padding:'10px 14px', overflowX:'auto', marginBottom:10 }}><code style={{ fontFamily:'monospace', fontSize:12, color:'#e2e8f0' }}>{children}</code></pre>,
  table: ({ children }) => <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:12, fontSize:12 }}>{children}</table>,
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr:   ({ children }) => <tr>{children}</tr>,
  th:   ({ children }) => <th style={{ ...mono, fontSize:10, textAlign:'left', padding:'4px 8px', borderBottom:`1px solid ${T.neon}33`, color:T.neon, textTransform:'uppercase', letterSpacing:'0.06em' }}>{children}</th>,
  td:   ({ children }) => <td style={{ padding:'5px 8px', color:'#cfe8d4', fontSize:12, borderBottom:'0.5px solid #1a1a1a' }}>{children}</td>,
};

function loadRecentQueries() {
  try { return JSON.parse(localStorage.getItem(RECENT_QUERIES_KEY) || '[]'); } catch { return []; }
}

function pushRecentQuery(q) {
  try {
    const prev = loadRecentQueries().filter(x => x.toLowerCase() !== q.toLowerCase());
    const next = [q, ...prev].slice(0, MAX_RECENT_QUERIES);
    localStorage.setItem(RECENT_QUERIES_KEY, JSON.stringify(next));
  } catch {}
}

function isQuestionLike(s) {
  const trimmed = (s || '').trim();
  if (!trimmed) return false;
  if (trimmed.endsWith('?')) return true;
  if (VERBS_RE.test(trimmed)) return true;
  return trimmed.split(/\s+/).length >= 3;
}

const KEYFRAMES = `
@keyframes scoutBarBlink { 0%,49% { opacity:1 } 50%,100% { opacity:0 } }
@keyframes scoutBarPulse { 0%,100% { opacity:0.3 } 50% { opacity:1 } }
`;

export default function ScoutCommandBar({ accounts = [], onNav, onCreateTask, activeUser, aeMap = {}, onOpenChange }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [layers, setLayers] = useState(() => SCOUT_LAYERS.filter(l => l.default).map(l => l.id));
  const [scopeMode, setScopeMode] = useState('narrow'); // 'narrow' (apply layers) | 'full' (whole territory)
  const [copied, setCopied] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const [indexer, setIndexer] = useState({ running: false, processed: 0, total: 0 });
  const [recent, setRecent] = useState(loadRecentQueries);
  const [submittedQuery, setSubmittedQuery] = useState(''); // the query whose response is showing

  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const responseRef = useRef(null);
  const abortRef = useRef(null);
  const threadRef = useRef([]);

  useEffect(() => subscribeIndexerStatus(setIndexer), []);

  // Reports "engaged" (not "closed") — a caller wrapping this in a persistent
  // shell uses this to decide when to show scope UI above the bar. Only fires
  // true transitions; collapsing back to idle is the caller's own concern
  // (e.g. click-outside on its own wrapper), so it doesn't fight this
  // component's internal focus/escape handling below.
  useEffect(() => {
    if (focused || response || loading || error) onOpenChange?.(true);
  }, [focused, response, loading, error, onOpenChange]);

  // Auto-scroll response area
  useEffect(() => {
    if (responseRef.current) responseRef.current.scrollTop = responseRef.current.scrollHeight;
  }, [response]);

  // Escape collapses palette / clears response (close response first if shown)
  useEffect(() => {
    const h = (e) => {
      if (e.key !== 'Escape') return;
      if (response || loading) {
        if (abortRef.current) abortRef.current.abort();
        setResponse(''); setSubmittedQuery(''); setError(null);
      } else if (focused) {
        setFocused(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [focused, response, loading]);

  // Click outside collapses palette
  useEffect(() => {
    if (!focused) return;
    const h = (e) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) setFocused(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [focused]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const recentAccounts = useMemo(() => {
    return [...accounts]
      .filter(a => a.last)
      .sort((a, b) => (b.last || '').localeCompare(a.last || ''))
      .slice(0, 4);
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recentAccounts;
    return accounts
      .filter(a => a.name?.toLowerCase().includes(q))
      .slice(0, 6);
  }, [accounts, query, recentAccounts]);

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PAGES.slice(0, 4);
    return PAGES.filter(p => p.lb.toLowerCase().includes(q));
  }, [query]);

  const inScope = useMemo(
    () => scopeMode === 'full' ? accounts : filterAccountsByLayers(accounts, layers),
    [accounts, layers, scopeMode]
  );

  const runQuery = useCallback(async (q, conversationHistory = []) => {
    if (!q.trim()) return;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);
    setResponse('');
    setSubmittedQuery(q);

    const context = buildScoutContext(inScope, aeMap);
    const systemMsg = `${SYSTEM}\n\nPipeline context (${inScope.length} deals):\n\n${context}`;
    const messages = [...conversationHistory, { role: 'user', content: `Query: ${q}` }];

    try {
      const res = await fetch('/proxy/anthropic/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODELS.STANDARD,
          max_tokens: 2000,
          stream: true,
          system: systemMsg,
          messages,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        setError(`Error ${res.status} — ${txt.slice(0, 120) || 'try again'}`);
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.delta?.text || parsed.choices?.[0]?.delta?.content || '';
            if (delta) { full += delta; setResponse(full); }
          } catch {}
        }
      }

      pushRecentQuery(q);
      setRecent(loadRecentQueries());
      return [...messages, { role: 'assistant', content: full }];
    } catch (err) {
      if (err.name !== 'AbortError') setError('Something went wrong — try again.');
    } finally {
      setLoading(false);
    }
  }, [inScope]);

  const handleSubmit = async (q) => {
    if (!q || !q.trim()) return;
    setFocused(false);
    inputRef.current?.blur();
    threadRef.current = [];
    const thread = await runQuery(q);
    if (thread) threadRef.current = thread;
  };

  const handleFollowUp = async () => {
    const q = followUp.trim();
    if (!q) return;
    setFollowUp('');
    const ctx = threadRef.current.slice(-6);
    const thread = await runQuery(q, ctx);
    if (thread) threadRef.current = thread;
  };

  const toggleLayer = (id) => {
    if (id === 'active') return;
    setLayers(prev => prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]);
  };

  const handlePageNav = (p) => {
    setFocused(false);
    setQuery('');
    onNav?.(p.pg, p.tab || null);
  };

  const handleAccountNav = (a) => {
    setFocused(false);
    setQuery('');
    onNav?.('accounts', a.id);
  };

  const clearResponse = () => {
    if (abortRef.current) abortRef.current.abort();
    setResponse(''); setSubmittedQuery(''); setError(null); setLoading(false);
    threadRef.current = [];
  };

  const showAskCta = query.trim().length > 0 && isQuestionLike(query);
  const showPalette = focused && !response && !loading;

  return (
    <div ref={wrapperRef} style={{ position: 'relative', marginBottom: response || loading ? 10 : 0 }}>
      <style>{KEYFRAMES}</style>

      {/* Scope toggle — narrow (apply layers) vs full territory */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {[
          { id: 'narrow', label: 'Active/Qualified' },
          { id: 'full',   label: 'Full territory' },
        ].map(m => {
          const on = scopeMode === m.id;
          return (
            <button key={m.id} onClick={() => setScopeMode(m.id)}
              style={{ ...mono, fontSize: 9, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
                background: on ? `${T.neon}18` : 'transparent',
                border: `1px solid ${on ? `${T.neon}66` : `${T.neon}22`}`,
                color: on ? T.neon : '#5a6a5a',
                fontWeight: on ? 600 : 400,
                letterSpacing: '0.04em' }}>
              {m.label}
            </button>
          );
        })}
        <span style={{ ...mono, fontSize: 9, color: '#3a4a3a', marginLeft: 'auto' }}>
          {inScope.length} deal{inScope.length !== 1 ? 's' : ''} in scope
        </span>
      </div>

      {/* ── Compact bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, position: 'relative' }}>
        <span style={{ ...mono, position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: T.neon, fontWeight: 700, letterSpacing: '0.1em', pointerEvents: 'none', zIndex: 1 }}>⛏ SCOUT</span>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={e => {
            if (e.key === 'Enter' && query.trim()) handleSubmit(query);
          }}
          placeholder=""
          style={{
            ...mono,
            width: '100%',
            boxSizing: 'border-box',
            fontSize: 13,
            padding: '10px 12px 10px 88px',
            background: '#050f05',
            border: `1px solid ${focused ? T.neon : `${T.neon}33`}`,
            borderRadius: 6,
            color: '#cfe8d4',
            outline: 'none',
            caretColor: T.neon,
            transition: 'border-color 0.15s, box-shadow 0.15s',
            boxShadow: focused ? `0 0 0 3px ${T.neon}14` : 'none',
          }}
        />
        {!query && !focused && (
          <span aria-hidden="true" style={{ ...mono, position: 'absolute', left: 92, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: `${T.neon}66`, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            Search accounts, pages, or ask anything...
            <span style={{ marginLeft: 3, color: T.neon, animation: 'scoutBarBlink 1s steps(2) infinite' }}>▊</span>
          </span>
        )}
        {query && (
          <button onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: T.neon, fontSize: 14, cursor: 'pointer', padding: '0 6px', lineHeight: 1, zIndex: 1 }}>×</button>
        )}
      </div>

      {/* ── Command palette overlay ── */}
      {showPalette && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 400,
          background: '#050f05', border: `1px solid ${T.neon}55`, borderRadius: 6,
          boxShadow: `0 12px 40px rgba(0,0,0,0.6), 0 0 24px ${T.neon}18`,
          overflow: 'hidden', maxHeight: '60vh', overflowY: 'auto',
        }}
          onMouseDown={e => e.preventDefault()}
        >
          {/* SUGGESTED — show only when input empty */}
          {!query.trim() && (
            <Section title="Suggested">
              {SUGGESTED.map((s, i) => (
                <Row key={`s-${i}`} onClick={() => { setQuery(s); inputRef.current?.focus(); }}
                  icon="⚡" iconColor={T.amber} label={s}/>
              ))}
            </Section>
          )}

          {/* RECENT QUERIES — show only when input empty and we have history */}
          {!query.trim() && recent.length > 0 && (
            <Section title="Recent queries">
              {recent.map((s, i) => (
                <Row key={`r-${i}`} onClick={() => handleSubmit(s)}
                  icon="↺" iconColor={`${T.neon}AA`} label={s}/>
              ))}
            </Section>
          )}

          {/* ACCOUNTS — recent (no query) or filtered */}
          {filteredAccounts.length > 0 && (
            <Section title={query.trim() ? 'Accounts' : 'Recent accounts'}>
              {filteredAccounts.map(a => (
                <Row key={a.id} onClick={() => handleAccountNav(a)}
                  icon="→" iconColor={`${T.neon}AA`}
                  label={
                    <>
                      <span style={{ color: '#cfe8d4', fontWeight: 500 }}>{a.name}</span>
                      {a.tier && <span style={{ ...mono, fontSize: 10, color: '#5a6a5a', marginLeft: 8 }}>· {a.tier}</span>}
                      {a.stage && <span style={{ ...mono, fontSize: 10, color: '#5a6a5a', marginLeft: 4 }}>· {a.stage}</span>}
                    </>
                  }/>
              ))}
            </Section>
          )}

          {/* PAGES */}
          {filteredPages.length > 0 && (
            <Section title="Pages">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 12px 8px' }}>
                {filteredPages.map(p => (
                  <button key={p.lb} onClick={() => handlePageNav(p)}
                    style={{ ...mono, fontSize: 11, padding: '4px 10px', background: 'transparent', border: `1px solid ${p.c}55`, color: p.c, borderRadius: 3, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span>{p.ic}</span> {p.lb}
                  </button>
                ))}
              </div>
            </Section>
          )}

          {/* ASK SCOUT CTA — when input looks like a question */}
          {showAskCta && (
            <div style={{ borderTop: `1px solid ${T.neon}22`, padding: '8px 12px', background: `${T.neon}06` }}>
              <button onClick={() => handleSubmit(query)}
                style={{ ...mono, width: '100%', fontSize: 12, padding: '8px 14px', background: `${T.neon}18`, border: `1px solid ${T.neon}`, color: T.neon, borderRadius: 5, cursor: 'pointer', letterSpacing: '0.04em', fontWeight: 600, textShadow: `0 0 6px ${T.neon}55`, textAlign: 'left' }}>
                ◆ ASK SCOUT → <span style={{ color: '#cfe8d4', fontWeight: 400, marginLeft: 6 }}>{query}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Response panel ── */}
      {(response || loading || error) && (
        <div style={{ marginTop: 8, background: '#050f05', border: `1px solid ${T.neon}55`, borderRadius: 6, padding: '14px 16px', boxShadow: `0 0 24px ${T.neon}11` }}>
          {/* Header: query echo + layers + copy + close */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ ...mono, fontSize: 10, color: T.neon, fontWeight: 700, letterSpacing: '0.1em', flexShrink: 0 }}>⛏ SCOUT</span>
            <span style={{ ...mono, fontSize: 11, color: '#cfe8d4', flex: 1, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {submittedQuery}
            </span>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {SCOUT_LAYERS.map(l => {
                const on = layers.includes(l.id);
                return (
                  <button key={l.id} onClick={() => toggleLayer(l.id)}
                    style={{ ...mono, fontSize: 10, padding: '3px 9px', borderRadius: 4, cursor: l.id === 'active' ? 'default' : 'pointer', background: on ? `${T.neon}18` : 'transparent', border: `1px solid ${on ? `${T.neon}66` : `${T.neon}22`}`, color: on ? T.neon : '#5a6a5a', fontWeight: on ? 600 : 400 }}>
                    {l.label}
                  </button>
                );
              })}
            </div>
            {response && (
              <button onClick={() => { navigator.clipboard.writeText(response); setCopied(true); }}
                style={{ ...mono, fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', background: copied ? '#4ade8018' : 'transparent', border: `1px solid ${copied ? '#4ade8044' : `${T.neon}33`}`, color: copied ? '#4ade80' : '#5a6a5a', flexShrink: 0 }}>
                {copied ? '✓ Copied' : '⎘ Copy'}
              </button>
            )}
            <button onClick={clearResponse}
              style={{ ...mono, fontSize: 13, background: 'transparent', border: 'none', color: '#5a6a5a', cursor: 'pointer', padding: '0 4px', flexShrink: 0, lineHeight: 1 }}>
              ✕
            </button>
          </div>

          {/* Scope + indexer status */}
          <div style={{ ...mono, fontSize: 10, color: '#5a6a5a', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>{inScope.length} deal{inScope.length !== 1 ? 's' : ''} in scope</span>
            {indexer.running && (
              <span style={{ color: T.amber, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: T.amber, animation: 'scoutBarPulse 1.2s ease-in-out infinite' }}/>
                Indexing email context… {indexer.processed}/{indexer.total}
              </span>
            )}
          </div>

          {/* Response body */}
          <div ref={responseRef} style={{ maxHeight: '50vh', overflowY: 'auto', background: '#070d07', border: `0.5px solid ${T.neon}22`, borderRadius: 5, padding: '14px 16px', minHeight: 80 }}>
            {loading && !response && (
              <div style={{ ...mono, fontSize: 12, color: '#5a6a5a' }}>Analyzing pipeline…</div>
            )}
            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ ...mono, fontSize: 12, color: C.red }}>{error}</span>
                <button onClick={() => handleSubmit(submittedQuery)}
                  style={{ ...mono, fontSize: 11, padding: '3px 10px', background: 'transparent', border: `1px solid ${C.red}44`, borderRadius: 4, color: C.red, cursor: 'pointer' }}>
                  Retry
                </button>
              </div>
            )}
            {response && <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{response}</ReactMarkdown>}
            {loading && response && <span style={{ ...mono, fontSize: 11, color: `${T.neon}99`, animation: 'scoutBarBlink 0.8s steps(2) infinite' }}>▊</span>}
          </div>

          {/* Action buttons */}
          {response && !loading && (
            <ScoutActionButtons response={response} query={submittedQuery} accounts={accounts} onNav={onNav} onCreateTask={onCreateTask}/>
          )}

          {/* Follow-up */}
          {response && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input
                value={followUp}
                onChange={e => setFollowUp(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) handleFollowUp(); }}
                disabled={loading}
                placeholder="Follow up…"
                style={{ ...mono, flex: 1, fontSize: 12, background: '#070d07', border: `1px solid ${T.neon}33`, borderRadius: 5, color: '#cfe8d4', padding: '7px 12px', outline: 'none', opacity: loading ? 0.5 : 1 }}
              />
              <button onClick={handleFollowUp} disabled={loading || !followUp.trim()}
                style={{ ...mono, fontSize: 12, padding: '6px 16px', background: followUp.trim() && !loading ? `${T.neon}18` : 'transparent', border: `1px solid ${followUp.trim() && !loading ? T.neon : `${T.neon}22`}`, borderRadius: 5, color: followUp.trim() && !loading ? T.neon : '#5a6a5a', cursor: followUp.trim() && !loading ? 'pointer' : 'default', fontWeight: 600 }}>
                →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{ ...mono, fontSize: 9, color: `${T.neon}88`, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '8px 12px 4px', fontWeight: 600 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ onClick, icon, iconColor, label }) {
  return (
    <button onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.background = `${T.neon}0a`}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '6px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s' }}>
      <span style={{ ...mono, fontSize: 11, color: iconColor, flexShrink: 0 }}>{icon}</span>
      <span style={{ ...mono, fontSize: 12, color: '#cfe8d4', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </button>
  );
}
