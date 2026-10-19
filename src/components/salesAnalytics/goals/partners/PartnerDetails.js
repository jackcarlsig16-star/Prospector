import { useState, useEffect } from 'react';
import { SA } from '../../theme';
import { subStyle, inputStyle, Btn, ErrorNote } from '../goalsUi';
import LinkedTasks, { isOpenTask } from '../../tasks/LinkedTasks';
import { laDateString } from '../../periods';
import { mergePeople } from '../../../../constants/partnerPeople';
import { buildTimeline } from './activityTimeline';
import Drawer from '../../../../ui/Drawer';
import PartnerStatus from './PartnerStatus';
import PartnerPeople from './PartnerPeople';
import PartnerActivity from './PartnerActivity';
import PartnerIntel from './PartnerIntel';
import PartnerResearch from './PartnerResearch';
import PartnerDomains from './PartnerDomains';
import LogTouchForm from './LogTouchForm';
import CopyForClaude from '../../CopyForClaude';
import WaitingList from '../../tasks/WaitingList';
import { goalsApi } from '../goalsApi';

// partner-360-v1 / partner-details-drawers-v1 - a row's drop-down: the header
// (where we are, what's next, log a touch, a quick note) always shows; People,
// Activity, Tasks, Intel and Domains fold into drawers that open closed and
// stay as the user last left them (per drawer kind, not per partner). bump:
// the parent's change counter (a note or a touch changes no partner field).
// actions: the row's Next / signal handlers (null for viewers). people:
// { load, add, remove } for partner_contacts; domains: the partner_domains
// api, loaded here so a closed drawer can still say "2 confirmed". tasksFor:
// this week's linked to-dos, or null when Goals shows another week.
const md = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const cut = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
// prospector_partner_drawer_<kind> - per-viewer convenience: that drawer's last open/closed choice.
const drawerKey = kind => `prospector_partner_drawer_${kind}`;

export function peopleSummary(people) {
  if (!people) return 'loading…';
  if (!people.length) return 'nobody yet';
  const [first, ...rest] = people;
  const who = `${first.name}${first.title || first.note ? ` (${first.title || first.note})` : ''}`;
  return `${people.length} ${people.length === 1 ? 'person' : 'people'} · ${who}${rest.length ? ` +${rest.length}` : ''}`;
}
export function activitySummary(items) {
  if (!items) return 'loading…';
  const first = items.find(i => !i.noise);
  return first ? `${first.text} · ${md(first.at)}` : 'nothing yet';
}
export function tasksSummary(tasks, tasksFor, today, waiting = 0) {
  const theirs = waiting ? ` · waiting on them ${waiting}` : '';
  if (!tasksFor) return `shown for the current week${theirs}`;
  const open = tasks.filter(isOpenTask);
  if (!open.length) return `${tasks.length ? `${tasks.length} done` : 'none this week'}${theirs}`;
  const overdue = open.filter(t => t.due_date && t.due_date < today).length;
  return `${open.length} this week${overdue ? ` · ${overdue} overdue` : ''}${theirs}`;
}
export const intelSummary = partner => cut(partner.angle || partner.partner_role, 80) || 'nothing yet';
export function domainsSummary(data) {
  if (!data) return 'loading…';
  const n = (data.domains || []).filter(d => d.confirmed).length;
  return n ? `${n} confirmed` : 'none confirmed';
}

export default function PartnerDetails({ partner, lookup, businessId, canEdit, onUpdate, onEvents, bump, tasksFor, actions, people, domains, research, onCreateTask, onCount }) {
  const [events, setEvents] = useState(null);
  const [contacts, setContacts] = useState(null);
  const [domainData, setDomainData] = useState(null);
  const [waiting, setWaiting] = useState([]);
  const [waitingBump, setWaitingBump] = useState(0);
  const [peopleBump, setPeopleBump] = useState(0);
  const [error, setError] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  const [taskText, setTaskText] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [note, setNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const version = `${partner.updated_at}|${bump}`;
  useEffect(() => {
    let live = true;
    onEvents(partner.id).then(ev => { if (live) { setEvents(ev); setError(''); } }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [partner.id, version, onEvents]);
  useEffect(() => {
    let live = true;
    people.load(partner.id).then(rows => { if (live) setContacts(rows); }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [partner.id, version, peopleBump, people]);
  useEffect(() => {
    let live = true;
    setDomainData(null);
    domains.load(partner.id).then(d => { if (live) setDomainData(d); }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [partner.id, domains]);
  useEffect(() => {
    if (!businessId) return undefined;
    let live = true;
    goalsApi.waitingRows(businessId, partner.id).then(rows => { if (live) setWaiting(rows); }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId, partner.id, version, waitingBump]);
  const merged = events && contacts ? mergePeople({ contacts, events, knownContacts: partner.known_contacts }) : null;
  const count = merged ? merged.length : null;
  useEffect(() => { if (count !== null && count !== (partner.people_count || 0)) onCount(partner.id, count); }, [count, partner.id, partner.people_count, onCount]);
  const tasks = tasksFor ? tasksFor('partner', partner.id) : [];
  const timeline = events ? buildTimeline({ events, tasks, lookup }) : null;
  const addTask = async e => {
    e.preventDefault();
    if (!taskText.trim()) return;
    setTaskBusy(true); setError('');
    try { await onCreateTask({ text: taskText.trim(), link_type: 'partner', link_id: partner.id }); setTaskText(''); }
    catch (err) { setError(err.message); }
    finally { setTaskBusy(false); }
  };
  const logTouch = async signal => {
    const ok = await actions.onSignal(signal);
    if (ok) setPeopleBump(n => n + 1);
    return !!ok;
  };
  const saveNote = async e => {
    e.preventDefault();
    if (!note.trim()) return;
    setNoteBusy(true); setError('');
    try { if (await actions.onSignal({ type: 'note', note: note.trim() })) setNote(''); }
    catch (err) { setError(err.message); }
    finally { setNoteBusy(false); }
  };
  return (
    <div className="ui-theme-dark" style={{ borderTop: `1px solid ${SA.border}`, padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
      <PartnerStatus partner={partner} events={events || []} lookup={lookup} actions={actions} logOpen={logOpen} onLogTouch={() => setLogOpen(o => !o)} />
      {actions && (
        <form onSubmit={saveNote} aria-label={`Quick note on ${partner.name}`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input aria-label="Quick note" placeholder="Quick note - Enter saves (e.g. Called, left voicemail)" value={note} onChange={e => setNote(e.target.value)} disabled={noteBusy} style={{ ...inputStyle, height: 36, flex: '1 1 220px' }} />
          <Btn type="submit" style={{ height: 36 }} disabled={noteBusy || !note.trim()}>{noteBusy ? 'Saving…' : 'Save note'}</Btn>
        </form>
      )}
      {businessId && <div><CopyForClaude businessId={businessId} type="partner" id={partner.id} /></div>}
      {logOpen && actions && <LogTouchForm partner={partner} names={(merged || []).map(p => p.name)} onSubmit={logTouch} onClose={() => setLogOpen(false)} />}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Drawer label="People" summary={peopleSummary(merged)} persistKey={drawerKey('people')}>
          {merged
            ? <PartnerPeople people={merged} canEdit={canEdit}
                onAdd={async body => { await people.add(partner.id, body); setPeopleBump(n => n + 1); }}
                onDelete={async id => { await people.remove(partner.id, id); setPeopleBump(n => n + 1); }} />
            : <span style={{ ...subStyle, fontSize: 13 }}>Loading people…</span>}
        </Drawer>
        <Drawer label="Activity" summary={activitySummary(timeline)} persistKey={drawerKey('activity')}>
          {timeline ? <PartnerActivity items={timeline} /> : <span style={{ ...subStyle, fontSize: 13 }}>Loading activity…</span>}
        </Drawer>
        <Drawer label="Tasks" summary={tasksSummary(tasks, tasksFor, laDateString(), waiting.length)} persistKey={drawerKey('tasks')}>
          {waiting.length > 0 && (
            <section aria-label={`Waiting on ${partner.name}`} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ ...subStyle, fontSize: 12, color: SA.soft }}>Waiting on {partner.name} ({waiting.length})</span>
              <WaitingList businessId={businessId} rows={waiting} partnerName={null} canEdit={canEdit} onChanged={() => setWaitingBump(n => n + 1)} />
            </section>
          )}
          {!tasksFor && <span style={{ ...subStyle, fontSize: 12 }}>Linked to-dos show for the current week only.</span>}
          {tasksFor && !tasks.length && <span style={{ ...subStyle, fontSize: 12 }}>none linked this week</span>}
          {tasksFor && <LinkedTasks tasks={tasks} lookup={lookup} label={partner.name} link={{ type: 'partner', id: partner.id }} />}
          {canEdit && tasksFor && (
            <form onSubmit={addTask} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input aria-label={`New task for ${partner.name}`} placeholder={`+ Task for ${partner.name} (this week)`} value={taskText} onChange={e => setTaskText(e.target.value)} style={{ ...inputStyle, height: 36, flex: '1 1 220px' }} />
              <Btn type="submit" style={{ height: 36 }} disabled={taskBusy || !taskText.trim()}>{taskBusy ? 'Adding…' : 'Add task'}</Btn>
            </form>
          )}
        </Drawer>
        <Drawer label="Intel" summary={intelSummary(partner)} persistKey={drawerKey('intel')}>
          <PartnerIntel partner={partner} canEdit={canEdit} onUpdate={onUpdate} />
        </Drawer>
        {research && <PartnerResearch partner={partner} canEdit={canEdit} api={research} domains={domains} onDomainData={setDomainData} onUpdate={onUpdate}
          confirmedDomains={(domainData?.domains || []).filter(d => d.confirmed).map(d => d.domain)} />}
        <Drawer label="Domains" summary={domainsSummary(domainData)} persistKey={drawerKey('domains')}>
          <PartnerDomains partner={partner} canEdit={canEdit} api={domains} data={domainData} onData={setDomainData} />
        </Drawer>
      </div>
      {error && <ErrorNote message={error} />}
    </div>
  );
}
