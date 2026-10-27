import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../ui/Button';
import Field from '../../ui/Field';
import { hkGet, hkPatch, hkPost } from '../hkApi';

// hkos-daily-check-v1 J6 - Settings > Digest: when the morning check runs (time, days, the workspace timezone), whether
// Slack is configured (an env on the server, named here, never edited here), and Send test digest, which posts the
// current payload marked TEST when Slack is set and renders it here either way. Owner role edits and sends.
const SECTIONS = [['urgent', 'Urgent'], ['replies', 'Replies waiting'], ['drafts', 'Drafts to review'], ['no_draft', 'Follow-ups with no draft'], ['dm_ready', 'DM text ready']];
export const slackLine = slack => (slack?.configured ? 'Slack: configured. The digest posts to the webhook each morning.' : `Slack: not configured. Set ${slack?.env || 'HK_SLACK_WEBHOOK_URL'} on the server to post the digest; Today shows it either way.`);

export default function DigestSettings({ businessId, shell, canEdit }) {
  const [form, setForm] = useState(null);
  const [slack, setSlack] = useState(null);
  const [state, setState] = useState('');
  const [error, setError] = useState('');
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);
  const isOwnerRole = shell?.me?.role === 'owner';
  const load = useCallback(async () => { setError(''); try { const [{ settings: s }, t] = await Promise.all([hkGet(businessId, '/settings'), hkGet(businessId, '/jobs/today')]); setForm({ digest_time: s.digest_time || '07:30', digest_days: s.digest_days || 'weekdays', timezone: s.timezone || 'America/Chicago' }); setSlack(t.slack); } catch (e) { setError(e.message); } }, [businessId]);
  useEffect(() => { load(); }, [load]);
  if (!form) return error ? <p className="hk-error" role="alert">{error}</p> : <p className="hk-meta">Loading digest settings…</p>;
  const dis = !canEdit || !isOwnerRole;
  const save = async () => { setState('Saving…'); setError(''); try { await hkPatch(businessId, '/settings', { digest_time: form.digest_time, digest_days: form.digest_days }); setState('Saved'); await load(); } catch (e) { setState(''); setError(e.message); } };
  const send = async () => { setBusy(true); setError(''); try { setTest(await hkPost(businessId, '/jobs/test-digest', {})); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return (
    <section aria-label="Digest" data-hk-digest>
      <h2 className="hk-section-title">Digest</h2>
      <p className="hk-meta">The daily check runs at this time, writes the follow-up drafts and builds the morning digest Today shows.</p>
      {error && <p className="hk-error" role="alert">{error}</p>}
      <div className="hk-form" style={{ marginTop: 14, maxWidth: 420 }}>
        <Field label="Time" htmlFor="hk-dg-time" hint={`Workspace time: ${form.timezone}`}>
          <input id="hk-dg-time" className="ui-input" type="time" value={form.digest_time} disabled={dis} onChange={e => setForm({ ...form, digest_time: e.target.value })} />
        </Field>
        <Field label="Days" htmlFor="hk-dg-days">
          <select id="hk-dg-days" className="ui-input" value={form.digest_days} disabled={dis} onChange={e => setForm({ ...form, digest_days: e.target.value })}><option value="weekdays">Weekdays</option><option value="daily">Every day</option></select>
        </Field>
        <p className="hk-meta" data-hk-slack-line>{slackLine(slack)}</p>
        {!dis && <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><Button variant="primary" disabled={!/^\d{2}:\d{2}$/.test(form.digest_time)} onClick={save} data-hk-save-digest>Save digest settings</Button><Button disabled={busy} onClick={send} data-hk-send-test>{busy ? 'Building…' : 'Send test digest'}</Button><span className="hk-meta" role="status">{state}</span></span>}
        {dis && <p className="hk-meta">Only an owner-role member can change these or send a test.</p>}
      </div>
      {test && (
        <div className="hk-note" style={{ marginTop: 16 }} data-hk-test-digest>
          <strong>Test digest for {test.digest.day}</strong> · {test.slack === 'posted' ? 'posted to Slack' : test.slack === 'error' ? 'Slack did not accept it' : 'Slack not configured, shown here'}
          {SECTIONS.map(([k, label]) => { const rows = test.digest.sections[k] || []; return rows.length ? <div key={k} style={{ marginTop: 8 }}><div className="hk-meta">{label} ({rows.length})</div><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{rows.map((e, i) => <li key={i}>{e.brand_name}{e.owner ? ` (${e.owner})` : ''}{e.label_text ? ` - ${e.label_text}` : e.kind_text ? ` - ${e.kind_text}` : ''}{e.summary ? `: ${e.summary}` : e.reason_text ? `, ${e.reason_text}` : ''}</li>)}</ul></div> : null; })}
          <div className="hk-meta" style={{ marginTop: 8 }}>{test.digest.data_warnings ? `Data warnings: ${test.digest.data_warnings} · ` : ''}{test.digest.stats_stale ? 'Stats need a fresh confirmation · ' : ''}Done yesterday: {test.digest.done_yesterday.sent} sent · {test.digest.done_yesterday.replies_handled} replies handled · {test.digest.done_yesterday.meetings} meetings</div>
        </div>
      )}
    </section>
  );
}
