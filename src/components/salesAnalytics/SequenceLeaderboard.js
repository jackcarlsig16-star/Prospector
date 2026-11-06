import { useState, useMemo } from 'react';
import { SA } from './theme';
import { formatValue } from './computeMetric';
import { cohortColor, AUDIENCE_LABELS, audienceColor } from './palette';
import { COHORTS } from './metrics.registry';
import { buildSequenceRows } from './sequenceRows';
import { BOUNCE_ALERT_THRESHOLD, BOUNCE_ALERT_MIN_DELIVERED } from './alertRules';
import { setSequenceAudience } from './salesApi';
import { exportWidgetCsv } from './exportCsv';
import DataTable from '../../ui/DataTable';
import Segmented from '../../ui/Segmented';
import { ToggleChip } from '../../ui/Chip';
import { numStyle } from './goals/goalsUi';

// dashboard-v3 Stage 4 (M) - Sequences on the kit DataTable, HomeLover's own only (a sequence sent from a mailbox the
// workspace does not own - Brad's - or with no stored send from one is left out; GET goals/sequence-steps says which). Cohort chips with counts ·
// Running / Paused / All · audience · search · the summary line (delivered unique = Apollo's lifetime counters, messages
// = the stored daily counts, open / reply / bounce weighted over the shown rows) · Group by Cohort / Sender / None.
// Columns Sequence · Cohort · Sender (the mailbox's name, never an address) · Steps · Delivered ▼ · Open · Reply · Bounce
// (red from 5 %, BOUNCE_ALERT_THRESHOLD, once ≥ 20 delivered) · Health (the existing rule: Apollo's performing-poorly
// flag = Underperforming, under 20 delivered = Low volume, else OK). A row expands to its per-step rows (lifetime sums
// over the daily counts, A6: step · delivered · open % · bounce % · a bar against step 1) and, for a Member, the
// audience picker (the one write here: sales_sequence_tags). Lifetime, all of it.
const AUDIENCE_OPTIONS = ['employer', 'membership', 'channel_partner'];
const STATUS = [['active', 'Running'], ['inactive', 'Paused'], ['all', 'All']];
const GROUPS = [['cohort', 'Cohort'], ['sender', 'Sender'], ['none', 'None']];
const pct = v => formatValue(v, 'percent');
const num = v => formatValue(v, 'number');
export const healthOf = r => (r.isPerformingPoorly ? 'Underperforming' : r.delivered != null && r.delivered >= BOUNCE_ALERT_MIN_DELIVERED ? 'OK' : 'Low volume');

export function summarize(rows, steps) {
  const t = rows.reduce((a, r) => { a.delivered += r.delivered || 0; a.opened += r.counters.unique_opened || 0; a.replied += r.counters.unique_replied || 0; a.bounced += r.counters.unique_bounced || 0; a.messages += steps?.sequences?.[r.id]?.messages || 0; return a; }, { delivered: 0, opened: 0, replied: 0, bounced: 0, messages: 0 });
  return { ...t, open_rate: t.delivered ? t.opened / t.delivered : null, reply_rate: t.delivered ? t.replied / t.delivered : null, bounce_rate: t.delivered + t.bounced ? t.bounced / (t.delivered + t.bounced) : null };
}

function StepRows({ steps }) {
  const first = steps[0]?.delivered || 0;
  return (
    <table data-step-rows style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
      <tbody>
        {steps.map(s => (
          <tr key={s.step} data-step={s.step}>
            <td style={{ padding: '4px 10px 4px 24px', color: SA.muted, width: 160 }}>{s.step ? `Step ${s.step}` : 'No step'}</td>
            <td style={{ padding: '4px 10px', textAlign: 'right', ...numStyle, color: SA.text, width: 90 }} data-step-delivered>{num(s.delivered)}</td>
            <td style={{ padding: '4px 10px', textAlign: 'right', ...numStyle, color: SA.soft, width: 76 }}>{pct(s.open_rate)}</td>
            <td style={{ padding: '4px 10px', textAlign: 'right', ...numStyle, color: SA.soft, width: 76 }}>{s.reply_rate == null ? '—' : pct(s.reply_rate)}</td>
            <td style={{ padding: '4px 10px', textAlign: 'right', ...numStyle, color: s.bounce_rate != null && s.bounce_rate >= BOUNCE_ALERT_THRESHOLD ? SA.bad : SA.soft, width: 80 }}>{pct(s.bounce_rate)}</td>
            <td style={{ padding: '4px 10px' }}>
              <span role="img" aria-label={`${num(s.delivered)} delivered, ${first ? Math.round((s.delivered / first) * 100) : 0}% of step 1`} style={{ display: 'block', height: 4, borderRadius: 999, background: 'rgba(120,130,144,.25)', position: 'relative', overflow: 'hidden' }}>
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${first ? Math.min(100, Math.round((s.delivered / first) * 100)) : 0}%`, background: SA.accent, borderRadius: 999 }} />
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SequenceLeaderboard({ businessId, allRows, entities, steps, canEdit = true, widgetId = 'sequence_leaderboard', onDataChanged }) {
  const [cohorts, setCohorts] = useState(() => new Set(COHORTS));
  const [audience, setAudience] = useState('all');
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState('cohort');
  const [sort, setSort] = useState({ id: 'delivered', dir: 'desc' });
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState('');

  // Stage 5: own = the steps route says so; a sequence it does not list (no stored send from a workspace mailbox) is out.
  const own = useMemo(() => (steps ? buildSequenceRows(allRows, entities).filter(r => steps.sequences?.[r.id]?.own === true) : []), [allRows, entities, steps]);
  const shown = own.filter(r => (cohorts.has(r.cohort) || r.cohort === 'Unknown') && (audience === 'all' || r.audience === audience)
    && (status === 'all' || (status === 'active' ? r.active !== false : r.active === false)) && (!search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase())));
  const cohortCount = c => own.filter(r => r.cohort === c && (status === 'all' || (status === 'active' ? r.active !== false : r.active === false))).length;
  const running = own.filter(r => r.active !== false).length;
  const sum = summarize(shown, steps);
  const senderOf = r => steps?.sequences?.[r.id]?.sender_label || '—';
  const groupKey = r => (groupBy === 'cohort' ? r.cohort : groupBy === 'sender' ? senderOf(r) : 'All');
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of shown) { const k = groupKey(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([k, rows]) => ({ id: k, header: groupBy === 'none' ? `${rows.length} sequence${rows.length === 1 ? '' : 's'}` : `${k} · ${rows.length}`, rows }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.map(r => r.id).join(','), groupBy, steps]);

  const setAud = async (r, a) => {
    setSaving(r.id); setError('');
    try { await setSequenceAudience(businessId, r.id, a); onDataChanged?.(); } catch (e) { setError(e.message); } finally { setSaving(null); }
  };
  const exportCsv = () => exportWidgetCsv(widgetId, shown, [
    { label: 'Sequence', key: 'name' }, { label: 'Cohort', key: 'cohort' }, { label: 'Sender', value: senderOf }, { label: 'Status', value: r => (r.active === false ? 'Paused' : 'Running') },
    { label: 'Audience', value: r => AUDIENCE_LABELS[r.audience] || r.audience }, { label: 'Steps', value: r => r.numSteps ?? '' }, { label: 'Delivered', value: r => r.delivered ?? '' },
    { label: 'Open %', value: r => pct(r.openRate) }, { label: 'Reply %', value: r => pct(r.replyRate) }, { label: 'Bounce %', value: r => pct(r.bounceRate) }, { label: 'Health', value: healthOf },
  ]);
  const meaningful = r => r.delivered != null && r.delivered >= BOUNCE_ALERT_MIN_DELIVERED;
  const columns = [
    { id: 'name', label: 'Sequence', sticky: true, detail: true, minWidth: 260, sortValue: r => r.name, title: r => r.name, render: r => <span style={{ fontWeight: 500, color: r.active === false ? SA.muted : SA.text }}>{r.name}{r.active === false ? ' · paused' : ''}</span> },
    { id: 'cohort', label: 'Cohort', width: 120, sortValue: r => r.cohort, render: r => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: SA.muted }}><i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: cohortColor(r.cohort), display: 'inline-block' }} />{r.cohort}</span> },
    { id: 'sender', label: 'Sender', width: 90, sortValue: senderOf, render: r => <span style={{ fontSize: 12, color: SA.muted }}>{senderOf(r)}</span> },
    { id: 'steps', label: 'Steps', width: 56, sortValue: r => r.numSteps, render: r => <span style={{ ...numStyle, display: 'block', textAlign: 'right', color: SA.muted }}>{r.numSteps ?? '—'}</span> },
    { id: 'delivered', label: 'Delivered', width: 90, sortValue: r => r.delivered, render: r => <span data-delivered style={{ ...numStyle, display: 'block', textAlign: 'right', color: SA.text, fontWeight: 500 }}>{num(r.delivered)}</span> },
    { id: 'open', label: 'Open', width: 76, sortValue: r => r.openRate, render: r => <span style={{ ...numStyle, display: 'block', textAlign: 'right' }}>{pct(r.openRate)}</span> },
    { id: 'reply', label: 'Reply', width: 76, sortValue: r => r.replyRate, render: r => <span style={{ ...numStyle, display: 'block', textAlign: 'right' }}>{pct(r.replyRate)}</span> },
    { id: 'bounce', label: 'Bounce', width: 80, sortValue: r => r.bounceRate, render: r => <span data-bounce={meaningful(r) && r.bounceRate >= BOUNCE_ALERT_THRESHOLD ? 'bad' : 'ok'} style={{ ...numStyle, display: 'block', textAlign: 'right', fontWeight: 600, color: !meaningful(r) ? SA.faint : r.bounceRate >= BOUNCE_ALERT_THRESHOLD ? SA.bad : SA.soft }}>{pct(r.bounceRate)}</span> },
    { id: 'health', label: 'Health', width: 130, sortValue: healthOf, render: r => { const h = healthOf(r); return <span data-health={h} style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 999, border: `1px solid ${h === 'Underperforming' ? SA.bad : SA.border}`, color: h === 'Underperforming' ? SA.bad : h === 'OK' ? SA.soft : SA.faint, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</span>; } },
  ];
  const renderDetail = r => {
    const st = steps?.sequences?.[r.id]?.steps || [];
    return (
      <div data-sequence-detail={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '6px 0' }}>
        {st.length ? <StepRows steps={st} /> : <span style={{ fontSize: 12, color: SA.muted, paddingLeft: 24 }}>No stored sends for this sequence yet.</span>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 24, fontSize: 12, color: SA.muted, flexWrap: 'wrap' }}>
          <span>Audience</span>
          {canEdit
            ? AUDIENCE_OPTIONS.map(a => <ToggleChip key={a} pressed={r.audience === a} disabled={saving === r.id} onClick={() => r.audience !== a && setAud(r, a)}><i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: audienceColor(a), display: 'inline-block' }} />{AUDIENCE_LABELS[a]}</ToggleChip>)
            : <span style={{ color: audienceColor(r.audience) }}>{AUDIENCE_LABELS[r.audience] || r.audience}</span>}
          {r.counters.unique_clicked != null && <span>· clicks {num(r.counters.unique_clicked)}</span>}
          {r.counters.unique_unsubscribed != null && <span>· unsubscribed {num(r.counters.unique_unsubscribed)}</span>}
        </div>
      </div>
    );
  };
  const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };
  return (
    <section aria-labelledby="h-sequences" data-sequences={shown.length} style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h2 id="h-sequences" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: SA.text }}>Sequences</h2>
        <span style={{ fontSize: 12, color: SA.muted }}>{running} running of {own.length} · HomeLover's own · lifetime · <button type="button" className="ui-link" onClick={exportCsv}>Export CSV</button></span>
      </div>
      <div className="no-print" role="group" aria-label="Cohort" style={{ ...row, gap: 6 }}>
        <span className="ui-group-label" aria-hidden="true" style={{ width: 56 }}>Cohort</span>
        <ToggleChip pressed={cohorts.size === COHORTS.length} count={own.filter(r => status === 'all' || (status === 'active' ? r.active !== false : r.active === false)).length} onClick={() => setCohorts(new Set(COHORTS))}>All</ToggleChip>
        {COHORTS.map(c => <ToggleChip key={c} data-cohort-chip={c} pressed={cohorts.size !== COHORTS.length && cohorts.has(c)} count={cohortCount(c)} onClick={() => setCohorts(prev => { const next = prev.size === COHORTS.length ? new Set([c]) : new Set(prev); if (prev.size !== COHORTS.length) { if (next.has(c)) next.delete(c); else next.add(c); } return next.size ? next : new Set(COHORTS); })}><i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: cohortColor(c), display: 'inline-block' }} />{c}</ToggleChip>)}
      </div>
      <div className="no-print" style={{ ...row, gap: 10 }}>
        <Segmented label="Status" items={STATUS.map(([id, label]) => ({ id, label, meta: id === 'all' ? own.length : id === 'active' ? running : own.length - running }))} value={status} onChange={setStatus} />
        <span role="group" aria-label="Audience" style={{ ...row, gap: 6 }}>
          <ToggleChip pressed={audience === 'all'} onClick={() => setAudience('all')}>All</ToggleChip>
          {AUDIENCE_OPTIONS.map(a => <ToggleChip key={a} pressed={audience === a} onClick={() => setAudience(a)}><i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: audienceColor(a), display: 'inline-block' }} />{AUDIENCE_LABELS[a]}</ToggleChip>)}
        </span>
        <input className="ui-input ui-input--sm" aria-label="Search sequences" placeholder="Search name…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 180 }} />
      </div>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <span data-sequences-summary style={{ fontSize: 12, color: SA.muted, ...numStyle }}>
          Delivered <b style={{ color: SA.text }}>{num(sum.delivered)} unique</b> · {num(sum.messages)} messages · Open <b style={{ color: SA.text }}>{pct(sum.open_rate)}</b> · Reply <b style={{ color: SA.text }}>{pct(sum.reply_rate)}</b> · Bounce <b style={{ color: sum.bounce_rate != null && sum.bounce_rate >= BOUNCE_ALERT_THRESHOLD ? SA.bad : SA.text }}>{pct(sum.bounce_rate)}</b>
        </span>
        <span className="no-print" style={{ ...row, gap: 8 }}><span className="ui-group-label" aria-hidden="true">Group by</span><Segmented label="Group by" items={GROUPS.map(([id, label]) => ({ id, label }))} value={groupBy} onChange={setGroupBy} /></span>
      </div>
      {error && <span style={{ fontSize: 12, color: SA.bad }}>⚠ {error}</span>}
      <DataTable label="Sequences" columns={columns} groups={groups} rowKey={r => r.id} sort={sort} onSort={setSort} dense renderDetail={renderDetail} emptyText={own.length ? 'No sequences match the current filters.' : 'No sequence data yet.'} />
    </section>
  );
}
