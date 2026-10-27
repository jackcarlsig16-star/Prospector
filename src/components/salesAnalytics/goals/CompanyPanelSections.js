import { useState } from 'react';
import { SA, SA_TYPE } from '../theme';
import { goalsApi } from './goalsApi';
import { unlinkProspect } from '../huddleApi';
import { eventText } from './partners/activityTimeline';
import { numStyle } from './goalsUi';
import { md, TIMELINE_KIND, linkedinSearchUrl, filterPeople } from './companyPanelFacts';
import { copyFollowUp } from './InterestBand';
import Tag from '../../../ui/Tag';
import Drawer from '../../../ui/Drawer';
import { Link } from '../../../ui/Button';
import { SOURCE_LABEL } from '../../../constants/leadSources';

// company-panel-v2 L6 - the body cards. Each is a card with a label, a count
// pill and at most one link-button. LEFT: Signals & visits · Open to-dos ·
// Waiting on them · Notes & touches. RIGHT: Intel · People, then the cards a
// record has text for. Viewers get no link-buttons. Nothing here renders an
// email or a phone number.
const when = at => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const text = { ...SA_TYPE.body, fontSize: 13, color: SA.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const dim = { fontSize: 13, color: SA.muted };
const date = { ...numStyle, color: SA.muted, fontSize: 13, width: 48, flex: '0 0 48px' };
const row = { display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 24, fontSize: 13 };
const KIND_COLOR = { good: SA.good, warn: SA.warn, link: SA.link, accent: SA.accent };
const money = c => (c == null ? '' : `$${Number(c).toFixed(3)}`);

export function Card({ label, count, hot, action, testId, children }) {
  return (
    <section aria-label={label} data-section={testId} style={{ background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="ui-group-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {label}
          {count != null && <span style={{ ...numStyle, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: 999, background: hot ? `color-mix(in srgb, ${SA.warn} 12%, ${SA.surface2})` : SA.inset, color: hot ? SA.warn : SA.soft, fontSize: 11, fontWeight: 500, letterSpacing: 0, textTransform: 'none' }}>{count}</span>}
        </span>
        {action}
      </div>
      {children}
    </section>
  );
}
const Mini = ({ children, ...rest }) => <button type="button" className="ui-btn ui-btn--tertiary" style={{ height: 24, fontSize: 12 }} {...rest}>{children}</button>;
const Empty = ({ children }) => <span style={dim}>{children}</span>;

export function SignalsCard({ businessId, row, detail, canEdit, onToast, onForm, onChanged, onOpenPeople }) {
  const items = detail.timeline;
  const findWho = async () => {
    if (row.type === 'visitor' || row.type === 'apollo') return onForm('add');
    try { const a = await goalsApi.checkCompanyApollo(businessId, row.type, row.id); onChanged(); onToast({ text: a.people?.length ? `Apollo lists ${a.people.length} people at ${row.name}` : `Apollo lists nobody at ${row.name} yet` }); } catch (e) { onToast({ text: e.message }); }
  };
  const peopleLink = canEdit && onOpenPeople && (row.type === 'partner' || row.type === 'employer') ? <Mini onClick={() => onOpenPeople({ type: row.type, id: row.id, name: row.name })}>Open in People →</Mini> : null;
  return (
    <Card label="Signals & visits" count={items.length} hot={detail.interest?.show} action={peopleLink} testId="signals">
      {!items.length && <Empty>No signals yet.</Empty>}
      {items.map(t => {
        const [word, tone] = TIMELINE_KIND[t.kind] || ['Signal', 'accent'];
        return (
          <div key={`${t.kind}-${t.id || t.at}`} style={row}>
            <span style={date}>{md(t.at)}</span>
            <span style={{ ...text, flex: 1, display: 'inline-flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: KIND_COLOR[tone], flex: 'none', alignSelf: 'center' }} />
              <span style={{ color: KIND_COLOR[tone], fontSize: 11, fontFamily: "'Geist Mono', ui-monospace, monospace", letterSpacing: '.06em', textTransform: 'uppercase' }}>{word}</span>
              <span>{t.text}</span>
            </span>
            {canEdit && t.person && t.kind !== 'opened' && <Mini onClick={() => copyFollowUp({ businessId, row, person: t.person, signal: { text: t.text, at: t.at }, onToast })}>Follow up</Mini>}
            {canEdit && t.kind === 'visited' && <Mini onClick={findWho}>Find who</Mini>}
          </div>
        );
      })}
    </Card>
  );
}

export function TodosCard({ detail, canEdit, onForm }) {
  return (
    <Card label="Open to-dos" count={detail.todos.length} action={canEdit ? <Mini onClick={() => onForm('todo')}>+ Add</Mini> : null} testId="todos">
      {!detail.todos.length && <Empty>None open.</Empty>}
      {detail.todos.map(t => <div key={t.id} style={row}><span style={date}>{t.due_date ? md(t.due_date) : '—'}</span><span style={{ ...text, flex: 1 }}>{t.text}</span><span style={dim}>{t.owner ? t.owner.split(' ')[0] : 'Unassigned'}</span></div>)}
    </Card>
  );
}

export function WaitingCard({ detail }) {
  return (
    <Card label="Waiting on them" count={detail.waiting.length} testId="waiting">
      {!detail.waiting.length && <Empty>Nothing owed.</Empty>}
      {detail.waiting.map(w => <div key={w.id} style={row}><span style={date}>{w.due_date ? md(w.due_date) : '—'}</span><span style={{ ...text, flex: 1 }}>{w.waiting_on ? `${w.waiting_on} · ` : ''}{w.text}</span></div>)}
    </Card>
  );
}

const RECENT_WORD = { touch: 'Touch', note: 'Note', status: 'Stage', undo: 'Undo', stage: 'Stage', todo_done: 'Done' };
export function NotesCard({ detail, canEdit, lookup, onForm }) {
  return (
    <Card label="Notes & touches" count={detail.recent.length} action={canEdit ? <Mini onClick={() => onForm('note')}>+ Note</Mini> : null} testId="recent">
      {!detail.recent.length && <Empty>Nothing yet.</Empty>}
      {detail.recent.map(e => (
        <div key={e.id} style={row}>
          <span style={date}>{when(e.at)}</span>
          <span style={{ fontSize: 10.5, fontFamily: "'Geist Mono', ui-monospace, monospace", letterSpacing: '.06em', textTransform: 'uppercase', color: SA.muted, width: 44, flex: '0 0 44px', paddingTop: 2 }}>{RECENT_WORD[e.event] || e.event}</span>
          <span style={{ ...text, flex: 1 }}>{e.text || eventText(e, lookup)}{e.event === 'touch' && e.note ? <span style={{ display: 'block', color: SA.soft, fontSize: 12 }}>{e.note}</span> : null}</span>
        </div>
      ))}
    </Card>
  );
}

const KV = ({ label, children }) => <><span className="ui-group-label" style={{ paddingTop: 2 }}>{label}</span><div style={{ ...text, minWidth: 0 }}>{children}</div></>;
const MORE_FIELDS = [['mission', 'Mission'], ['positioning', 'Positioning'], ['housing_perk', 'Housing perk'], ['first_angle', 'First angle'], ['watch_outs', 'Watch-outs'], ['titles', 'Titles to approach']];

export function IntelCard({ businessId, row, detail, canEdit, onChanged, onToast }) {
  const [busy, setBusy] = useState('');
  const latest = detail.research?.runs?.[0] || null;
  const running = latest?.status === 'running';
  const result = latest?.status === 'done' ? latest.result : null;
  const site = detail.record.site;
  const act = async (what, fn) => { setBusy(what); try { await fn(); onChanged(); } catch (e) { onToast({ text: e.message }); } finally { setBusy(''); } };
  const refresh = () => act('research', async () => { await goalsApi.runCompanyResearch(businessId, row.type, row.id); onToast({ text: `Researching ${row.name} - one Claude call, about a minute` }); });
  const confirmSite = () => act('site', async () => { await goalsApi.addPartnerDomain(businessId, row.id, { domain: site.domain }); onToast({ text: `${site.domain} confirmed for ${row.name}` }); });
  const status = running ? 'Researching…' : !latest ? 'Not researched yet' : latest.status === 'error' ? `Failed ${when(latest.created_at)}: ${latest.error}` : `Researched ${when(latest.created_at)} · Claude + web${latest.cost_usd != null ? ` · ${money(latest.cost_usd)}` : ''} · ${detail.research.today}/${detail.research.cap} today`;
  const recent = result?.recent?.length ? result.recent : null;
  return (
    <Card label="Intel" testId="research" action={<span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}><span role="status" style={{ fontSize: 12, color: SA.muted }}>{status}</span>{canEdit && !running && <Mini disabled={busy === 'research'} onClick={refresh} title="One Claude call with up to 3 web searches; 5 per company per day">{latest ? 'Refresh' : 'Run research'}</Mini>}</span>}>
      <div data-research-card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!result && !running && <Empty>Research reads the company's own site and one news source, one Claude call.</Empty>}
        {result?.summary && <p style={{ ...text, margin: 0, lineHeight: 1.5 }}>{result.summary}</p>}
        {(result || site) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px' }}>
            {result?.hq_city && <KV label="HQ">{result.hq_city}</KV>}
            {result?.size && <KV label="Size">{result.size}</KV>}
            {result?.sells_to && <KV label="Sells to">{result.sells_to}</KV>}
            {site && <KV label="Site"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><Link href={`https://${site.domain}`} target="_blank" rel="noreferrer">{site.domain} ↗</Link>{site.confirmed ? <Tag color={SA.good}>✓ confirmed</Tag> : canEdit && row.type === 'partner' ? <Mini disabled={busy === 'site'} onClick={confirmSite}>Confirm site</Mini> : null}</span></KV>}
            {result?.why_homelover && <KV label="Why fit">{result.why_homelover}</KV>}
          </div>
        )}
        {(recent || result?.recent_news) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="ui-group-label">Recent</span>
            {recent
              ? recent.map((r, i) => <div key={i} style={row}><span style={date}>{r.month || '—'}</span><span style={{ ...text, flex: 1 }}>{r.text}{r.url ? <> <Link href={r.url} target="_blank" rel="noreferrer">source ↗</Link></> : null}</span></div>)
              : <span style={text}>{result.recent_news}</span>}
          </div>
        )}
        {result && MORE_FIELDS.some(([k]) => result[k]) && (
          <Drawer label="More" summary={MORE_FIELDS.filter(([k]) => result[k]).map(([, l]) => l).join(' · ')}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px' }}>
              {MORE_FIELDS.filter(([k]) => result[k]).map(([k, label]) => <KV key={k} label={label}>{result[k]}</KV>)}
            </div>
          </Drawer>
        )}
      </div>
    </Card>
  );
}

export function PeopleCard({ businessId, row, detail, canEdit, onForm, onChanged, onToast }) {
  const [q, setQ] = useState('');
  const people = filterPeople(detail.people, q);
  const unlink = async p => {
    try { await unlinkProspect(businessId, p.contact_id, row.type === 'partner' ? 'goal' : 'opportunity'); onChanged(); onToast({ text: `${p.name} is no longer linked to ${row.name}` }); } catch (e) { onToast({ text: e.message }); }
  };
  const canUnlink = canEdit && (row.type === 'partner' || row.type === 'employer');
  return (
    <Card label="People" count={detail.people.length} testId="people" action={
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        {detail.people.length > 5 && <input type="search" aria-label="Filter people" placeholder="Filter" value={q} onChange={e => setQ(e.target.value)} className="ui-input" style={{ width: 120, minHeight: 26, height: 26, padding: '0 8px', fontSize: 12 }} />}
        {canEdit && row.type !== 'visitor' && row.type !== 'apollo' && <Mini onClick={() => onForm('contact')}>+ Contact</Mini>}
      </span>}>
      {!detail.people.length && <Empty>{row.type === 'visitor' || row.type === 'apollo' ? 'Nobody on file - Find who checks Apollo.' : 'None on file.'}</Empty>}
      {people.map(p => (
        <div key={p.id || p.name} data-person={p.contact_id || undefined} title={p.note || undefined} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', margin: '0 -8px', borderRadius: 6, background: p.signal ? `color-mix(in srgb, ${SA.warn} 8%, transparent)` : 'transparent', fontSize: 13 }}>
          <span style={{ flex: 1, minWidth: 0, display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <b style={{ color: SA.text, fontWeight: 600 }}>{p.name}</b>
            {p.title ? <span style={{ color: SA.muted }}>· {p.title}</span> : <span style={{ color: SA.muted }}>· no title</span>}
            {p.signal && <Tag color={p.signal.kind === 'reply' ? SA.good : SA.warn}>{p.signal.text}</Tag>}
            {p.source === 'upload' && p.source_kind === 'web_visit' && <Tag color={SA.warn}>{/^Identified visitor/.test(p.note || '') ? 'Identified visitor' : 'Found via visit'}</Tag>}
            {p.source === 'upload' && p.source_kind === 'web_visit' && /reveal to see full name/.test(p.note || '') && <Tag title="Apollo hides the last name until a reveal">reveal to see full name</Tag>}
            {p.source === 'upload' && p.source_kind && p.source_kind !== 'web_visit' && <Tag>{SOURCE_LABEL[p.source_kind] || p.source_kind}</Tag>}
          </span>
          {p.linkedin_url ? <Link href={p.linkedin_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>LinkedIn ↗</Link> : <Link href={linkedinSearchUrl(p.name, row.name)} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: SA.muted }}>Find on LinkedIn</Link>}
          {canUnlink && p.contact_id && <Mini onClick={() => unlink(p)} title="Clears the link; no sync sets it again">Not this company</Mini>}
        </div>
      ))}
      {detail.people.length > 0 && !people.length && <Empty>Nobody matches.</Empty>}
    </Card>
  );
}

export function ExtraCards({ row, detail }) {
  const r = detail.record;
  return (
    <>
      {detail.decision_makers?.length > 0 && <Card label="Decision makers" count={detail.decision_makers.length}>{detail.decision_makers.map((l, i) => <div key={i} style={text}>{l}</div>)}</Card>}
      {(detail.decisions.length > 0 || detail.terms.length > 0) && (
        <Card label="Decisions & terms" testId="decisions">
          {detail.decisions.map((d, i) => <div key={`d${i}`} style={row}><span style={date}>{when(d.at)}</span><span style={{ ...text, flex: 1 }}>{d.text}</span></div>)}
          {detail.terms.map((t, i) => <div key={`t${i}`} style={text}>{t}</div>)}
        </Card>
      )}
      {r.evidence && <Card label="Evidence"><div style={text}>{r.evidence}</div></Card>}
      {r.research_notes && <Card label="Research notes"><div style={text}>{r.research_notes}</div></Card>}
      {r.notes && <Card label="Notes"><div style={text}>{r.notes}</div></Card>}
      {row.type === 'apollo' && <Card label="Apollo"><div style={text}>Sequenced since {md(r.first_sequenced_at)}{r.employees != null ? ` · ${r.employees.toLocaleString('en-US')} employees` : ''}</div></Card>}
    </>
  );
}
