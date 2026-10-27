import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../ui/Button';
import Field from '../../ui/Field';
import ToggleRow from '../../ui/ToggleRow';
import { Icon } from '../HkMarks';
import { hkGet, hkPatch } from '../hkApi';

// hkos-daily-check-v1 J6 - Settings > Follow-up timing: the day counts the daily check reads (bump, DM, final), the
// locked email-touch cap, and quiet weekends. Owner role edits.
const DAYS = [['bump_after_days', 'Bump after', 'Days after the cold email with no reply before the bump is drafted.'], ['dm_after_days', 'Instagram DM after', 'Days after the cold email before a DM text is prepared.'], ['final_after_days', 'Final after', 'Days after the cold email before the final nudge is drafted.']];

export default function FollowupSettings({ businessId, shell, canEdit }) {
  const [form, setForm] = useState(null);
  const [max, setMax] = useState(3);
  const [state, setState] = useState('');
  const [error, setError] = useState('');
  const isOwnerRole = shell?.me?.role === 'owner';
  const load = useCallback(async () => { setError(''); try { const { settings: s } = await hkGet(businessId, '/settings'); setForm({ bump_after_days: s.bump_after_days, dm_after_days: s.dm_after_days, final_after_days: s.final_after_days, quiet_weekends: s.quiet_weekends !== false }); setMax(s.max_email_touches); } catch (e) { setError(e.message); } }, [businessId]);
  useEffect(() => { load(); }, [load]);
  if (!form) return error ? <p className="hk-error" role="alert">{error}</p> : <p className="hk-meta">Loading follow-up timing…</p>;
  const dis = !canEdit || !isOwnerRole;
  const bad = DAYS.some(([k]) => !Number.isInteger(form[k]) || form[k] < 1) || form.final_after_days <= form.bump_after_days;
  const save = async () => { setState('Saving…'); setError(''); try { await hkPatch(businessId, '/settings', form); setState('Saved'); await load(); } catch (e) { setState(''); setError(e.message); } };
  return (
    <section aria-label="Follow-up timing" data-hk-followups>
      <h2 className="hk-section-title">Follow-up timing</h2>
      <p className="hk-meta">The daily check drafts each follow-up into the owner's Gmail on these days. Nothing is ever sent from here.</p>
      {error && <p className="hk-error" role="alert">{error}</p>}
      <div className="hk-form" style={{ marginTop: 14, maxWidth: 420 }}>
        {DAYS.map(([k, label, hint]) => (
          <Field key={k} label={`${label} (days)`} htmlFor={`hk-fu-${k}`} hint={hint}>
            <input id={`hk-fu-${k}`} className="ui-input" type="number" min="1" max="120" step="1" value={form[k]} disabled={dis} onChange={e => setForm({ ...form, [k]: e.target.value === '' ? '' : Number(e.target.value) })} />
          </Field>
        ))}
        <div className="hk-locked__item" data-hk-max-touches><Icon name="lock" size={16} label="Locked" />At most {max} email touches per brand: cold, bump, final. This cap cannot be raised here.</div>
        <ToggleRow label="Quiet weekends" help="No follow-ups are drafted on Saturdays or Sundays (America/Chicago)." checked={form.quiet_weekends} disabled={dis} onChange={v => setForm({ ...form, quiet_weekends: v })} />
        {form.final_after_days <= form.bump_after_days && <p className="hk-error" role="alert">Final must come after the bump.</p>}
        {!dis && <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}><Button variant="primary" disabled={bad} onClick={save} data-hk-save-followups>Save follow-up timing</Button><span className="hk-meta" role="status">{state}</span></span>}
        {dis && <p className="hk-meta">Only an owner-role member can change these.</p>}
      </div>
    </section>
  );
}
