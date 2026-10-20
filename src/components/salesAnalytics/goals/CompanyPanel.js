import { useState, useEffect, useCallback } from 'react';
import { SA, SA_TYPE } from '../theme';
import { goalsApi } from './goalsApi';
import SidePanel from '../SidePanel';
import OwnerPill from '../OwnerPill';
import TypeChip from './TypeChip';
import CompanyActions from './CompanyActions';
import { eventText } from './partners/activityTimeline';
import { labelStyle, subStyle, numStyle, Chip, Btn, ErrorNote, memberLookup } from './goalsUi';
import { CHANNEL_LABEL } from '../../../constants/salesChannels';
import { prioritySetLabel } from './companiesModel';
import { stageLabel } from './companyPanelModel';

// sales-ia-v2 P4 - the one side panel for every Pipeline row (partner,
// employer, target, Apollo-only, visitor). Header: type · channel · stage ·
// priority · owner · team · last touch. Then the action bar (Members), then
// the body from GET goals/company: next step, open to-dos, waiting on them,
// website visits, signals, last notes and touches, people, research,
// decisions and terms, and Open full card. `row` is the board row; every
// write reloads the board (onChanged) and this body (version).
const POLL_MS = 3000;
const md = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
const when = at => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const text = { ...SA_TYPE.body, fontSize: 13, color: SA.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const line = { display: 'flex', gap: 10, fontSize: 13, alignItems: 'baseline' };
const dim = { ...subStyle, fontSize: 13 };
const money = c => (c == null ? '' : `$${Number(c).toFixed(3)}`);
const RESEARCH_FIELDS = [['summary', 'Summary'], ['size', 'Scale'], ['hq_city', 'HQ'], ['recent_news', 'Recent news'], ['housing_perk', 'Housing perk'], ['why_homelover', 'Why us'], ['first_angle', 'First angle'], ['watch_outs', 'Watch-outs'], ['titles', 'Titles to approach']];

function Section({ label, count, children, testId }) {
  return (
    <div data-section={testId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={labelStyle}>{label}{count != null ? <span style={{ ...numStyle, marginLeft: 6, color: SA.soft }}>{count}</span> : null}</span>
      {children}
    </div>
  );
}

export default function CompanyPanel({ businessId, row, canEdit, members, meId, onStar, onPatch, onChanged, onToast, onConvert, onClose, onOpenFull }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const running = detail?.research?.runs?.[0]?.status === 'running';
  useEffect(() => {
    let live = true;
    goalsApi.companyDetail(businessId, row.type, row.id).then(d => { if (live) { setDetail(d); setError(''); } }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId, row.type, row.id, version]);
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setVersion(v => v + 1), POLL_MS);
    return () => clearInterval(t);
  }, [running]);
  const changed = useCallback(() => { setVersion(v => v + 1); onChanged(); }, [onChanged]);

  const r = detail?.record;
  const lookup = memberLookup(members);
  const latest = detail?.research?.runs?.[0] || null;
  const result = latest?.status === 'done' ? latest.result : null;
  const fullLabel = row.type === 'visitor' ? 'Open visitor report →' : row.type === 'apollo' ? 'Open in Companies →' : row.type === 'target' ? 'Open in Tasks →' : 'Open full card →';
  return (
    <SidePanel label={row.name} onClose={onClose} width={560}>
      <div data-company-panel={row.type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <p style={{ ...SA_TYPE.cardTitle, color: SA.text, margin: 0, overflowWrap: 'anywhere' }}>{row.name}</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <TypeChip row={row} style={{ height: 24 }} />
            {row.channel && row.channel !== 'unknown' && <Chip title="Channel">{CHANNEL_LABEL[row.channel]}</Chip>}
            <Chip title="Stage">{stageLabel(row)}</Chip>
            {(row.priority != null || row.not_a_fit) && <Chip title={prioritySetLabel(row)}>{prioritySetLabel(row)}</Chip>}
            {row.owner && <Chip title="Owner">{row.owner}</Chip>}
            {row.owner_team && <OwnerPill row={row} style={{ height: 24 }} />}
            <Chip title="Last touch">{row.last_touch_at ? `Touched ${md(row.last_touch_at)}` : 'No touch yet'}</Chip>
          </div>
        </div>
        <button type="button" aria-label="Close panel" onClick={onClose} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: SA.muted, fontSize: 18, lineHeight: 1, flex: 'none' }}>×</button>
      </div>

      {canEdit
        ? <CompanyActions businessId={businessId} row={row} members={members} meId={meId} onStar={onStar} onPatch={onPatch} onChanged={changed} onToast={onToast} onConvert={onConvert} onClose={onClose} />
        : <p style={{ ...SA_TYPE.body, fontSize: 12, color: SA.muted, margin: 0 }}>You have view access, so this is read-only.</p>}

      {error && <ErrorNote message={error} />}
      {!detail && !error && <span style={dim}>Loading…</span>}
      {detail && (
        <>
          {r.next_step !== undefined && <Section label="Next step"><div style={text}>{r.next_step || '—'}{r.next_step_due ? <span style={{ ...dim, marginLeft: 8 }}>due {md(r.next_step_due)}</span> : null}</div></Section>}
          <Section label="Open to-dos" count={detail.todos.length} testId="todos">
            {!detail.todos.length && <span style={dim}>None open.</span>}
            {detail.todos.map(t => <div key={t.id} style={line}><span style={{ ...numStyle, color: SA.muted, minWidth: 48 }}>{t.due_date ? md(t.due_date) : '—'}</span><span style={{ ...text, flex: 1 }}>{t.text}</span><span style={dim}>{t.owner ? t.owner.split(' ')[0] : 'Unassigned'}</span></div>)}
          </Section>
          <Section label="Waiting on them" count={detail.waiting.length} testId="waiting">
            {!detail.waiting.length && <span style={dim}>Nothing owed.</span>}
            {detail.waiting.map(w => <div key={w.id} style={line}><span style={{ ...numStyle, color: SA.muted, minWidth: 48 }}>{w.due_date ? md(w.due_date) : '—'}</span><span style={{ ...text, flex: 1 }}>{w.waiting_on ? `${w.waiting_on} · ` : ''}{w.text}</span></div>)}
          </Section>
          <Section label="Website visits" count={detail.visits.length} testId="visits">
            {!detail.visits.length && <span style={dim}>No visits pulled.</span>}
            {detail.visits.map(v => <div key={v.id} style={line}><span style={{ ...numStyle, color: SA.muted, minWidth: 48 }}>{md(v.last_visit || v.pulled_on)}</span><span style={{ ...text, flex: 1 }}>{v.visits_7d != null ? `${v.visits_7d} visits (7 d)` : 'visited'}{v.priority ? ` · ${v.priority}` : ''}{v.top_paths.length ? ` · ${v.top_paths.join(', ')}` : ''}</span></div>)}
          </Section>
          <Section label="Signals" count={detail.signals.length} testId="signals">
            {!detail.signals.length && <span style={dim}>None.</span>}
            {detail.signals.map(s => <div key={s.id} style={line}><span style={{ ...numStyle, color: SA.muted, minWidth: 48 }}>{md(s.signal_week || s.created_at)}</span><span style={{ ...text, flex: 1 }}>{s.signal || s.source}{s.why_now ? <span style={{ display: 'block', color: SA.soft, fontSize: 12 }}>Why now: {s.why_now}</span> : null}</span><span style={dim}>{s.status}</span></div>)}
          </Section>
          <Section label="Last notes & touches" count={detail.recent.length} testId="recent">
            {!detail.recent.length && <span style={dim}>Nothing yet.</span>}
            {detail.recent.map(e => <div key={e.id} style={line}><span style={{ ...numStyle, color: SA.muted, minWidth: 48 }}>{when(e.at)}</span><span style={{ ...text, flex: 1 }}>{e.text || eventText(e, lookup)}{e.event === 'touch' && e.note ? <span style={{ display: 'block', color: SA.soft, fontSize: 12 }}>{e.note}</span> : null}</span></div>)}
          </Section>
          <Section label="People" count={detail.people.length} testId="people">
            {!detail.people.length && <span style={dim}>None on file.</span>}
            {detail.people.map(p => <div key={p.id || p.name} style={line}><span style={{ ...text, flex: 1 }}>{p.name}{p.title ? ` · ${p.title}` : ''}</span>{p.linkedin_url && <a href={p.linkedin_url} target="_blank" rel="noreferrer" style={{ color: SA.link, fontSize: 12, textDecoration: 'none' }}>LinkedIn ↗</a>}</div>)}
          </Section>
          {detail.research && (
            <Section label="Research" testId="research">
              <div data-research-card style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span role="status" style={dim}>{running ? 'Researching…' : !latest ? 'None yet - Research runs one Claude call.' : latest.status === 'error' ? `Failed ${when(latest.created_at)}: ${latest.error}` : `${when(latest.created_at)}${latest.cost_usd != null ? ` · ${money(latest.cost_usd)}` : ''} · ${detail.research.today}/${detail.research.cap} today`}</span>
                {result && RESEARCH_FIELDS.filter(([k]) => result[k]).map(([k, label]) => <div key={k} style={line}><span style={{ ...labelStyle, minWidth: 96 }}>{label}</span><span style={{ ...text, flex: 1 }}>{result[k]}</span></div>)}
                {result?.domain && <div style={line}><span style={{ ...labelStyle, minWidth: 96 }}>Site</span><a href={result.website || `https://${result.domain}`} target="_blank" rel="noreferrer" style={{ color: SA.link, fontSize: 13, textDecoration: 'none' }}>{result.domain}</a></div>}
              </div>
            </Section>
          )}
          {(detail.decisions.length > 0 || detail.terms.length > 0) && (
            <Section label="Decisions & terms" testId="decisions">
              {detail.decisions.map((d, i) => <div key={`d${i}`} style={line}><span style={{ ...numStyle, color: SA.muted, minWidth: 48 }}>{when(d.at)}</span><span style={{ ...text, flex: 1 }}>{d.text}</span></div>)}
              {detail.terms.map((t, i) => <div key={`t${i}`} style={text}>{t}</div>)}
            </Section>
          )}
          {r.evidence && <Section label="Evidence"><div style={text}>{r.evidence}</div></Section>}
          {r.research_notes && <Section label="Research notes"><div style={text}>{r.research_notes}</div></Section>}
          {r.notes && <Section label="Notes"><div style={text}>{r.notes}</div></Section>}
          {row.type === 'apollo' && <Section label="Apollo"><div style={text}>Sequenced since {md(r.first_sequenced_at)}{r.employees != null ? ` · ${r.employees.toLocaleString('en-US')} employees` : ''}</div></Section>}
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 8 }}>
        <Btn style={{ height: 40 }} onClick={onOpenFull}>{fullLabel}</Btn>
        <Btn style={{ height: 40, marginLeft: 'auto' }} onClick={onClose}>Close</Btn>
      </div>
    </SidePanel>
  );
}
