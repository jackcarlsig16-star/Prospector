import { useState, useEffect } from 'react';
import { SA } from '../theme';
import { goalsApi } from '../goals/goalsApi';
import { numStyle, ErrorNote } from '../goals/goalsUi';
import { playbookPrompt, mondayOf } from '../goals/companyPanelModel';
import { markContacted } from '../goals/companyReach';
import { updateProspect } from '../huddleApi';
import Button from '../../../ui/Button';

// people-v2 Stage 2 (P4) - the pinned card under a selected row: the person's email timeline (sent / opened / clicked /
// replied with dates, automated opens and clicks said so - the Huddle's rule), their company's visit line, their notes,
// and the quick menu: Open company · Draft email (the REACH copy bundle - Prospector never sends) · Log call · Add to-do ·
// Mark contacted (company) · Not a fit (a prospect's status, Undo 10 s). Every write goes through the existing paths;
// a person whose company is not in the pipeline gets the reasons, not greyed mysteries. Viewers: Open company only.
const LINK_TYPE = { partner: 'partner', employer: 'opportunity', target: 'target' };
const KIND = { sent: ['Sent', SA.muted], open: ['Opened', SA.link], click: ['Clicked', SA.warn], reply: ['Replied', SA.good] };
const LA = 'America/Los_Angeles';
const when = iso => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: LA, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'time unknown');
const mdy = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: LA });
const field = { height: 30, fontSize: 13, padding: '0 8px' };

export default function PersonDetail({ businessId, row, canEdit, meId, onToast, onChanged, onOpenCompany }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [todo, setTodo] = useState(null); // { text, due }
  useEffect(() => {
    let live = true;
    setDetail(null); setError('');
    goalsApi.peopleActivityDetail(businessId, row.key).then(d => live && setDetail(d)).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId, row.key]);
  const rec = row.company && LINK_TYPE[row.company.type] ? { type: row.company.type, id: row.company.id, name: row.company.name, stage: row.company.stage } : null;
  const prospect = row.key.startsWith('prospect:') ? { contact_id: row.key.slice('prospect:'.length), name: row.name } : null;
  const noRecord = 'Add the company to the pipeline first';
  const act = async (what, fn) => { setBusy(what); try { await fn(); } catch (e) { onToast({ text: e.message }); } finally { setBusy(''); } };
  const draft = () => act('draft', async () => {
    const markdown = await goalsApi.copyBundle(businessId, rec.type, rec.id);
    await navigator.clipboard.writeText(`${markdown}${playbookPrompt(rec)}\n`);
    onToast({ text: `Draft bundle for ${row.name} copied - paste it into Claude. Prospector never sends.` });
  });
  const touch = (touchType, what) => act(what, () => markContacted({ businessId, row: rec, person: prospect, touchType, onChanged, onToast }));
  const addTodo = () => act('todo', async () => {
    const due = todo.due || null;
    const goal = await goalsApi.createWeekGoal(businessId, { week_start: mondayOf(due || today()), kind: 'todo', text: todo.text.trim(), owner_user_id: meId || null, due_date: due, link_type: LINK_TYPE[rec.type], link_id: rec.id });
    setTodo(null); onChanged();
    onToast({ text: `To-do added for ${row.name}`, undo: async () => { await goalsApi.deleteWeekGoal(businessId, goal.id); onChanged(); } });
  });
  const notAFit = () => act('dead', async () => {
    const before = row.status || 'new';
    await updateProspect(businessId, prospect.contact_id, { status: 'dead' });
    onChanged();
    onToast({ text: `${row.name} marked not a fit`, undo: async () => { await updateProspect(businessId, prospect.contact_id, { status: before, expect: { status: 'dead' } }); onChanged(); } });
  });
  const timeline = detail?.timeline || [];
  return (
    <div data-person-detail={row.key} style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: SA.text }}>
      <div role="group" aria-label="Quick menu" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="sm" disabled={!row.company?.id} disabledReason="No company record yet" onClick={() => onOpenCompany(row.company)}>Open company</Button>
        {canEdit && <>
          <Button size="sm" disabled={!rec || busy === 'draft'} disabledReason={noRecord} title="Copies the email bundle for Claude - Prospector never sends" onClick={draft}>{busy === 'draft' ? 'Copying…' : 'Draft email'}</Button>
          <Button size="sm" disabled={!rec || busy === 'call'} disabledReason={noRecord} title="A call touch on the company (Undo 10 s)" onClick={() => touch('call', 'call')}>Log call</Button>
          <Button size="sm" disabled={!rec} disabledReason={noRecord} aria-expanded={!!todo} onClick={() => setTodo(t => (t ? null : { text: '', due: '' }))}>Add to-do</Button>
          <Button size="sm" disabled={!rec || busy === 'contacted'} disabledReason={noRecord} title="An email touch on the company; a record behind Contacted moves there (Undo 10 s)" onClick={() => touch('email', 'contacted')}>Mark contacted</Button>
          <Button size="sm" variant="danger" disabled={!prospect || row.status === 'dead' || busy === 'dead'} disabledReason={prospect ? 'Already not a fit' : 'No archive for this source yet'} title="The prospect's status (Undo 10 s)" onClick={notAFit}>Not a fit</Button>
        </>}
      </div>
      {todo && (
        <form data-todo-form onSubmit={e => { e.preventDefault(); if (todo.text.trim()) addTodo(); }} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input autoFocus aria-label="To-do" placeholder="What needs doing" value={todo.text} onChange={e => setTodo(t => ({ ...t, text: e.target.value }))} className="ui-input" style={{ ...field, width: 260 }} />
          <input type="date" aria-label="To-do due date" value={todo.due} onChange={e => setTodo(t => ({ ...t, due: e.target.value }))} className="ui-input" style={{ ...field, width: 'auto', colorScheme: 'dark' }} />
          <Button type="submit" variant="primary" size="sm" disabled={!todo.text.trim() || busy === 'todo'}>{busy === 'todo' ? 'Saving…' : 'Save to-do'}</Button>
        </form>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 14 }}>
        <section aria-label="Email timeline" style={{ minWidth: 0 }}>
          <span className="ui-group-label">Email timeline</span>
          {error && <ErrorNote message={error} />}
          {!detail && !error && <div style={{ color: SA.muted, marginTop: 6 }}>Loading…</div>}
          {detail && !timeline.length && <div style={{ color: SA.muted, marginTop: 6 }}>{row.sources.includes('Apollo sequence') || row.sources.includes('Partner contact') ? 'No emails on record.' : 'Not in an email sequence - identified on the site, no email activity.'}</div>}
          {timeline.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {timeline.slice(0, 20).map((t, i) => {
                const [word, color] = KIND[t.kind] || ['Signal', SA.text];
                return <li key={`${t.kind}-${t.at}-${i}`} data-timeline-kind={t.kind} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}><span style={{ ...numStyle, color: SA.muted, width: 118, flex: 'none', fontSize: 12 }}>{when(t.at)}</span><span style={{ color, width: 60, flex: 'none' }}>{word}</span><span style={{ color: SA.soft, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[t.step != null ? `step ${t.step}` : null, t.automated ? (t.kind === 'open' ? 'automated open (scanner)' : 'scanner click') : null, t.subject, t.reply_class ? t.reply_class.replace(/_/g, ' ') : null, t.seen_at_sync ? 'time = when the sync saw it' : null].filter(Boolean).join(' · ')}</span></li>;
              })}
              {timeline.length > 20 && <li style={{ color: SA.muted, fontSize: 12 }}>and {timeline.length - 20} more</li>}
            </ul>
          )}
        </section>
        <section aria-label="Company and notes" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div><span className="ui-group-label">Company visits</span><div style={{ marginTop: 4 }}>{row.visits ? <><b style={numStyle}>{row.visits.visits_7d}</b> visits (Apollo, rolling 7 d) · last {mdy(row.visits.last_visit)}{row.visits.top_page ? ` · ${row.visits.top_page}` : ''}</> : <span style={{ color: SA.muted }}>No visits matched to {row.company?.name || 'this company'}.</span>}</div></div>
          <div><span className="ui-group-label">Emails</span><div style={{ marginTop: 4 }}><b style={numStyle}>{row.emails.sent}</b> sent · <b style={numStyle}>{row.emails.opened}</b> human opens{row.emails.bot_opens ? <span style={{ color: SA.muted }}> ({row.emails.bot_opens} automated)</span> : null} · <b style={numStyle}>{row.emails.clicked}</b> clicked · <b style={numStyle}>{row.emails.replied}</b> replied</div></div>
          <div><span className="ui-group-label">Notes</span><div style={{ marginTop: 4, color: detail?.notes ? SA.text : SA.muted, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail ? detail.notes || 'None.' : '…'}</div></div>
        </section>
      </div>
    </div>
  );
}
