import { useState, useEffect, useRef } from 'react';
import { C, mono } from '../constants/colors';
import ScoutCommandBar from './ScoutCommandBar';
import DailyDigest from './DailyDigest';
import SalesCalendarWidget from './CalendarWidget';
import { daysSinceIso } from '../utils/dates';
import { MODELS } from '../config/models';

const daysSince = (dt) => daysSinceIso(dt) ?? 999;
const TIER_C = { Gold: C.gold, Silver: C.tin, Tin: C.mut, Slag: C.red };

function Section({ title, count, color = C.mut, children, empty }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <p style={{ ...mono, margin: 0, fontSize: 11, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</p>
        <span style={{ ...mono, fontSize: 11, color: count > 0 ? color : C.dim }}>{count}</span>
      </div>
      {count === 0
        ? <p style={{ ...mono, fontSize: 12, color: C.dim, margin: 0, padding: '10px 12px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7 }}>{empty}</p>
        : children}
    </div>
  );
}

function SmallRow({ acc, badge, badgeColor, onNav }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', background: C.card, border: `1px solid ${badgeColor}22`, borderRadius: 7, marginBottom: 5 }}>
      <span style={{ ...mono, fontSize: 10, padding: '1px 6px', borderRadius: 3, background: `${badgeColor}18`, border: `1px solid ${badgeColor}33`, color: badgeColor, flexShrink: 0 }}>{badge}</span>
      <p style={{ ...mono, margin: 0, fontSize: 12, color: C.txt, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.name}</p>
      <span style={{ ...mono, fontSize: 11, color: C.dim, flexShrink: 0 }}>{daysSince(acc.last) < 999 ? `${daysSince(acc.last)}d` : '—'}</span>
      <button onClick={() => onNav?.('accounts', acc.id)} style={{ ...mono, fontSize: 10, padding: '2px 7px', background: 'transparent', border: `1px solid ${C.brd}`, color: C.dim, borderRadius: 3, cursor: 'pointer', flexShrink: 0 }}>Open →</button>
    </div>
  );
}

export default function BdrCommandCenter({
  accounts = [], tasks = [], frontier = [], activeUser = null,
  firstName = 'there', onUpdateAccount, onNav, setTasks, teamUsers = [],
  compliance = {}, calendarEvents = [],
}) {
  const myName = activeUser?.name || firstName;
  const myFirst = myName.split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : 'afternoon';
  const today = new Date().toISOString().split('T')[0];

  const onUpdateTask = (id, updates) =>
    setTasks && setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));

  const myFrontier = frontier.filter(f =>
    f.assignedTo === myName || f.assignedToId === activeUser?.id
  );
  const myAssigned = myFrontier
    .map(f => ({ fEntry: f, acc: accounts.find(a => a.name.toLowerCase() === f.name.toLowerCase()) }))
    .filter(x => x.acc)
    .sort((a, b) => {
      const order = { 'Meeting Booked': 0, 'Positive Reply': 1, 'Outbounded': 2, 'Cold': 3 };
      return (order[a.fEntry.status] ?? 9) - (order[b.fEntry.status] ?? 9);
    });

  const assignedNames = new Set(myFrontier.map(f => f.name.toLowerCase()));

  // D — Diamonds in the Rough: Gold/Silver, not in Frontier, not active pipeline, 14+ days untouched
  const diamonds = accounts
    .filter(a =>
      (a.tier === 'Gold' || a.tier === 'Silver') &&
      (!a.stage || a.stage === 'Prospecting') &&
      !assignedNames.has(a.name.toLowerCase()) &&
      daysSince(a.last) >= 14
    )
    .sort((a, b) => {
      const t = { Gold: 0, Silver: 1 };
      return (t[a.tier] ?? 2) - (t[b.tier] ?? 2) || daysSince(b.last) - daysSince(a.last);
    })
    .slice(0, 8);

  // C — Today's Tasks assigned to Casey
  const myTasks = tasks.filter(t =>
    t.status !== 'Done' && t.status !== 'Completed' &&
    (t.assigneeId === activeUser?.id || t.assignee === myName || t.assignee === myFirst)
  );

  // E — Territory Alerts: 14+ days stale, not in my frontier
  const staleAlerts = accounts
    .filter(a =>
      daysSince(a.last) >= 14 &&
      (!a.stage || a.stage === 'Prospecting') &&
      !assignedNames.has(a.name.toLowerCase())
    )
    .sort((a, b) => daysSince(b.last) - daysSince(a.last))
    .slice(0, 6);

  // E — At-risk: 90+ days no activity (any stage)
  const atRisk90 = accounts
    .filter(a => daysSince(a.last) >= 90)
    .sort((a, b) => daysSince(b.last) - daysSince(a.last))
    .slice(0, 6);

  // F — Consider Dropping: Slag tier or Closed Lost
  const dropCandidates = accounts
    .filter(a => a.tier === 'Slag' || a.stage === 'Closed Lost' || a.stage === 'Disqualified')
    .slice(0, 6);

  const alertCount = new Set([...staleAlerts.map(a => a.id), ...atRisk90.map(a => a.id)]).size;

  // Scout shortcuts — auto-fire 3 queries on mount
  const [scoutCards, setScoutCards] = useState(null); // null | 'loading' | [{query, results, answer}]
  const scoutFired = useRef(false);

  useEffect(() => {
    if (scoutFired.current || accounts.length < 3) return;
    scoutFired.current = true;
    setScoutCards('loading');
    const now = Date.now();
    const allCompliance = JSON.parse(localStorage.getItem('prospector_compliance') || '{}');
    const context = {
      role: activeUser?.role || 'BDR',
      name: activeUser?.name || myFirst,
      totalAccounts: accounts.length,
      accounts: accounts.map(acc => ({
        id: acc.id, name: acc.name, tier: acc.tier, stage: acc.stage,
        vertical: acc.vert, products: acc.prods,
        daysSinceTouch: acc.last ? Math.floor((now - new Date(acc.last).getTime()) / 86400000) : 999,
        openTasks: tasks.filter(t => t.accId === acc.id && t.status === 'Open').map(t => t.title),
        inFrontier: frontier.some(f => f.name.toLowerCase() === acc.name.toLowerCase()),
        compliance: { prodRequest: (allCompliance[acc.id] || {}).prod_request || 'Not Started' },
      })),
    };
    const QUERIES = [
      { label: 'Gold not in Frontier', q: 'Which Gold accounts are not in my Frontier list and would be good to start prospecting?' },
      { label: '14d+ stale', q: 'Which accounts have not been touched in 14 or more days and need follow-up?' },
      { label: 'Open tasks', q: 'Which accounts assigned to my AE have open tasks I should be aware of or help move forward?' },
    ];
    Promise.all(QUERIES.map(async ({ label, q }) => {
      try {
        const prompt = `You are Scout — a BDR territory assistant.\nROLE: BDR (${myFirst})\nTERRITORY: ${context.totalAccounts} accounts\nACCOUNT DATA:\n${JSON.stringify(context.accounts, null, 2)}\nQUERY: "${q}"\nReturn ONLY valid JSON:\n{"answer":"one sentence","results":[{"account_id":"","account_name":"","tier":"","headline":"","urgency":"high|medium|low","actions":["view_account","draft_email","create_task"]}]}`;
        const res = await fetch('/proxy/anthropic/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: MODELS.STANDARD, max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
        });
        const data = await res.json();
        const text = (data.content?.[0]?.text || '').trim().replace(/```json\n?|```/g, '').trim();
        const parsed = JSON.parse(text);
        return { label, ...parsed };
      } catch { return { label, answer: null, results: [] }; }
    })).then(results => setScoutCards(results.filter(r => r.results?.length > 0)));
  }, [accounts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div>
        <p style={{ margin: '0 0 2px', fontSize: 22, fontWeight: 500, color: C.txt }}>Good {greeting}, {myFirst}</p>
        <p style={{ ...mono, margin: 0, fontSize: 13, color: C.mut }}>
          {accounts.length} accounts in territory · {myAssigned.length} assigned to you
        </p>
      </div>

      {/* A — Morning Brief */}
      <DailyDigest
        accounts={accounts}
        tasks={tasks}
        firstName={myFirst}
        onNav={onNav}
        onUpdateTask={onUpdateTask}
      />

      {/* B — Calendar */}
      <SalesCalendarWidget
        accounts={accounts}
        onNav={onNav}
        tasks={tasks}
        authError={localStorage.getItem('prospector_gmail_auth_error') || null}
        onCreateTask={t => setTasks && setTasks(prev => [{ ...t, source: t.source || 'calendar' }, ...prev])}
        onUpdateAccount={onUpdateAccount}
      />

      {/* C — Today's Tasks */}
      <Section title="Today's Tasks" count={myTasks.length} color={C.blue} empty="No open tasks assigned to you.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {myTasks.map(t => {
            const overdue = t.dueDate && t.dueDate < today;
            const dueToday = t.dueDate === today;
            const dc = overdue ? C.red : dueToday ? C.gold : C.mut;
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: C.card, border: `1px solid ${overdue ? C.red + '33' : C.brd}`, borderRadius: 7 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</p>
                  {(t.accName || t.dueDate) && (
                    <p style={{ ...mono, margin: 0, fontSize: 11, color: dc }}>
                      {t.accName}{t.dueDate ? `${t.accName ? ' · ' : ''}${overdue ? '⚠ overdue · ' : ''}${t.dueDate}` : ''}
                    </p>
                  )}
                </div>
                <span style={{ ...mono, fontSize: 10, padding: '1px 6px', borderRadius: 3, background: t.priority === 'High' ? `${C.red}18` : `${C.mut}18`, border: `1px solid ${t.priority === 'High' ? C.red : C.brd}`, color: t.priority === 'High' ? C.red : C.mut, flexShrink: 0 }}>
                  {t.priority || 'Medium'}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Scout shortcuts */}
      {scoutCards === 'loading' && (
        <div style={{ ...mono, fontSize: 11, color: C.dim, padding: '6px 0' }}>⟳ Loading Scout insights…</div>
      )}
      {Array.isArray(scoutCards) && scoutCards.map((card, ci) => (
        <div key={ci} style={{ background: '#0a0f1a', border: `1px solid #1e293b`, borderLeft: `3px solid #2dd4bf`, borderRadius: 7, padding: '10px 14px' }}>
          <p style={{ ...mono, margin: '0 0 6px', fontSize: 10, color: '#2dd4bf', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{card.label}</p>
          {card.answer && <p style={{ ...mono, margin: '0 0 8px', fontSize: 11, color: '#94a3b8' }}>{card.answer}</p>}
          {(card.results || []).slice(0, 4).map((r, i) => {
            const acc = accounts.find(a => String(a.id) === String(r.account_id) || a.name === r.account_name);
            const tc = r.tier === 'Gold' ? C.gold : r.tier === 'Silver' ? '#94a3b8' : C.dim;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: i === 0 ? 'none' : `1px solid #1e293b22` }}>
                {r.tier && <span style={{ ...mono, fontSize: 9, color: tc, border: `1px solid ${tc}44`, borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>{r.tier}</span>}
                <span style={{ fontSize: 12, color: '#f1f5f9', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.account_name}</span>
                <span style={{ ...mono, fontSize: 10, color: '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.headline}</span>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {(r.actions || ['view_account']).slice(0, 2).map(action => (
                    <button key={action} onClick={() => { if (acc) onNav?.('accounts', acc.id); }}
                      style={{ ...mono, fontSize: 9, padding: '2px 7px', background: 'transparent', border: `1px solid #2dd4bf33`, color: '#2dd4bf', borderRadius: 3, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#2dd4bf14'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >{{ view_account: 'View →', draft_email: 'Draft Email', create_task: 'Task' }[action] || action}</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* D — Diamonds in the Rough */}
      <Section title="Diamonds in the Rough" count={diamonds.length} color={C.gold} empty="No unworked Gold/Silver accounts right now.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {diamonds.map(acc => (
            <div key={acc.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, marginBottom: 5 }}>
              <span style={{ ...mono, fontSize: 10, padding: '1px 6px', borderRadius: 3, background: `${TIER_C[acc.tier] || C.dim}18`, border: `1px solid ${TIER_C[acc.tier] || C.dim}44`, color: TIER_C[acc.tier] || C.dim, flexShrink: 0 }}>{acc.tier}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.name}</p>
                <p style={{ ...mono, margin: 0, fontSize: 11, color: C.mut }}>{daysSince(acc.last) < 999 ? `${daysSince(acc.last)}d since last touch` : 'No activity'}</p>
              </div>
              <button onClick={() => onNav?.('accounts', acc.id)} style={{ ...mono, fontSize: 11, padding: '3px 9px', background: 'transparent', border: `1px solid ${C.gold}44`, color: C.gold, borderRadius: 4, cursor: 'pointer', flexShrink: 0 }}>Open →</button>
            </div>
          ))}
        </div>
      </Section>

      {/* E — Territory Alerts */}
      <Section title="Territory Alerts" count={alertCount} color={C.orange} empty="No territory alerts.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {staleAlerts.map(acc => (
            <SmallRow key={acc.id} acc={acc} badge="14d+" badgeColor={C.orange} onNav={onNav} />
          ))}
          {atRisk90
            .filter(a => !staleAlerts.find(s => s.id === a.id))
            .map(acc => (
              <SmallRow key={acc.id} acc={acc} badge="At Risk" badgeColor={C.red} onNav={onNav} />
            ))
          }
        </div>
      </Section>

      {/* F — Consider Dropping */}
      <Section title="Consider Dropping" count={dropCandidates.length} color={C.red} empty="No accounts flagged for removal.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {dropCandidates.map(acc => (
            <SmallRow key={acc.id} acc={acc} badge={acc.tier === 'Slag' ? 'Slag' : acc.stage || 'Lost'} badgeColor={C.red} onNav={onNav} />
          ))}
        </div>
      </Section>

      {/* G — Scout (unified command bar — same surface as AE home) */}
      <ScoutCommandBar
        accounts={accounts}
        onNav={onNav}
        onCreateTask={t=>setTasks&&setTasks(prev=>[t,...prev])}
        activeUser={activeUser}
      />
    </div>
  );
}
