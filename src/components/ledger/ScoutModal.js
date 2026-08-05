import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { C, mono } from '../../constants/colors';
import { MODELS } from '../../config/models';
import { SCOUT_LAYERS, filterAccountsByLayers } from '../../utils/scoutLayers';
import { buildScoutContext } from '../../utils/buildScoutContext';
import { subscribeIndexerStatus } from '../../utils/threadIndexer';

const HISTORY_KEY = 'prospector_scout_history';
const GHOST_PROMPTS = [
  'Rank my top 5 deals by close confidence',
  'Write a forecast brief for Angie',
  "What's blocking my Q2 number?",
  'Summarize deals at risk this month',
];

const SYSTEM = `You are a world-class sales analyst embedded in Prospector, an internal AE sales tool.
You have access to the AE's full pipeline. Be direct, specific, and opinionated.
Use the deal data to answer precisely — no hedging, no generic advice.
Format responses in clean markdown. Use tables for rankings. Use bullets for summaries.
Never invent data that isn't in the context.`;

function loadHistory(userId) {
  try {
    const all = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
    return all[userId] || [];
  } catch { return []; }
}

function saveHistory(userId, entries) {
  try {
    const all = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
    all[userId] = entries.slice(-20);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
  } catch {}
}

const mdComponents = {
  h1: ({ children }) => <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 8, marginTop: 16 }}>{children}</div>,
  h2: ({ children }) => <div style={{ fontSize: 14, fontWeight: 600, color: C.txt, marginBottom: 6, marginTop: 14 }}>{children}</div>,
  h3: ({ children }) => <div style={{ ...mono, fontSize: 11, fontWeight: 600, color: '#f59e0b', marginBottom: 4, marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{children}</div>,
  p:  ({ children }) => <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.7, marginBottom: 4 }}>{children}</div>,
  li: ({ children }) => <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}><span style={{ color: C.dim, flexShrink: 0 }}>·</span><span style={{ fontSize: 13, color: C.txt, lineHeight: 1.6 }}>{children}</span></div>,
  ul: ({ children }) => <div style={{ marginBottom: 8 }}>{children}</div>,
  ol: ({ children }) => <div style={{ marginBottom: 8 }}>{children}</div>,
  strong: ({ children }) => <strong style={{ color: C.txt, fontWeight: 600 }}>{children}</strong>,
  code: ({ inline, children }) => inline
    ? <code style={{ background: '#1a1a1a', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', fontSize: 11, color: '#f59e0b' }}>{children}</code>
    : <pre style={{ background: '#0d0d0d', border: '0.5px solid #2a2a2a', borderRadius: 6, padding: '10px 14px', overflowX: 'auto', marginBottom: 10 }}><code style={{ fontFamily: 'monospace', fontSize: 12, color: '#e2e8f0' }}>{children}</code></pre>,
  table: ({ children }) => <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: 12 }}>{children}</table>,
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr:   ({ children }) => <tr>{children}</tr>,
  th:   ({ children }) => <th style={{ ...mono, fontSize: 10, textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #2a2a2a', color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{children}</th>,
  td:   ({ children }) => <td style={{ padding: '5px 8px', color: C.txt, fontSize: 12, borderBottom: '0.5px solid #1a1a1a' }}>{children}</td>,
};

export default function ScoutModal({ onClose, accounts, activeUser }) {
  const userId   = activeUser?.id || 'default';
  const [layers, setLayers] = useState(() => SCOUT_LAYERS.filter(l => l.default).map(l => l.id));
  const [query,  setQuery]  = useState('');
  const [followUp, setFollowUp] = useState('');
  const [response, setResponse] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [history,  setHistory]  = useState(() => loadHistory(userId));
  const [copied,   setCopied]   = useState(false);
  const [ghostIdx, setGhostIdx] = useState(0);
  const [indexer, setIndexer]   = useState({ running: false, processed: 0, total: 0 });
  const responseRef  = useRef(null);
  const followUpRef  = useRef(null);
  const abortRef     = useRef(null);

  // Cycle ghost prompt in follow-up placeholder
  useEffect(() => {
    const t = setInterval(() => setGhostIdx(i => (i + 1) % GHOST_PROMPTS.length), 3500);
    return () => clearInterval(t);
  }, []);

  // Subscribe to background thread indexer status
  useEffect(() => subscribeIndexerStatus(setIndexer), []);

  // Auto-scroll response
  useEffect(() => {
    if (responseRef.current) responseRef.current.scrollTop = responseRef.current.scrollHeight;
  }, [response]);

  // Close on Escape
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const filteredAccounts = filterAccountsByLayers(accounts, layers);

  const runQuery = useCallback(async (q, conversationHistory = []) => {
    if (!q.trim()) return;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);
    setResponse('');

    const context = buildScoutContext(filteredAccounts);
    const systemMsg = `${SYSTEM}\n\nPipeline context (${filteredAccounts.length} deals):\n\n${context}`;

    const messages = [
      ...conversationHistory,
      { role: 'user', content: `Query: ${q}` },
    ];

    try {
      const res = await fetch('/proxy/anthropic/messages', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:      MODELS.STANDARD,
          max_tokens: 2000,
          stream:     true,
          system:     systemMsg,
          messages,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('[Scout] proxy error', res.status, errText);
        setError(`Error ${res.status} — ${errText.slice(0, 120) || 'try again'}`);
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

      // Save to history
      const entry = { query: q, response: full, timestamp: new Date().toISOString(), layers };
      const updated = [...history, entry];
      setHistory(updated);
      saveHistory(userId, updated);

      // Return messages for follow-up threading
      return [...messages, { role: 'assistant', content: full }];

    } catch (err) {
      if (err.name !== 'AbortError') setError('Something went wrong — try again.');
    } finally {
      setLoading(false);
    }
  }, [filteredAccounts, history, layers, userId]);

  // Thread ref for follow-up context
  const threadRef = useRef([]);

  const handleSubmit = async (q) => {
    threadRef.current = [];
    const thread = await runQuery(q);
    if (thread) threadRef.current = thread;
  };

  const handleFollowUp = async () => {
    const q = followUp.trim();
    if (!q) return;
    setFollowUp('');
    // Keep last 3 turns (6 messages) for context
    const ctx = threadRef.current.slice(-6);
    const thread = await runQuery(q, ctx);
    if (thread) threadRef.current = thread;
  };

  const toggleLayer = (id) => {
    if (id === 'active') return; // Active always on
    setLayers(prev => prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9000, display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div style={{ width: '80%', display: 'flex', flexDirection: 'column', background: '#080808', borderLeft: '1px solid #1e1e1e', boxShadow: '-8px 0 40px rgba(0,0,0,0.7)', padding: '20px 20px 0' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ ...mono, fontSize: 11, color: '#f59e0b', fontWeight: 600, flexShrink: 0 }}>◆ SCOUT</span>

          {/* Query display / editable */}
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(query); }}
            style={{ flex: 1, ...mono, fontSize: 13, background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 6, color: C.txt, padding: '7px 12px', outline: 'none' }}
            placeholder="Ask anything about your pipeline..."
            autoFocus
          />

          {/* Layer pills */}
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {SCOUT_LAYERS.map(l => {
              const on = layers.includes(l.id);
              return (
                <button key={l.id} onClick={() => toggleLayer(l.id)}
                  style={{ ...mono, fontSize: 10, padding: '3px 9px', borderRadius: 4, cursor: l.id === 'active' ? 'default' : 'pointer', background: on ? '#f59e0b18' : 'transparent', border: `1px solid ${on ? '#f59e0b66' : '#2a2a2a'}`, color: on ? '#f59e0b' : '#555', fontWeight: on ? 600 : 400 }}>
                  {l.label}
                </button>
              );
            })}
          </div>

          {/* Copy + close */}
          {response && (
            <button onClick={() => { navigator.clipboard.writeText(response); setCopied(true); }}
              style={{ ...mono, fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', background: copied ? '#4ade8018' : 'transparent', border: `1px solid ${copied ? '#4ade8044' : '#2a2a2a'}`, color: copied ? '#4ade80' : C.dim, flexShrink: 0 }}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          )}
          <button onClick={onClose}
            style={{ ...mono, fontSize: 13, background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', padding: '0 4px', flexShrink: 0 }}>
            ✕
          </button>
        </div>

        {/* Account count + submit hint */}
        <div style={{ ...mono, fontSize: 10, color: '#555', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>
            {filteredAccounts.length} deal{filteredAccounts.length !== 1 ? 's' : ''} in scope
            {!loading && !response && <span> · press Enter to run</span>}
          </span>
          {indexer.running && (
            <span style={{ color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', animation: 'scoutPulse 1.2s ease-in-out infinite' }}/>
              Indexing email context… {indexer.processed}/{indexer.total}
            </span>
          )}
          <style>{`@keyframes scoutPulse { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }`}</style>
        </div>

        {/* Response area */}
        <div ref={responseRef} style={{ flex: 1, overflowY: 'auto', background: '#070707', border: '0.5px solid #1a1a1a', borderRadius: 8, padding: '16px 18px', marginBottom: 10, minHeight: 200 }}>

          {!response && !loading && !error && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 20 }}>
              <p style={{ ...mono, fontSize: 11, color: '#444', margin: '0 0 12px' }}>Try asking:</p>
              {GHOST_PROMPTS.map((p, i) => (
                <button key={i} onClick={() => { setQuery(p); handleSubmit(p); }}
                  style={{ textAlign: 'left', ...mono, fontSize: 12, color: '#555', background: 'transparent', border: '1px solid #1a1a1a', borderRadius: 5, padding: '7px 12px', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#f59e0b'; e.currentTarget.style.borderColor = '#f59e0b44'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#555'; e.currentTarget.style.borderColor = '#1a1a1a'; }}>
                  {p}
                </button>
              ))}
            </div>
          )}

          {loading && !response && (
            <div style={{ ...mono, fontSize: 12, color: '#555', paddingTop: 20 }}>Analyzing pipeline…</div>
          )}

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ ...mono, fontSize: 12, color: C.red }}>{error}</span>
              <button onClick={() => handleSubmit(query)} style={{ ...mono, fontSize: 11, padding: '3px 10px', background: 'transparent', border: `1px solid ${C.red}44`, borderRadius: 4, color: C.red, cursor: 'pointer' }}>Retry</button>
            </div>
          )}

          {filteredAccounts.length === 0 && (
            <p style={{ ...mono, fontSize: 12, color: C.dim }}>No deals found for the selected layers.</p>
          )}

          {response && <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{response}</ReactMarkdown>}

          {loading && response && (
            <span style={{ ...mono, fontSize: 11, color: '#555' }}>▊</span>
          )}
        </div>

        {/* Follow-up input */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            ref={followUpRef}
            value={followUp}
            onChange={e => setFollowUp(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !loading) handleFollowUp(); }}
            disabled={loading}
            placeholder={`Ask a follow-up — e.g. "${GHOST_PROMPTS[ghostIdx]}"`}
            style={{ flex: 1, ...mono, fontSize: 12, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 6, color: C.txt, padding: '7px 12px', outline: 'none', opacity: loading ? 0.5 : 1 }}
          />
          <button onClick={handleFollowUp} disabled={loading || !followUp.trim()}
            style={{ ...mono, fontSize: 12, padding: '6px 16px', background: followUp.trim() && !loading ? '#f59e0b18' : 'transparent', border: `1px solid ${followUp.trim() && !loading ? '#f59e0b66' : '#1a1a1a'}`, borderRadius: 6, color: followUp.trim() && !loading ? '#f59e0b' : '#555', cursor: followUp.trim() && !loading ? 'pointer' : 'default' }}>
            →
          </button>
        </div>
      </div>
    </div>
  );
}
