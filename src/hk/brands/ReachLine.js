import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../ui/Button';
import { hkGet, hkPost } from '../hkApi';

// grow-inbox-intel-v1 REV3 B5 + R1 - under the brand title: "Reach-out score n · why", the research line, a website
// found by research (Use copies it to the brand after the duplicate check), and Research when the brand has none.
export default function ReachLine({ businessId, brandId, canEdit, onChanged }) {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const load = useCallback(async () => { try { setR(await hkGet(businessId, `/brands/${brandId}/reach`)); } catch { setR(null); } }, [businessId, brandId]);
  useEffect(() => { load(); }, [load]);
  if (!r) return null;
  const run = async fn => { setBusy(true); setNote(''); try { await fn(); await load(); onChanged?.(); } catch (e) { setNote(e.message); } finally { setBusy(false); } };
  const research = () => run(async () => { const x = await hkPost(businessId, `/brands/${brandId}/research`, { click: true }); setNote(x.status === 'not_found' ? 'No website found. Not retried for 30 days.' : x.status === 'cached' ? 'Researched recently; showing the saved research.' : 'Research done.'); });
  const use = () => run(async () => { await hkPost(businessId, `/brands/${brandId}/use-domain`, {}); setNote(`Website set to ${r.suggestion.domain}.`); });
  return (
    <div className="hk-reach" data-hk-reach>
      <p className="hk-meta" data-hk-reach-score>{r.eligible ? `Reach-out score ${r.score}${r.why.length ? ` · ${r.why.join(' · ')}` : ''}` : 'Not in Send these 10 (can_contact, status or owner)'}</p>
      {r.research?.line && <p className="hk-meta" data-hk-reach-research>{r.research.line}</p>}
      {r.suggestion && <p className="hk-meta" data-hk-reach-site={r.suggestion.confidence}>{r.suggestion.confidence === 'high' ? `Website: ${r.suggestion.domain}` : `Possible website: ${r.suggestion.domain}?`}{canEdit && <> · <button type="button" className="hk-btn hk-link" disabled={busy} onClick={use} data-hk-use-site>Use</button></>}</p>}
      {canEdit && !r.research && !r.research_attempted_at && <Button size="sm" disabled={busy} onClick={research} data-hk-reach-research-btn>{busy ? 'Researching…' : 'Research'}</Button>}
      {note && <p className="hk-meta" role="status">{note}</p>}
    </div>
  );
}
