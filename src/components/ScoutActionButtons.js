import React, { useMemo, useState } from 'react';
import { mono } from '../constants/colors';
import { T } from '../constants/tokens';

const VERBS = /^(rank|list|show|give|find|write|draft|summarize|tell|forecast|brief|build|create)\b/i;
const FORECAST_RE = /\b(forecast|brief|exec\s*summary|recap)\b/i;
const RANK_RE = /\b(rank|top\s+\d+|best\s+\d+|prioritize)\b/i;
const TASK_RE = /\b(task|todo|to-do|action item|commitment|i (?:need to|should|owe)|next step)\b/i;

function detectMentionedAccounts(response, accounts) {
  if (!response) return [];
  const lower = response.toLowerCase();
  const found = [];
  const seen = new Set();
  for (const acc of accounts) {
    if (!acc?.name || acc.name.length < 4) continue;
    if (!lower.includes(acc.name.toLowerCase())) continue;
    if (seen.has(acc.id)) continue;
    seen.add(acc.id);
    found.push(acc);
    if (found.length >= 6) break;
  }
  return found;
}

function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function ScoutActionButtons({ response, query='', accounts=[], onNav, onCreateTask, onOpenLedger }) {
  const [copied, setCopied] = useState(false);
  const [taskAdded, setTaskAdded] = useState(false);

  const { mentioned, showForecastCopy, showRankNav, showAddTask } = useMemo(() => {
    const r = response || '';
    const q = query || '';
    return {
      mentioned: detectMentionedAccounts(r, accounts),
      showForecastCopy: FORECAST_RE.test(q),
      showRankNav: RANK_RE.test(q) || /^\s*1\.\s/m.test(r),
      showAddTask: TASK_RE.test(r) || TASK_RE.test(q) || VERBS.test(q),
    };
  }, [response, query, accounts]);

  const hasAny = mentioned.length > 0 || showForecastCopy || showRankNav || showAddTask;
  if (!hasAny || !response) return null;

  const handleCopySlack = () => {
    const plain = stripMarkdown(response);
    navigator.clipboard.writeText(plain).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleAddTask = () => {
    if (!onCreateTask) return;
    const today = new Date().toISOString().split('T')[0];
    const due = new Date(); due.setDate(due.getDate() + 2);
    const title = (query || 'Scout follow-up').slice(0, 80);
    const primaryAcc = mentioned[0];
    onCreateTask({
      id: Date.now(),
      title,
      type: 'Follow up',
      accId: primaryAcc?.id || null,
      accName: primaryAcc?.name || '',
      priority: 'Medium',
      status: 'Open',
      dueDate: due.toISOString().split('T')[0],
      createdAt: today,
      source: 'scout',
      notes: stripMarkdown(response).slice(0, 500),
    });
    setTaskAdded(true);
    setTimeout(() => setTaskAdded(false), 1800);
  };

  const handleOpenLedger = () => {
    if (onOpenLedger) onOpenLedger(mentioned);
    else if (onNav) onNav('ledger');
  };

  const btn = (key, label, onClick, accent=T.cyan, flashColor) => (
    <button key={key} onClick={onClick}
      style={{ ...mono, fontSize:10, padding:'3px 9px', background: flashColor ? `${flashColor}18` : 'transparent', border:`1px solid ${flashColor || accent}66`, color: flashColor || accent, borderRadius:3, cursor:'pointer', letterSpacing:'0.04em', whiteSpace:'nowrap' }}>
      {label}
    </button>
  );

  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:10, paddingTop:10, borderTop:`1px solid ${T.neon}22` }}>
      {mentioned.map(acc =>
        btn(`view-${acc.id}`, `→ ${acc.name}`, () => onNav?.('accounts', acc.id))
      )}
      {showForecastCopy && btn('copy-slack', copied ? '✓ Copied' : '⎘ Copy for Slack', handleCopySlack, T.cyan, copied ? '#4ade80' : undefined)}
      {showRankNav && btn('open-ledger', '→ Open in Ledger', handleOpenLedger)}
      {showAddTask && onCreateTask && btn('add-task', taskAdded ? '✓ Task added' : '+ Add Task', handleAddTask, T.cyan, taskAdded ? '#4ade80' : undefined)}
    </div>
  );
}
