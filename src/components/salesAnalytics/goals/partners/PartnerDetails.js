import { useState, useEffect } from 'react';
import { SA } from '../../theme';
import { labelStyle, subStyle, inputStyle, Btn, ErrorNote } from '../goalsUi';
import LinkedTasks from '../../tasks/LinkedTasks';
import { mergePeople } from '../../../../constants/partnerPeople';
import { buildTimeline } from './activityTimeline';
import PartnerStatus from './PartnerStatus';
import PartnerPeople from './PartnerPeople';
import PartnerActivity from './PartnerActivity';
import PartnerIntel from './PartnerIntel';
import LogTouchForm from './LogTouchForm';

// partner-360-v1 - a row's drop-down tells one story, top to bottom: where
// we are and what's next, who we know, what happened, the to-dos, and the
// sheet's intel folded away. bump: the parent's change counter (a note or a
// touch changes no partner field). actions: the row's Next / signal
// handlers (null for viewers). people: { load, add, remove } for
// partner_contacts. tasksFor: this week's linked to-dos, or null when Goals
// shows another week.
export default function PartnerDetails({ partner, lookup, canEdit, onUpdate, onEvents, bump, tasksFor, actions, people, onCreateTask, onCount }) {
  const [events, setEvents] = useState(null);
  const [contacts, setContacts] = useState(null);
  const [peopleBump, setPeopleBump] = useState(0);
  const [error, setError] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  const [taskText, setTaskText] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
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
  const merged = events && contacts ? mergePeople({ contacts, events, knownContacts: partner.known_contacts }) : null;
  const count = merged ? merged.length : null;
  useEffect(() => { if (count !== null && count !== (partner.people_count || 0)) onCount(partner.id, count); }, [count, partner.id, partner.people_count, onCount]);
  const tasks = tasksFor ? tasksFor('partner', partner.id) : [];
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
  return (
    <div style={{ borderTop: `1px solid ${SA.border}`, padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 16, fontSize: 13 }}>
      <PartnerStatus partner={partner} events={events || []} lookup={lookup} actions={actions} logOpen={logOpen} onLogTouch={() => setLogOpen(o => !o)} />
      {logOpen && actions && <LogTouchForm partner={partner} names={(merged || []).map(p => p.name)} onSubmit={logTouch} onClose={() => setLogOpen(false)} />}
      {merged
        ? <PartnerPeople people={merged} canEdit={canEdit}
            onAdd={async body => { await people.add(partner.id, body); setPeopleBump(n => n + 1); }}
            onDelete={async id => { await people.remove(partner.id, id); setPeopleBump(n => n + 1); }} />
        : <span style={{ ...subStyle, fontSize: 13 }}>Loading people…</span>}
      {events
        ? <PartnerActivity items={buildTimeline({ events, tasks, lookup })} />
        : <span style={{ ...subStyle, fontSize: 13 }}>Loading activity…</span>}
      <section aria-label="Tasks" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <span style={labelStyle}>Tasks</span>
          {!tasksFor && <span style={{ ...subStyle, fontSize: 12 }}>shown for the current week</span>}
          {tasksFor && !tasks.length && <span style={{ ...subStyle, fontSize: 12 }}>none linked this week</span>}
        </div>
        {tasksFor && <LinkedTasks tasks={tasks} lookup={lookup} label={partner.name} link={{ type: 'partner', id: partner.id }} />}
        {canEdit && tasksFor && (
          <form onSubmit={addTask} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input aria-label={`New task for ${partner.name}`} placeholder={`+ Task for ${partner.name} (this week)`} value={taskText} onChange={e => setTaskText(e.target.value)} style={{ ...inputStyle, height: 36, flex: '1 1 220px' }} />
            <Btn type="submit" style={{ height: 36 }} disabled={taskBusy || !taskText.trim()}>{taskBusy ? 'Adding…' : 'Add task'}</Btn>
          </form>
        )}
      </section>
      <PartnerIntel partner={partner} canEdit={canEdit} onUpdate={onUpdate} />
      {error && <ErrorNote message={error} />}
    </div>
  );
}
