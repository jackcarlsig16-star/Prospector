import { useState } from 'react';
import { C, mono } from '../constants/colors';
import { updateInfluencerRelationship } from '../utils/db';
import AccountActivityTimeline from './AccountActivityTimeline';

const STAGE_OPTIONS = ['not_contacted','contacted','replied','interested','negotiating','partnered','declined','do_not_contact'];
const STAGE_COLOR = {
  not_contacted: C.dim, contacted: C.blue, replied: C.blue, interested: C.gold,
  negotiating: C.orange, partnered: C.green, declined: C.red, do_not_contact: C.red,
};
const TEMP_OPTIONS = ['warm','familiar','cold'];
const TEMP_COLOR = { warm: C.orange, familiar: C.gold, cold: C.blue };
const PRIORITY_OPTIONS = ['low','medium','high'];
const PRIORITY_COLOR = { low: C.dim, medium: C.gold, high: C.red };

const fitColor = (score) => score == null ? C.dim : score >= 70 ? C.green : score >= 40 ? C.gold : C.red;

const label = s => (s || '').replace(/_/g, ' ');

const pill = (color) => ({ ...mono, fontSize:10, padding:"2px 8px", borderRadius:20, background:`${color}18`, border:`1px solid ${color}55`, color, whiteSpace:"nowrap" });
const select = { ...mono, fontSize:11, padding:"4px 8px", background:C.bg, border:`1px solid ${C.brdM}`, borderRadius:5, color:C.txt, outline:"none", cursor:"pointer" };
const inp = { ...mono, fontSize:12, padding:"7px 10px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", boxSizing:"border-box", width:"100%" };
const SH = { ...mono, fontSize:9, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.1em", color:"#555", margin:"0 0 6px" };

function FitBlock({ detail }) {
  const fit = detail?.fit_score;
  const signals = detail?.fit_signals;
  if (detail?.assessment_status !== 'ready') {
    return <p style={{ ...mono, fontSize:11, color:C.dim, margin:0 }}>No fit assessment yet — add a bio below and run assessment.</p>;
  }
  return (
    <>
      <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:8 }}>
        <span style={{ ...mono, fontSize:24, fontWeight:700, color:fitColor(fit) }}>{fit ?? '—'}</span>
        <span style={{ ...mono, fontSize:10, color:C.dim }}>/ 100 fit</span>
      </div>
      {detail.fit_rationale && <p style={{ ...mono, fontSize:12, color:C.txt, lineHeight:1.6, margin:"0 0 10px" }}>{detail.fit_rationale}</p>}
      {Array.isArray(signals) && signals.length > 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {signals.map((s, i) => (
            <div key={i} style={{ display:"flex", gap:8, alignItems:"baseline" }}>
              <span style={{ ...mono, fontSize:10, color:C.gold, textTransform:"uppercase", letterSpacing:"0.04em", flexShrink:0 }}>{s.axis}</span>
              <span style={{ ...mono, fontSize:11, color:C.mut, lineHeight:1.5 }}>{s.note}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function AssessBioForm({ business, acc, detail, onAssessed }) {
  const [bio, setBio] = useState(detail?.bio_snapshot || '');
  const [followerCount, setFollowerCount] = useState(detail?.follower_count || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    if (!bio.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/businesses/${business.id}/influencer/assess`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: acc.id, bioText: bio.trim(), followerCount: followerCount ? Number(followerCount) : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Assessment failed');
      onAssessed(data.detail);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop:10 }}>
      <textarea value={bio} onChange={e=>setBio(e.target.value)} rows={3} placeholder="Paste their bio to assess (or re-assess with an updated bio)"
        style={{ ...inp, resize:"vertical", marginBottom:8 }} disabled={busy} />
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <input type="number" value={followerCount} onChange={e=>setFollowerCount(e.target.value)} placeholder="followers (optional)" style={{ ...inp, width:160 }} disabled={busy} />
        <button onClick={run} disabled={!bio.trim()||busy} style={{ ...mono, fontSize:11, padding:"7px 14px", background:C.gold, border:`1px solid ${C.gold}`, borderRadius:6, color:C.bg, cursor:"pointer", fontWeight:700, opacity:bio.trim()?1:0.5 }}>
          {busy ? "Assessing…" : detail?.assessment_status === 'ready' ? "Re-run assessment →" : "Run assessment →"}
        </button>
      </div>
      {error && <p style={{ ...mono, fontSize:11, color:C.red, margin:"8px 0 0" }}>⚠ {error}</p>}
    </div>
  );
}

function RelationshipBlock({ acc, detail, userEmail, canEdit, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const [nextAction, setNextAction] = useState(detail?.next_action || '');
  const [declineReason, setDeclineReason] = useState(detail?.decline_reason || '');
  const [tagInput, setTagInput] = useState('');
  const tags = Array.isArray(detail?.tags) ? detail.tags : [];

  const apply = async (patch) => {
    setSaving(true);
    const { detail: updated, error } = await updateInfluencerRelationship(acc.id, userEmail, patch);
    setSaving(false);
    if (!error) onUpdated(updated);
  };

  return (
    <>
      <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginBottom:12 }}>
        <div>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Stage</div>
          {canEdit ? (
            <select value={detail?.relationship_stage || 'not_contacted'} disabled={saving} onChange={e=>apply({ relationship_stage: e.target.value })} style={{ ...select, color:STAGE_COLOR[detail?.relationship_stage]||C.txt }}>
              {STAGE_OPTIONS.map(s => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          ) : <span style={pill(STAGE_COLOR[detail?.relationship_stage]||C.dim)}>{label(detail?.relationship_stage||'not_contacted')}</span>}
        </div>
        <div>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Temperature</div>
          {canEdit ? (
            <select value={detail?.relationship_temperature || ''} disabled={saving} onChange={e=>apply({ relationship_temperature: e.target.value || null })} style={select}>
              <option value="">—</option>
              {TEMP_OPTIONS.map(t => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          ) : <span style={pill(TEMP_COLOR[detail?.relationship_temperature]||C.dim)}>{label(detail?.relationship_temperature||'—')}</span>}
        </div>
        <div>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Priority</div>
          {canEdit ? (
            <select value={detail?.priority || ''} disabled={saving} onChange={e=>apply({ priority: e.target.value || null })} style={select}>
              <option value="">—</option>
              {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{label(p)}</option>)}
            </select>
          ) : <span style={pill(PRIORITY_COLOR[detail?.priority]||C.dim)}>{label(detail?.priority||'—')}</span>}
        </div>
      </div>

      <div style={{ marginBottom:10 }}>
        <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Next action</div>
        {canEdit ? (
          <div style={{ display:"flex", gap:6 }}>
            <input value={nextAction} onChange={e=>setNextAction(e.target.value)} placeholder="e.g. Send outreach DM" style={inp} disabled={saving} />
            <button onClick={()=>apply({ next_action: nextAction.trim() || null })} disabled={saving} style={{ ...mono, fontSize:11, padding:"0 12px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.dim, cursor:"pointer" }}>Save</button>
          </div>
        ) : <p style={{ ...mono, fontSize:12, color:C.txt, margin:0 }}>{detail?.next_action || '—'}</p>}
      </div>

      {(detail?.relationship_stage === 'declined' || detail?.relationship_stage === 'do_not_contact') && (
        <div style={{ marginBottom:10 }}>
          <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Decline reason</div>
          {canEdit ? (
            <div style={{ display:"flex", gap:6 }}>
              <input value={declineReason} onChange={e=>setDeclineReason(e.target.value)} placeholder="Why this didn't work out" style={inp} disabled={saving} />
              <button onClick={()=>apply({ decline_reason: declineReason.trim() || null })} disabled={saving} style={{ ...mono, fontSize:11, padding:"0 12px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.dim, cursor:"pointer" }}>Save</button>
            </div>
          ) : <p style={{ ...mono, fontSize:12, color:C.txt, margin:0 }}>{detail?.decline_reason || '—'}</p>}
        </div>
      )}

      <div>
        <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Tags</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          {tags.map(t => (
            <span key={t} style={pill(C.purple)}>
              {t}
              {canEdit && <button onClick={()=>apply({ tags: tags.filter(x=>x!==t) })} disabled={saving} style={{ background:"transparent", border:"none", color:C.purple, cursor:"pointer", marginLeft:6, padding:0, fontSize:11 }}>✕</button>}
            </span>
          ))}
          {canEdit && (
            <>
              <input value={tagInput} onChange={e=>setTagInput(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter' && tagInput.trim()){ apply({ tags:[...tags, tagInput.trim()] }); setTagInput(''); } }}
                placeholder="+ tag" style={{ ...inp, width:100, padding:"3px 8px", fontSize:11 }} disabled={saving} />
            </>
          )}
          {!tags.length && !canEdit && <span style={{ ...mono, fontSize:11, color:C.dim }}>—</span>}
        </div>
      </div>
    </>
  );
}

// Break-out from AccountCard.js's inline badge (influencer-accounts-v1) into
// a real card with its own compact/detail split, matching business accounts'
// pattern of two views without reusing any of that view's fintech-specific
// UI (Assay tiers, deal stage pipeline, competition, etc) - those concepts
// don't apply to an influencer relationship (influencer-card-v2, Phase 3).
export default function InfluencerCard({ acc, business, expanded, onToggle, onRemove, userEmail, canEdit, onUpdated }) {
  const [detail, setDetail] = useState(acc.influencerDetail || null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const handle = detail?.instagram_handle || (acc.name || '').replace(/^@/, '');

  // Update this card's own view immediately (no round-trip wait), then also
  // trigger a silent reload upstream so accounts.last_touched_by/at (stage
  // changes go through recordAccountActivity, which touches those - see
  // db.js) doesn't go stale in BusinessAccountsTab's cached account list.
  const applyDetailUpdate = (updated) => {
    setDetail(updated);
    onUpdated?.();
  };

  return (
    <div style={{ border:`1px solid ${C.brd}`, borderLeft:`4px solid ${C.purple}88`, borderRadius:6, background:C.card, marginBottom:6, overflow:"hidden" }}>
      <div onClick={onToggle} style={{ padding:"10px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:14 }}>
        <span style={{ display:"inline-block", width:6, height:6, borderRadius:"50%", background:C.purple, flexShrink:0 }} />
        <div style={{ flex:"0 0 200px", minWidth:0 }}>
          <p style={{ margin:0, fontWeight:500, fontSize:14, color:C.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>@{handle}</p>
          <p style={{ ...mono, margin:0, fontSize:10, color:C.dim }}>
            {detail?.follower_count != null ? `${detail.follower_count.toLocaleString()} followers` : '—'}
            {detail?.niche_assessment?.category ? ` · ${detail.niche_assessment.category}` : ''}
          </p>
        </div>
        <div style={{ flex:"0 0 auto" }}>
          {detail?.assessment_status === 'ready' ? (
            <span style={{ ...mono, fontSize:16, fontWeight:700, color:fitColor(detail.fit_score) }}>{detail.fit_score ?? '—'}<span style={{ fontSize:9, color:C.dim, fontWeight:400 }}> fit</span></span>
          ) : (
            <span style={{ ...mono, fontSize:10, color:C.dim }}>
              {detail?.assessment_status === 'assessing' ? 'assessing…' : detail?.assessment_status === 'error' ? 'assessment failed' : 'no bio yet'}
            </span>
          )}
        </div>
        {detail?.priority && <span style={pill(PRIORITY_COLOR[detail.priority])}>{label(detail.priority)} priority</span>}
        <span style={pill(STAGE_COLOR[detail?.relationship_stage]||C.dim)}>{label(detail?.relationship_stage||'not_contacted')}</span>
        <span style={{ marginLeft:"auto", ...mono, fontSize:10, color:C.dim }}>{expanded?"▲":"▼"}</span>
      </div>

      {expanded && (
        <div style={{ borderTop:`1px solid ${C.brd}`, padding:"14px 16px", display:"flex", flexDirection:"column", gap:16 }}>
          <div>
            <p style={SH}>Creator</p>
            <p style={{ ...mono, fontSize:12, color:C.txt, lineHeight:1.6, margin:"0 0 6px" }}>{detail?.audience_read || detail?.niche_assessment?.audience_read || '—'}</p>
            <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
              <span style={{ ...mono, fontSize:11, color:C.mut }}><b style={{ color:C.dim }}>Category:</b> {detail?.niche_assessment?.category || '—'}</span>
              <span style={{ ...mono, fontSize:11, color:C.mut }}><b style={{ color:C.dim }}>Content:</b> {detail?.niche_assessment?.content_type || '—'}</span>
            </div>
            <AssessBioForm business={business} acc={acc} detail={detail} onAssessed={applyDetailUpdate} />
          </div>

          <div>
            <p style={SH}>Fit</p>
            <FitBlock detail={detail} />
          </div>

          <div>
            <p style={SH}>Relationship</p>
            <RelationshipBlock acc={acc} detail={detail} userEmail={userEmail} canEdit={canEdit} onUpdated={applyDetailUpdate} />
          </div>

          <div>
            <p style={SH}>Activity</p>
            <AccountActivityTimeline acc={acc} />
          </div>

          {onRemove && (
            <div style={{ paddingTop:8, borderTop:`0.5px solid ${C.brd}` }}>
              {confirmRemove ? (
                <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ ...mono, fontSize:10, color:C.red }}>Remove?</span>
                  <button onClick={()=>onRemove(acc.id)} style={{ ...mono, fontSize:10, padding:"4px 9px", background:"#1a0a0a", border:`1px solid ${C.red}`, color:C.red, borderRadius:4, cursor:"pointer" }}>Confirm</button>
                  <button onClick={()=>setConfirmRemove(false)} style={{ ...mono, fontSize:10, padding:"4px 8px", background:"transparent", border:"0.5px solid #2a2a2a", color:C.dim, borderRadius:4, cursor:"pointer" }}>Cancel</button>
                </span>
              ) : (
                <button onClick={()=>setConfirmRemove(true)} style={{ ...mono, fontSize:10, padding:"4px 9px", background:`${C.red}12`, border:`1px solid ${C.red}55`, color:C.red, borderRadius:4, cursor:"pointer" }}>✕ Remove</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
