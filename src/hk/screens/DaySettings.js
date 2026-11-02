import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../ui/Button';
import Field from '../../ui/Field';
import { hkGet, hkPatch, hkPost } from '../hkApi';

// grow-today-workflow-v1 T2 / T4 - under Settings > Pitch: "Pitches per day" (Your day's step 5 goal, stored in
// hk_settings.intel.pitch_goal) and "Run daily check now", moved here from Today. Owner role for both.
const fmtTime = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function DaySettings({ businessId, shell, canEdit }) {
  const [goal, setGoal] = useState(null);
  const [saved, setSaved] = useState(null);
  const [run, setRun] = useState(undefined);
  const [state, setState] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dis = !canEdit || shell?.me?.role !== 'owner';
  const load = useCallback(async () => {
    try {
      const [{ settings }, t] = await Promise.all([hkGet(businessId, '/settings'), hkGet(businessId, '/jobs/today', { owner: 'me' })]);
      const g = Number.isInteger(settings.intel?.pitch_goal) ? settings.intel.pitch_goal : 5;
      setGoal(g); setSaved(g); setRun(t.run || null); setError('');
    } catch (e) { setError(e.message); }
  }, [businessId]);
  useEffect(() => { load(); }, [load]);
  if (goal == null) return error ? <p className="hk-error" role="alert">{error}</p> : <p className="hk-meta">Loading your day settings…</p>;
  const save = async () => { setState('Saving…'); setError(''); try { await hkPatch(businessId, '/settings', { intel: { pitch_goal: goal } }); setState('Saved'); await load(); } catch (e) { setState(''); setError(e.message); } };
  const runDaily = async () => {
    setBusy(true); setError(''); setState('');
    try {
      const r = await hkPost(businessId, '/jobs/daily-check', {});
      setState(r.skipped ? `Already ran today (${r.run ? fmtTime(r.run.started_at) : ''}). Tomorrow's check picks up anything new.` : `Daily check done: ${r.counts.drafted} drafts written, ${r.counts.no_draft} follow-ups without a draft, ${r.counts.dm_texts} DM texts.`);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <section aria-label="Your day" data-hk-day-settings style={{ marginTop: 24 }}>
      <h3 className="hk-section-title" style={{ fontSize: 16 }}>Your day</h3>
      {error && <p className="hk-error" role="alert">{error}</p>}
      <div className="hk-form">
        <Field label="Pitches per day" htmlFor="hk-pitch-goal" hint="Today's step 5 shows up to this many ready brands for each member.">
          <input id="hk-pitch-goal" className="ui-input" type="number" min="1" max="10" step="1" value={goal} disabled={dis} onChange={e => setGoal(Number(e.target.value))} data-hk-pitch-goal />
        </Field>
        {!dis && <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}><Button variant="primary" disabled={goal === saved || !(goal >= 1 && goal <= 10)} onClick={save} data-hk-save-goal>Save</Button><Button disabled={busy} onClick={runDaily} data-hk-run-daily>{busy ? 'Running…' : 'Run daily check now'}</Button></span>}
        <p className="hk-meta" role="status" data-hk-daily-line>{state || (run ? `Daily check last ran ${fmtTime(run.finished_at || run.started_at)} (${run.trigger}${run.status === 'ok' ? '' : `, ${run.status}`}). It runs on its own each morning.` : 'The daily check has not run yet.')}</p>
        {dis && canEdit && <p className="hk-meta">Only an owner-role member can change these.</p>}
      </div>
    </section>
  );
}
