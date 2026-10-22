import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_THEME_ROOT_ID } from '../../theme';
import useMediaQuery from '../../../../utils/useMediaQuery';
import DataTable from '../../../../ui/DataTable';
import Segmented from '../../../../ui/Segmented';
import FilterSelect from '../../../../ui/FilterSelect';
import StatusPill from '../../../../ui/StatusPill';
import Button from '../../../../ui/Button';
import PeopleCompanyPanel from '../../PeopleCompanyPanel';
import { goalsApi } from '../goalsApi';
import { ErrorNote, numStyle } from '../goalsUi';
import { laDateString } from '../../periods';
import CampaignContacts from './CampaignContacts';
import CampaignTemplates from './CampaignTemplates';
import CampaignImport from './CampaignImport';
import { CAMPAIGN_STATUS, CAMPAIGN_TONE, LINK_LABEL, sentByStepText, rateText, clipboardText } from './campaignModel';

// seif-campaign-v1 B7 - Pipeline > Campaigns: the list of campaigns, then one
// campaign: its counts, Activate / Pause, the contacts (with the import) and
// the tracks' templates. Prospector never sends: Copy email hands the step to
// the sender's own mailbox. Viewers read everything, change nothing.
// localStorage key (per viewer convenience): prospector_campaign_open - the campaign last opened here.
const OPEN_KEY = 'prospector_campaign_open';
const UNDO_MS = 10000;
const readOpen = () => { try { return localStorage.getItem(OPEN_KEY) || null; } catch { return null; } };
const writeOpen = id => { try { if (id) localStorage.setItem(OPEN_KEY, id); else localStorage.removeItem(OPEN_KEY); } catch { /* private mode */ } };
const rowBar = { height: 36, display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', overflowY: 'hidden', flexWrap: 'nowrap', minWidth: 0 };
const PANES = [{ id: 'contacts', label: 'Contacts' }, { id: 'templates', label: 'Templates' }];
const DONE = { sent: 'sent', skip: 'skipped', stop: 'stopped', replied: 'reply logged', pause: 'taken off the schedule', resume: 'back on the schedule' };

function Stat({ label, value, hint }) {
  return (
    <div data-stat style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 96 }}>
      <span className="ui-group-label">{label}</span>
      <span style={{ fontSize: 20, fontWeight: 600, color: SA.text, ...numStyle }}>{value}</span>
      {hint && <span style={{ fontSize: 12, color: SA.muted, ...numStyle }}>{hint}</span>}
    </div>
  );
}

function NewCampaign({ members, lookup, onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [sender, setSender] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => { setBusy(true); setError(''); try { await onCreate({ name, sender_user_id: sender || null, owner_user_ids: sender ? [sender] : [] }); } catch (e) { setError(e.message); setBusy(false); } };
  return (
    <section aria-label="New campaign" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 10, border: `1px solid ${SA.border}`, background: SA.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label htmlFor="campaign-name" className="ui-group-label">Name</label>
        <input id="campaign-name" className="ui-input ui-input--sm" value={name} maxLength={120} onChange={e => setName(e.target.value)} style={{ width: 240 }} placeholder="Seif fall campaign" />
        <FilterSelect label="Sends from" value={sender} onChange={setSender} options={[{ value: '', label: 'Pick the sender' }, ...members.map(m => ({ value: m.user_id, label: `${lookup(m.user_id).first}'s mailbox` }))]} />
        <Button variant="primary" disabled={busy || !name.trim()} disabledReason="Name it first" onClick={go}>{busy ? 'Creating…' : 'Create'}</Button>
        <Button variant="tertiary" onClick={onCancel}>Cancel</Button>
      </div>
      <span style={{ fontSize: 12, color: SA.muted }}>Makes four tracks (consultants / brokers and corporate, × knows / doesn't know the sender), each with steps 1–3.</span>
      {error && <ErrorNote message={error} />}
    </section>
  );
}

export default function CampaignsView({ businessId, canEdit, members, lookup, meId }) {
  const phone = useMediaQuery('(max-width: 760px)');
  const [campaigns, setCampaigns] = useState(null);
  const [openId, setOpenId] = useState(readOpen);
  const [detail, setDetail] = useState(null);
  const [pane, setPane] = useState('contacts');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [company, setCompany] = useState(null);
  const timer = useRef(null);
  const today = laDateString();

  const loadList = useCallback(() => goalsApi.campaigns(businessId).then(setCampaigns).catch(e => setError(e.message)), [businessId]);
  const loadDetail = useCallback(() => (openId ? goalsApi.campaign(businessId, openId).then(setDetail).catch(e => { if (e.status === 404) { setOpenId(null); writeOpen(null); } else setError(e.message); }) : Promise.resolve()), [businessId, openId]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { setDetail(null); loadDetail(); }, [loadDetail]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const closeCompany = useCallback(() => setCompany(null), []);

  const showToast = (text, undo = null) => { clearTimeout(timer.current); setToast({ text, undo }); timer.current = setTimeout(() => setToast(null), UNDO_MS); };
  const open = id => { setOpenId(id); writeOpen(id); setPane('contacts'); setImporting(false); setError(''); };
  const run = async fn => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const reload = () => Promise.all([loadDetail(), loadList()]);

  const campaignAct = action => run(async () => {
    const r = await goalsApi.campaignAction(businessId, openId, action);
    showToast(action === 'activate' ? `Scheduled ${r.scheduled} contact${r.scheduled === 1 ? '' : 's'}${r.no_track ? ` · ${r.no_track} still need a segment / warmth` : ''} · up to ${r.cap} sends a day`
      : action === 'resume' ? `Resumed · ${r.rescheduled} late send${r.rescheduled === 1 ? '' : 's'} moved to the next open days` : `Campaign ${CAMPAIGN_STATUS[r.campaign.status].toLowerCase()}`);
    await reload();
  });
  const contactAct = (c, action, body) => run(async () => {
    const r = await goalsApi.contactAction(businessId, c.id, action, body);
    const text = action === 'promote' ? `${r.record.name} ${r.created ? 'added to Pipeline' : 'linked'} as ${LINK_LABEL[r.record.type].toLowerCase()}`
      : action === 'status' ? `${c.name}: ${body.status.replace('_', ' ')}` : `${c.name}: step ${c.current_step} ${DONE[action]}`;
    showToast(text, r.event ? async () => { await goalsApi.contactAction(businessId, c.id, 'undo', { event_id: r.event.id }); setToast(null); await reload(); } : null);
    await reload();
  });
  const copy = c => run(async () => {
    const d = await goalsApi.contactDraft(businessId, c.id);
    await navigator.clipboard.writeText(clipboardText(d));
    showToast(`Step ${d.step_no} email for ${c.name} copied - paste it into your mailbox`);
  });
  const saveStep = async (st, patch) => { await goalsApi.updateCampaignStep(businessId, openId, st.id, patch); await loadDetail(); };
  const undo = () => run(async () => { await toast.undo(); });

  const c = detail?.campaign;
  const k = detail?.counts;
  const stepsOf = trackId => detail?.tracks.find(t => t.id === trackId)?.steps.length || null;
  const overlayRoot = document.getElementById(SA_THEME_ROOT_ID) || document.body;
  const toastEl = toast && createPortal(
    <div role="status" className="no-print" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 4005, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 10, background: SA.surface2, border: `1px solid ${SA.border}`, color: SA.text, fontSize: 14, maxWidth: 'min(640px, 92vw)' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toast.text}</span>
      {toast.undo && <Button size="sm" onClick={undo} disabled={busy} style={{ height: 28 }}>Undo</Button>}
    </div>, overlayRoot);

  if (!openId || !c) {
    const columns = [
      { id: 'name', label: 'Campaign', width: 220, sticky: true, sortValue: x => x.name, render: x => <button type="button" className="ui-link ui-link--cell" onClick={() => open(x.id)}>{x.name}</button>, title: x => x.name },
      { id: 'status', label: 'Status', width: 110, sortValue: x => x.status, render: x => <StatusPill status={CAMPAIGN_TONE[x.status]}>{CAMPAIGN_STATUS[x.status]}</StatusPill> },
      { id: 'sender', label: 'Sends from', width: 110, sortValue: x => (x.sender_user_id ? lookup(x.sender_user_id).first : null), render: x => (x.sender_user_id ? lookup(x.sender_user_id).first : '—') },
      { id: 'contacts', label: 'Contacts', width: 84, sortValue: x => x.counts.contacts, render: x => <span style={numStyle}>{x.counts.contacts}</span> },
      { id: 'sent', label: 'Sent to', width: 76, sortValue: x => x.counts.sent_contacts, render: x => <span style={numStyle}>{x.counts.sent_contacts}</span> },
      { id: 'replies', label: 'Replies', width: 76, sortValue: x => x.counts.replies, render: x => <span style={numStyle}>{x.counts.replies}</span> },
      { id: 'rate', label: 'Reply rate', width: 84, sortValue: x => x.counts.reply_rate, render: x => <span style={numStyle}>{rateText(x.counts.reply_rate)}</span> },
      { id: 'meetings', label: 'Meetings', width: 84, sortValue: x => x.counts.meetings, render: x => <span style={numStyle}>{x.counts.meetings}</span> },
      { id: 'promoted', label: 'Promoted', width: 84, sortValue: x => x.counts.promoted, render: x => <span style={numStyle}>{x.counts.promoted}</span> },
    ];
    return (
      <section aria-label="Campaigns" data-campaigns style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <div data-filter-row style={rowBar}>
          <span className="ui-group-label">Campaigns</span>
          <span style={{ fontSize: 13, color: SA.muted, ...numStyle }}>{campaigns ? campaigns.length : ''}</span>
          <span style={{ flex: 1 }} />
          {canEdit && !creating && <Button variant="primary" onClick={() => setCreating(true)}>New campaign</Button>}
        </div>
        {creating && <NewCampaign members={members} lookup={lookup} onCancel={() => setCreating(false)}
          onCreate={async body => { const r = await goalsApi.createCampaign(businessId, body); setCreating(false); await loadList(); open(r.campaign.id); }} />}
        {error && <ErrorNote message={error} />}
        {!campaigns && !error && <span style={{ fontSize: 13, color: SA.muted }}>Loading…</span>}
        {campaigns && (
          <div className="ui-theme-dark">
            <DataTable label="Campaigns" columns={columns} rowKey={x => x.id} compact={phone}
              renderCompact={x => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><StatusPill status={CAMPAIGN_TONE[x.status]}>{CAMPAIGN_STATUS[x.status]}</StatusPill><button type="button" className="ui-link" onClick={() => open(x.id)}>{x.name}</button></span>
                  <span style={{ fontSize: 12, color: SA.muted, ...numStyle }}>{x.counts.contacts} contacts · sent to {x.counts.sent_contacts} · {x.counts.replies} replies · {x.counts.meetings} meetings</span>
                </div>
              )}
              groups={[{ id: 'all', header: <>All campaigns <span className="ui-table__count">{campaigns.length}</span></>, rows: campaigns, emptyText: canEdit ? 'No campaigns yet - start one with New campaign.' : 'No campaigns yet.' }]} emptyText="No campaigns yet." />
          </div>
        )}
        {toastEl}
      </section>
    );
  }

  const queued = detail.contacts.filter(x => x.status === 'queued' && x.track_id).length;
  return (
    <section aria-label={`Campaign ${c.name}`} data-campaign={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div data-filter-row style={rowBar}>
        <Button variant="tertiary" onClick={() => { setOpenId(null); writeOpen(null); setDetail(null); }}>← All campaigns</Button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: SA.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</h2>
        <StatusPill status={CAMPAIGN_TONE[c.status]}>{CAMPAIGN_STATUS[c.status]}</StatusPill>
        <span style={{ fontSize: 13, color: SA.muted, whiteSpace: 'nowrap' }}>{c.sender_user_id ? `Sends from ${lookup(c.sender_user_id).first}'s mailbox` : 'No sender set'}</span>
        <span style={{ flex: 1 }} />
        {canEdit && <>
          {c.status !== 'done' && !importing && <Button onClick={() => { setImporting(true); setPane('contacts'); }}>Import contacts</Button>}
          {(c.status === 'draft' || (c.status === 'active' && queued > 0)) && <Button variant="primary" disabled={busy || !queued} disabledReason="Import contacts with a segment and warmth first" onClick={() => campaignAct('activate')}>{c.status === 'draft' ? 'Activate' : `Schedule ${queued} new`}</Button>}
          {c.status === 'active' && <Button disabled={busy} onClick={() => campaignAct('pause')}>Pause</Button>}
          {c.status === 'paused' && <Button variant="primary" disabled={busy} onClick={() => campaignAct('resume')}>Resume</Button>}
        </>}
      </div>
      <div data-campaign-counts style={{ display: 'flex', gap: 24, flexWrap: 'wrap', padding: 12, border: `1px solid ${SA.border}`, borderRadius: 10, background: SA.surface }}>
        <Stat label="Contacts" value={k.contacts} hint={queued ? `${queued} not scheduled` : null} />
        <Stat label="Sent to" value={k.sent_contacts} hint={sentByStepText(k.sent_by_step)} />
        <Stat label="Replies" value={k.replies} hint={`reply rate ${rateText(k.reply_rate)}`} />
        <Stat label="Meetings" value={k.meetings} />
        <Stat label="Promoted" value={k.promoted} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 220 }}>
          <span className="ui-group-label">Reply rate by track</span>
          {k.by_track.map(t => <span key={t.track_id} style={{ fontSize: 12, color: SA.soft, ...numStyle }}>{t.name}: {rateText(t.reply_rate)} <span style={{ color: SA.muted }}>({t.replies}/{t.sent})</span></span>)}
        </div>
      </div>
      {error && <ErrorNote message={error} />}
      {importing && <CampaignImport businessId={businessId} campaign={c} members={members} lookup={lookup} onClose={() => setImporting(false)}
        onAdded={async n => { setImporting(false); showToast(`Added ${n} contact${n === 1 ? '' : 's'}`); await reload(); }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="ui-group-label" aria-hidden="true">Show</span>
        <Segmented label="Campaign views" items={PANES} value={pane} onChange={setPane} />
      </div>
      {pane === 'contacts'
        ? <CampaignContacts contacts={detail.contacts} tracks={detail.tracks} steps={stepsOf} today={today} canEdit={canEdit} phone={phone} members={members} lookup={lookup}
            onAct={contactAct} onCopy={copy} onOpenCompany={(x, link) => setCompany({ company: x.company, link })} />
        : <CampaignTemplates tracks={detail.tracks} contacts={detail.contacts} canEdit={canEdit && c.status !== 'done'} onSaveStep={saveStep} />}
      {company && <PeopleCompanyPanel businessId={businessId} person={company} canEdit={canEdit} members={members} meId={meId} onToast={t => showToast(t.text, t.undo)} onClose={closeCompany} onOpenFull={() => setCompany(null)} />}
      {toastEl}
    </section>
  );
}
