import { useState } from 'react';
import { SA } from '../theme';
import { ui } from '../../../ui/kitTheme';
import { goalsApi } from './goalsApi';
import { updateOpportunity } from '../pipelineApi';
import { updateProspect } from '../huddleApi';
import { playbookPrompt } from './companyPanelModel';
import { md, showsNotNow } from './companyPanelFacts';

// company-panel-v2 L3 - the Interest band: shown only while GET goals/company
// says interest.show (a signal in the last 14 days nobody parked). Strongest
// signal first in bold, dated, then the rest. Members get four buttons; each
// write hands back a 10 s Undo. Viewers see the text alone. Not now is hidden
// on visitor / Apollo-only rows (the route refuses them - no record to park).
const btn = 'ui-btn ui-btn--secondary';
const onBand = { borderColor: SA.borderStrong };

// Follow up: draft reply = the copy bundle plus the person and their signal, for Claude. Never sends.
export async function copyFollowUp({ businessId, row, person, signal, onToast }) {
  try {
    const markdown = await goalsApi.copyBundle(businessId, row.type, row.id);
    const lead = person ? `Reply to ${person.name}, who ${signal.text.replace(`${person.name} `, '')} on ${md(signal.at)}. Pick up exactly where their interest is.` : `They showed interest (${signal.text}). Open with that.`;
    await navigator.clipboard.writeText(`${markdown}${lead}\n${playbookPrompt(row)}\n`);
    onToast({ text: `Copied for Claude${person ? ` - names ${person.name}` : ''}. Paste it into a Claude chat. Nothing was sent.` });
  } catch (e) { onToast({ text: e.message }); }
}

export default function InterestBand({ businessId, row, interest, canEdit, onChanged, onToast }) {
  const [busy, setBusy] = useState('');
  const strongest = interest.strongest;
  const person = strongest?.person || null;
  const act = async (what, fn) => {
    setBusy(what);
    try { await fn(); } catch (e) { onToast({ text: e.message }); } finally { setBusy(''); }
  };
  const draftReply = () => act('draft', () => copyFollowUp({ businessId, row, person, signal: strongest, onToast }));
  const bookMeeting = () => act('book', async () => {
    const r = await goalsApi.bookMeeting(businessId, row.type, row.id, person ? { person: person.name } : {});
    onChanged();
    onToast({ text: `Next step: ${r.next_step} · to-do due today`, undo: async () => {
      if (row.type === 'partner') await goalsApi.updatePartner(businessId, row.id, { next_step: r.before?.next_step ?? null });
      else if (row.type === 'employer') await updateOpportunity(businessId, row.id, { next_action: r.before?.next_action ?? null, next_action_date: r.before?.next_action_date ?? null });
      await goalsApi.updateWeekGoal(businessId, r.todo.id, { status: 'dropped' });
      onChanged();
    } });
  });
  const markContacted = () => act('contacted', async () => {
    const r = await goalsApi.markContacted(businessId, row.type, row.id, { ...(person ? { contact_id: person.contact_id, person: person.name } : {}), touch_type: 'email' });
    onChanged();
    onToast({ text: `${person ? person.name : row.name} marked contacted`, undo: async () => {
      if (r.event) await goalsApi.partnerUndo(businessId, row.id, r.event.id);
      if (r.todo) await goalsApi.updateWeekGoal(businessId, r.todo.id, { status: 'dropped' });
      if (r.person) await updateProspect(businessId, r.person.contact_id, { status: r.person.before.status });
      onChanged();
    } });
  });
  const notNow = () => act('notnow', async () => {
    const r = await goalsApi.notNow(businessId, row.type, row.id, person ? { contact_id: person.contact_id } : {});
    onChanged();
    if (r.person) onToast({ text: `${person.name}: not now until ${md(r.person.snooze_until)}`, undo: async () => { await updateProspect(businessId, r.person.contact_id, { status: r.person.before.status, snooze_until: r.person.before.snooze_until }); onChanged(); } });
    else onToast({ text: `${row.name}: interest parked until something new happens` });
  });
  const b = what => busy === what;
  return (
    <div role="region" aria-label="Interest" data-interest-band style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '0 -20px', padding: '10px 20px 10px 17px', borderLeft: `3px solid ${ui.generatedTo}`, borderBottom: `1px solid ${SA.border}`, background: `linear-gradient(90deg, color-mix(in srgb, ${ui.generatedFrom} 18%, ${SA.surface}) 0%, color-mix(in srgb, ${ui.generatedTo} 18%, ${SA.surface}) 100%)` }}>
      <span className="ui-group-label" style={{ color: ui.generatedTo, width: 72, flex: 'none' }}>Interest</span>
      <span style={{ fontSize: 13, color: SA.text, flex: '1 1 240px', minWidth: 0 }}>
        <b style={{ fontWeight: 600 }}>{strongest.text}</b> <span style={{ color: SA.muted }}>{md(strongest.at)}</span>
        {interest.items.slice(1).map(i => <span key={i.id || i.text}> · <b style={{ fontWeight: 600 }}>{i.text}</b> <span style={{ color: SA.muted }}>{md(i.at)}</span></span>)}
      </span>
      {canEdit && (
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="ui-btn ui-btn--primary" disabled={b('draft')} onClick={draftReply} title="Copies the record + the signal for Claude. Never sends.">{b('draft') ? 'Copying…' : 'Follow up: draft reply'}</button>
          <button type="button" className={btn} style={onBand} disabled={b('book')} onClick={bookMeeting} title="Sets the next step and adds a to-do due today. No calendar write.">{b('book') ? 'Saving…' : 'Book meeting'}</button>
          <button type="button" className={btn} style={onBand} disabled={b('contacted')} onClick={markContacted} title={row.type === 'partner' ? 'Logs an email touch. The stage does not move.' : 'Logs a done to-do (what Last touch reads).'}>{b('contacted') ? 'Saving…' : 'Mark contacted'}</button>
          {showsNotNow(row) && <button type="button" className="ui-btn ui-btn--tertiary" disabled={b('notnow')} onClick={notNow} title={person ? 'Snoozes this person a week' : 'Hides the band until a newer signal arrives'}>{b('notnow') ? 'Saving…' : 'Not now'}</button>}
        </span>
      )}
    </div>
  );
}
