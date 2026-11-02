import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../ui/Button';
import Field from '../../ui/Field';
import { hkGet, hkPatch } from '../hkApi';

// grow-pitch-icp I3 - Settings > Pitch > "Ideal brand (ICP)": the three ICP weights in the reach score (hk_settings.intel.icp)
// and the media word list (read-only in v1). A change re-ranks Send these 10, Your day and the research sweep on next load.
const ROWS = [['retail', 'Retail / consumer brand', 'A sponsor brand whose research does not read as media or a nonprofit.'], ['unknown', 'Not researched yet', 'A sponsor brand with no research - likely retail.'], ['media', 'Media, podcast, press, nonprofit', 'By segment, or research words below. Still pitchable; ranks low.']];

export default function IcpSettings({ businessId, shell, canEdit }) {
  const [w, setW] = useState(null);
  const [saved, setSaved] = useState(null);
  const [words, setWords] = useState([]);
  const [state, setState] = useState('');
  const [error, setError] = useState('');
  const dis = !canEdit || shell?.me?.role !== 'owner';
  const load = useCallback(async () => {
    try { const r = await hkGet(businessId, '/settings'); setW(r.icp.weights); setSaved(r.icp.weights); setWords(r.icp.words); setError(''); } catch (e) { setError(e.message); }
  }, [businessId]);
  useEffect(() => { load(); }, [load]);
  if (!w) return error ? <p className="hk-error" role="alert">{error}</p> : <p className="hk-meta">Loading the ideal brand…</p>;
  const ok = ROWS.every(([k]) => Number.isInteger(w[k]) && w[k] >= -100 && w[k] <= 100);
  const save = async () => { setState('Saving…'); setError(''); try { await hkPatch(businessId, '/settings', { intel: { icp: w } }); setState('Saved. Lists re-rank on next load.'); await load(); } catch (e) { setState(''); setError(e.message); } };
  return (
    <section aria-label="Ideal brand (ICP)" data-hk-icp-settings style={{ marginTop: 24 }}>
      <h3 className="hk-section-title" style={{ fontSize: 16 }}>Ideal brand (ICP)</h3>
      <p className="hk-meta">Points each brand gets in its reach score. Retail brands are the top signal.</p>
      {error && <p className="hk-error" role="alert">{error}</p>}
      <div className="hk-form">
        {ROWS.map(([k, label, hint]) => (
          <Field key={k} label={label} htmlFor={`hk-icp-${k}`} hint={hint}>
            <input id={`hk-icp-${k}`} className="ui-input" type="number" min="-100" max="100" step="1" value={w[k]} disabled={dis} onChange={e => setW({ ...w, [k]: Number(e.target.value) })} data-hk-icp-weight={k} />
          </Field>
        ))}
        <p className="hk-meta" data-hk-icp-words><strong>Media words</strong> (in research industry or description): {words.join(', ')}</p>
        {!dis && <span><Button variant="primary" disabled={!ok || JSON.stringify(w) === JSON.stringify(saved)} onClick={save} data-hk-save-icp>Save</Button></span>}
        <p className="hk-meta" role="status">{state}</p>
        {dis && canEdit && <p className="hk-meta">Only an owner-role member can change these.</p>}
      </div>
    </section>
  );
}
