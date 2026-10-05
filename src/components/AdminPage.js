import { useState, useEffect } from "react";
import { C, mono } from '../constants/colors';
import AdminOrgChart from './admin/AdminOrgChart';
import { PRODUCTS_OVERRIDE_KEY, loadProductOverrides } from './PricingPage';
import { PRICING_PRODUCTS_DEFAULT } from '../constants/products';
import { saveTeamUsers, saveFrontier, patchUser, getAccountsForBusiness, getOutreachDoctrine, createOutreachDoctrineRule, updateOutreachDoctrineRule } from '../utils/db';
import { isSupabaseEnabled } from '../utils/supabase';
import { mapSfdcStage } from '../utils/stageMap';
import GoogleConnections from './GoogleConnections';
import MembersAccess from './admin/MembersAccess';

// Small pure helpers duplicated from App.js (defined there at module scope)

// Duplicated from App.js — also used in AdminPanel there; kept in sync
const INTEGRATION_DEFS = [
  { id:"hunter", name:"Hunter.io", color:"#F06A35", desc:"Find and verify professional email addresses for outbound prospecting.", keyLabel:"API Key", storageKey:null },
  { id:"resend", name:"Resend", color:"#7C3AED", desc:"Email delivery for BDR notifications and campaign triggers.", keyLabel:"API Key", storageKey:null },
  { id:"zoominfo", name:"ZoomInfo", color:"#0066CC", desc:"B2B contact intelligence — firmographics, org charts, intent signals.", keyLabel:"API Key", storageKey:null },
  { id:"clearbit", name:"Clearbit", color:"#4945FF", desc:"Company enrichment — funding, headcount, tech stack, industry classification.", keyLabel:"API Key", storageKey:null },
];

// ─── Admin Page ───────────────────────────────────────────────────────────────
const ROLES_LIST = ["AE","BDR","Manager","Admin","Owner"];

const ROLE_COLORS = { AE:C.gold, BDR:C.purple, Manager:C.blue, Admin:C.red, Owner:"#E040FB" };

const PERM_META = [
  { key:"canEditStage",   label:"Edit deal stage",       desc:"Move accounts through pipeline stages",                    roles:["AE","BDR","Manager"] },
  { key:"canUpload",      label:"Upload & import",        desc:"Upload CSVs and add accounts in bulk",                     roles:["AE"] },
  { key:"canStealth",     label:"Stealth research",       desc:"Run founder / stealth LinkedIn scans",                     roles:["AE"] },
  { key:"canReassay",     label:"Re-run assay",           desc:"Re-score accounts with the assay engine",                  roles:["AE"] },
  { key:"canClaim",       label:"Claim Jumper",           desc:"Claim accounts from the shared pool",                      roles:["AE"] },
  { key:"canRemove",      label:"Remove accounts",        desc:"Delete accounts from the book",                            roles:["AE"] },
  { key:"canFlagRemoval", label:"Flag for removal",       desc:"Flag accounts for the AE to review and drop",              roles:["BDR"] },
  { key:"canAdmin",       label:"Admin access",           desc:"Access the Admin panel and manage settings",               roles:["Admin","Owner"] },
];

const ROLE_DESC = {
  Owner:   { headline:"Owner",               body:"Builder of this tool. Full access above Admin — cannot be modified, cannot be demoted." },
  Admin:   { headline:"Admin / Sales Ops",   body:"Full unrestricted access. Manages users, roles, and permissions. Cannot be modified." },
  AE:      { headline:"Account Executive",   body:"Territory owner. Runs research, scores accounts, owns the full pipeline. Core permissions locked — this is you." },
  Manager: { headline:"Manager",             body:"Read-across view of all AE territories. Can edit stages to keep pipeline hygiene. No write access to accounts or research tools." },
  BDR:     { headline:"Deputy AE",           body:"Works within the AE's territory. Can edit stages, flag removals, and action the SF queue. Customize what they can touch below." },
};

function AccessLogTab() {
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = () => {
    setLoading(true);
    fetch('/api/access-log')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setLoading(false); return; }
        setEntries(d.entries || []);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  const fmtTime = ts => {
    if (!ts) return '-';
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric' }) + ' ' +
           d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true });
  };


  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
        <div>
          <p style={{ ...mono, margin:'0 0 2px', fontSize:13, fontWeight:600, color:C.txt }}>Access Log</p>
          <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>Last 50 sign-ins, invites and role changes</p>
        </div>
        <button onClick={load} style={{ ...mono, fontSize:11, padding:'5px 12px', background:'transparent', border:`1px solid ${C.brd}`, borderRadius:5, color:C.mut, cursor:'pointer' }}>Refresh</button>
      </div>
      {loading && <p style={{ ...mono, fontSize:12, color:C.dim, padding:'20px 0' }}>Loading...</p>}
      {error   && <p style={{ ...mono, fontSize:12, color:C.red }}>{error}</p>}
      {!loading && !error && entries && (
        <div style={{ border:`1px solid ${C.brd}`, borderRadius:8, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'110px 130px 1fr 1fr', padding:'6px 12px', background:C.card, borderBottom:`1px solid ${C.brd}` }}>
            {['Time','Event','Who','Workspace'].map((h,i) => (
              <span key={i} style={{ ...mono, fontSize:9, color:C.dim, textTransform:'uppercase', letterSpacing:'0.08em' }}>{h}</span>
            ))}
          </div>
          {entries.length === 0 && <p style={{ ...mono, fontSize:12, color:C.dim, padding:'16px 12px', margin:0 }}>No entries yet.</p>}
          {entries.map((e, i) => (
            <div key={e.id} style={{ display:'grid', gridTemplateColumns:'110px 130px 1fr 1fr', padding:'6px 12px', borderBottom:i<entries.length-1?`1px solid ${C.brd}22`:'none', background:i%2===0?'transparent':`${C.brd}0A`, alignItems:'center' }}>
              <span style={{ ...mono, fontSize:10, color:C.mut }}>{fmtTime(e.at)}</span>
              <span style={{ ...mono, fontSize:10, fontWeight:600, color:e.event==='sign_in'?C.green:C.gold }}>{e.event.replace('_',' ')}</span>
              <span style={{ ...mono, fontSize:10, color:C.txt }}>{e.who||'-'}{e.actor&&e.actor!==e.who?<span style={{ color:C.dim }}> · by {e.actor}</span>:null}</span>
              <span style={{ ...mono, fontSize:10, color:C.mut }}>{e.workspace||'-'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Zoom Events Tab (zoom-meet-auto-ingest-v1, Step 5) ──────────────────────
// Reconciliation view over zoom_webhook_events - every recording.completed /
// recording.transcript_completed event received, whether it auto-matched to
// a business/account or is sitting unmatched for manual assignment.
function ZoomReassignRow({ event, businesses, onReassigned }) {
  const [businessId, setBusinessId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!businessId) { setAccounts([]); return; }
    getAccountsForBusiness(businessId).then(setAccounts);
  }, [businessId]);

  const handleAssign = async () => {
    if (!businessId || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/zoom/events/${event.id}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, account_id: accountId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to assign');
      onReassigned();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:8, flexWrap:'wrap' }}>
      <select value={businessId} onChange={e=>{setBusinessId(e.target.value);setAccountId('');}} style={{ ...mono, fontSize:11, padding:'5px 8px', background:C.bg, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt }}>
        <option value="">— assign business —</option>
        {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <select value={accountId} onChange={e=>setAccountId(e.target.value)} disabled={!businessId} style={{ ...mono, fontSize:11, padding:'5px 8px', background:C.bg, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt }}>
        <option value="">— no account —</option>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name || '(unnamed)'}</option>)}
      </select>
      <button onClick={handleAssign} disabled={!businessId||saving} style={{ ...mono, fontSize:11, padding:'5px 12px', background:businessId?C.gold:'transparent', border:`1px solid ${businessId?C.gold:C.brd}`, borderRadius:5, color:businessId?C.bg:C.dim, cursor:businessId?'pointer':'default', fontWeight:600 }}>
        {saving ? 'Assigning…' : 'Assign & File'}
      </button>
      {error && <span style={{ ...mono, fontSize:10, color:C.red }}>⚠ {error}</span>}
    </div>
  );
}

function ZoomEventsTab() {
  const [events, setEvents] = useState(null);
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const load = () => {
    setLoading(true);
    fetch('/api/zoom/events')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setLoading(false); return; }
        setEvents(d.events || []);
        setBusinesses(d.businesses || []);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  const fmtTime = ts => { try { return new Date(ts).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch { return '-'; } };

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
        <div>
          <p style={{ ...mono, margin:'0 0 2px', fontSize:13, fontWeight:600, color:C.txt }}>Zoom Events</p>
          <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>recording.completed / recording.transcript_completed - matched, unmatched, and errored</p>
        </div>
        <button onClick={load} style={{ ...mono, fontSize:11, padding:'5px 12px', background:'transparent', border:`1px solid ${C.brd}`, borderRadius:5, color:C.mut, cursor:'pointer' }}>Refresh</button>
      </div>
      {loading && <p style={{ ...mono, fontSize:12, color:C.dim, padding:'20px 0' }}>Loading…</p>}
      {error && <p style={{ ...mono, fontSize:12, color:C.red }}>{error}</p>}
      {!loading && !error && events && (
        events.length === 0 ? <p style={{ ...mono, fontSize:12, color:C.dim }}>No Zoom events received yet.</p> :
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {events.map(e => {
            const expanded = expandedId === e.id;
            const statusColor = e.processingError ? C.red : e.processed ? C.green : C.orange;
            const statusLabel = e.processingError ? 'Error' : e.processed ? 'Filed' : (e.matchedBusinessId ? 'Matching' : 'Unmatched');
            return (
              <div key={e.id} style={{ padding:'10px 12px', background:C.card, border:`1px solid ${C.brd}`, borderRadius:8 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:6 }}>
                  <span style={{ ...mono, fontSize:9, padding:'2px 7px', borderRadius:9, background:`${C.purple}18`, border:`1px solid ${C.purple}44`, color:C.purple }}>{e.eventType}</span>
                  <span style={{ ...mono, fontSize:10, color:C.dim }}>{fmtTime(e.receivedAt)}</span>
                  <span style={{ ...mono, fontSize:9, padding:'2px 7px', borderRadius:9, background:`${statusColor}18`, border:`1px solid ${statusColor}44`, color:statusColor }}>{statusLabel}</span>
                  {e.matchedBusinessName && <span style={{ ...mono, fontSize:10, color:C.txt }}>{e.matchedBusinessName}{e.matchedAccountName ? ` → ${e.matchedAccountName}` : ''}</span>}
                  {e.matchReason && <span style={{ ...mono, fontSize:9, color:C.dim }}>({e.matchReason})</span>}
                </div>
                <p style={{ ...mono, fontSize:11, color:C.mut, margin:'0 0 4px' }}>
                  {e.topic ? `"${e.topic}"` : '(no topic)'} · host: {e.hostEmail || '-'}
                </p>
                {e.processingError && <p style={{ ...mono, fontSize:11, color:C.red, margin:'0 0 4px' }}>⚠ {e.processingError}</p>}
                {e.hasTranscript && (
                  <p style={{ ...mono, fontSize:11, color:C.txt, margin:0, whiteSpace:'pre-wrap', cursor:'pointer' }} onClick={()=>setExpandedId(expanded?null:e.id)}>
                    {expanded ? e.transcriptText : `${(e.transcriptText||'').slice(0,140)}${(e.transcriptText||'').length>140?'…':''}`}
                    {!expanded && (e.transcriptText||'').length>140 && <span style={{ color:C.dim }}> (click to expand)</span>}
                  </p>
                )}
                {!e.processed && !e.callLogEntryId && e.hasTranscript && (
                  <ZoomReassignRow event={e} businesses={businesses} onReassigned={load} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Outreach Intelligence Tab (outreach-intelligence-doctrine-v1) ──────────────
// Platform-wide doctrine — hard constraints and defaults api/email.js's
// doctrineHard/doctrineDefault providers read on every generation, every
// business. Interaction shape deliberately mirrors BusinessDetailPage.js's
// Intel Log (append-and-review, Supabase-backed) per the audit's confirmed
// recommendation — not the Intel Library or Settings tab's localStorage
// pattern, both confirmed wrong fits. Meant to be returned to regularly, not
// seeded once — kept to one page, no multi-step flow, so adding a rule stays
// fast.
const DOCTRINE_CATEGORIES = ['grounding', 'cta', 'structure', 'proof', 'tone', 'format'];
const CAT_LABEL = { grounding: 'Grounding', cta: 'CTA', structure: 'Structure', proof: 'Proof', tone: 'Tone', format: 'Format' };

function OutreachIntelligenceTab({ currentUser }) {
  const [rules, setRules] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [ruleText, setRuleText] = useState('');
  const [category, setCategory] = useState(DOCTRINE_CATEGORIES[0]);
  const [isHard, setIsHard] = useState(false);
  const [sourceAttribution, setSourceAttribution] = useState('');
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});

  const load = () => { setLoading(true); getOutreachDoctrine().then(data => { setRules(data); setLoading(false); }); };
  useEffect(() => { load(); }, []);

  const addRule = async () => {
    if (!ruleText.trim()) return;
    setSaving(true); setError('');
    const { rule, error: err } = await createOutreachDoctrineRule({
      category, ruleText: ruleText.trim(), isHardConstraint: isHard,
      sourceAttribution: sourceAttribution.trim() || null, createdBy: currentUser?.email || null,
    });
    setSaving(false);
    if (err) { setError(err); return; }
    setRules(rs => [rule, ...(rs || [])]);
    setRuleText(''); setSourceAttribution(''); setIsHard(false);
  };

  const startEdit = (r) => { setEditingId(r.id); setEditDraft({ category: r.category, rule_text: r.rule_text, is_hard_constraint: r.is_hard_constraint, source_attribution: r.source_attribution || '' }); setError(''); };
  const saveEdit = async (id) => {
    setError('');
    const { rule, error: err } = await updateOutreachDoctrineRule(id, {
      category: editDraft.category, rule_text: editDraft.rule_text,
      is_hard_constraint: editDraft.is_hard_constraint, source_attribution: editDraft.source_attribution.trim() || null,
    });
    if (err) { setError(err); return; }
    setRules(rs => rs.map(r => r.id === id ? rule : r));
    setEditingId(null);
  };
  // Soft-delete only — active:false, never a hard delete. Same rationale as
  // business-level edits: preserves history rather than destroying it.
  const toggleActive = async (r) => {
    setError('');
    const { rule, error: err } = await updateOutreachDoctrineRule(r.id, { active: !r.active });
    if (err) { setError(err); return; }
    setRules(rs => rs.map(x => x.id === r.id ? rule : x));
  };

  const visibleRules = (rules || []).filter(r => showInactive || r.active);
  const grouped = DOCTRINE_CATEGORIES
    .map(cat => ({ cat, items: visibleRules.filter(r => r.category === cat) }))
    .filter(g => g.items.length > 0);
  const otherItems = visibleRules.filter(r => !DOCTRINE_CATEGORIES.includes(r.category));
  if (otherItems.length) grouped.push({ cat: null, items: otherItems });

  const inp = { ...mono, fontSize: 12, padding: '7px 10px', background: C.bg, border: `1.5px solid ${C.brdM}`, borderRadius: 6, color: C.txt, outline: 'none', width: '100%', boxSizing: 'border-box', resize: 'vertical' };
  const btn = { ...mono, fontSize: 12, padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 6, color: C.mut, cursor: 'pointer' };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <p style={{ ...mono, margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: C.txt }}>Outreach Intelligence</p>
        <p style={{ ...mono, margin: 0, fontSize: 11, color: C.dim }}>
          Platform-wide doctrine — every business's generation reads this. Non-negotiable rules and defaults are separate; business-level voice/style stays in each business's own Outreach Rules card.
        </p>
      </div>

      {/* ── Add a rule ── */}
      <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '14px 16px', marginBottom: 20 }}>
        <textarea rows={2} value={ruleText} onChange={e => setRuleText(e.target.value)}
          placeholder="e.g. Never claim a case study or specific result that wasn't provided in the account context"
          style={{ ...inp, marginBottom: 10 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inp, width: 'auto' }}>
            {DOCTRINE_CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
          </select>
          <input value={sourceAttribution} onChange={e => setSourceAttribution(e.target.value)} placeholder="Source (optional) — e.g. Braun 4-T framework"
            style={{ ...inp, width: 220 }} />
          <button onClick={() => setIsHard(h => !h)} style={{ ...btn, background: isHard ? `${C.red}18` : 'transparent', borderColor: isHard ? C.red : C.brd, color: isHard ? C.red : C.mut, fontWeight: isHard ? 700 : 400 }}>
            {isHard ? '⛔ Hard constraint' : '○ Default (overridable)'}
          </button>
        </div>
        {error && <div style={{ ...mono, fontSize: 11, color: C.red, marginBottom: 10 }}>⚠ {error}</div>}
        <button onClick={addRule} disabled={!ruleText.trim() || saving} style={{ ...btn, background: C.gold, border: `1px solid ${C.gold}`, color: C.bg, fontWeight: 700, opacity: ruleText.trim() ? 1 : 0.5 }}>
          {saving ? 'Adding…' : '+ Add rule'}
        </button>
      </div>

      {/* ── Review ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span style={{ ...mono, fontSize: 11, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {visibleRules.length} rule{visibleRules.length === 1 ? '' : 's'}
        </span>
        <button onClick={() => setShowInactive(s => !s)} style={{ ...mono, fontSize: 11, color: showInactive ? C.gold : C.dim, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
          {showInactive ? '✓ showing deactivated' : 'show deactivated'}
        </button>
      </div>

      {loading && <p style={{ ...mono, fontSize: 12, color: C.dim }}>Loading…</p>}
      {!loading && !visibleRules.length && <p style={{ ...mono, fontSize: 12, color: C.dim }}>No rules yet — add the first one above.</p>}

      {!loading && grouped.map(({ cat, items }) => (
        <div key={cat || '_other'} style={{ marginBottom: 18 }}>
          <p style={{ ...mono, fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>{cat ? CAT_LABEL[cat] || cat : 'Other'}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(r => {
              const editing = editingId === r.id;
              return (
                <div key={r.id} style={{ padding: '10px 12px', background: !r.active ? `${C.brd}0A` : r.is_hard_constraint ? `${C.red}08` : C.card, border: `1px solid ${!r.active ? C.brd : r.is_hard_constraint ? `${C.red}44` : C.brd}`, borderRadius: 8, opacity: r.active ? 1 : 0.6 }}>
                  {editing ? (
                    <div>
                      <textarea rows={2} value={editDraft.rule_text} onChange={e => setEditDraft(d => ({ ...d, rule_text: e.target.value }))} style={{ ...inp, marginBottom: 8 }} />
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                        <select value={editDraft.category} onChange={e => setEditDraft(d => ({ ...d, category: e.target.value }))} style={{ ...inp, width: 'auto' }}>
                          {DOCTRINE_CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
                        </select>
                        <input value={editDraft.source_attribution} onChange={e => setEditDraft(d => ({ ...d, source_attribution: e.target.value }))} placeholder="Source (optional)" style={{ ...inp, width: 200 }} />
                        <button onClick={() => setEditDraft(d => ({ ...d, is_hard_constraint: !d.is_hard_constraint }))} style={{ ...btn, background: editDraft.is_hard_constraint ? `${C.red}18` : 'transparent', borderColor: editDraft.is_hard_constraint ? C.red : C.brd, color: editDraft.is_hard_constraint ? C.red : C.mut }}>
                          {editDraft.is_hard_constraint ? '⛔ Hard constraint' : '○ Default'}
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => saveEdit(r.id)} style={{ ...btn, background: C.gold, border: `1px solid ${C.gold}`, color: C.bg, fontWeight: 700 }}>Save</button>
                        <button onClick={() => setEditingId(null)} style={btn}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ ...mono, fontSize: 9, padding: '2px 7px', borderRadius: 9, background: r.is_hard_constraint ? `${C.red}18` : `${C.blue}18`, border: `1px solid ${r.is_hard_constraint ? C.red : C.blue}44`, color: r.is_hard_constraint ? C.red : C.blue, fontWeight: 700 }}>
                          {r.is_hard_constraint ? '⛔ HARD CONSTRAINT' : '○ DEFAULT'}
                        </span>
                        {!r.active && <span style={{ ...mono, fontSize: 9, padding: '2px 7px', borderRadius: 9, background: `${C.dim}18`, border: `1px solid ${C.brd}`, color: C.dim }}>DEACTIVATED</span>}
                        {r.source_attribution && <span style={{ ...mono, fontSize: 10, color: C.purple }}>{r.source_attribution}</span>}
                        <span style={{ ...mono, fontSize: 10, color: C.dim, marginLeft: 'auto' }}>{r.ai_assisted ? 'AI-assisted' : r.created_by ? `added by ${r.created_by}` : 'manual'}</span>
                      </div>
                      <p style={{ ...mono, fontSize: 12, color: C.txt, margin: '0 0 8px', lineHeight: 1.6 }}>{r.rule_text}</p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => startEdit(r)} style={{ ...btn, fontSize: 11, padding: '3px 10px' }}>Edit</button>
                        <button onClick={() => toggleActive(r)} style={{ ...btn, fontSize: 11, padding: '3px 10px', color: r.active ? C.orange : C.green, borderColor: r.active ? `${C.orange}66` : `${C.green}66` }}>
                          {r.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}


function AdminPage({ teamUsers=[], onSaveUsers, currentUser, onUpdateCurrentUser, rolePerms={}, onSaveRolePerms, onSave, onSaveToPool, onSaveBatch, accounts=[], removedBlocklist=[], onRestoreAccount, nuggets=[], onSaveNuggets, seedTeam=[] }) {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState(teamUsers);
  useEffect(() => { setUsers(teamUsers); }, [teamUsers]);

  // live perms state (editable copy)
  const [permsEdit, setPermsEdit] = useState(rolePerms);
  const [permsSaved, setPermsSaved] = useState(false);

  // Territories
  const [territories, setTerritories] = useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_territories")||"[]");}catch{return [];}});
  const [terrForm, setTerrForm] = useState({name:"",region:""});
  useEffect(()=>{try{localStorage.setItem("prospector_territories",JSON.stringify(territories));}catch{}},[territories]);
  const addTerritory = () => { if(!terrForm.name.trim())return; setTerritories(prev=>[...prev,{id:`t${Date.now()}`,name:terrForm.name.trim(),region:terrForm.region.trim()}]); setTerrForm({name:"",region:""}); };

  // API key integrations
  const [integrations, setIntegrations] = useState(()=>{try{return JSON.parse(localStorage.getItem("prospector_integrations")||"{}");}catch{return {};}});
  const [keyInputs, setKeyInputs] = useState({});

  // Hunter.io quota + connection test
  const [hunterAccount, setHunterAccount] = useState(null);
  const [hunterTesting, setHunterTesting] = useState(false);
  const [hunterTestError, setHunterTestError] = useState(null);
  const testHunterConnection = async () => {
    setHunterTesting(true); setHunterTestError(null);
    try {
      const r = await fetch('/api/hunter/account');
      const data = await r.json();
      if (!r.ok) { setHunterTestError(data.error || `Error ${r.status}`); setHunterAccount(null); }
      else { setHunterAccount(data); }
    } catch (e) { setHunterTestError(e.message); }
    setHunterTesting(false);
  };
  useEffect(()=>{try{localStorage.setItem("prospector_integrations",JSON.stringify(integrations));}catch{}},[integrations]);
  const getKeyValue = def => def.storageKey ? (localStorage.getItem(def.storageKey)||"") : (integrations[def.id]||"");
  const isConnected = def => !!getKeyValue(def);
  const connectIntegration = (id, storageKey) => { const val=keyInputs[id]||""; if(!val.trim())return; if(storageKey)localStorage.setItem(storageKey,val.trim()); setIntegrations(prev=>({...prev,[id]:val.trim()})); setKeyInputs(prev=>({...prev,[id]:""})); };
  const disconnectIntegration = (id, storageKey) => { if(storageKey)localStorage.removeItem(storageKey); setIntegrations(prev=>{const n={...prev};delete n[id];return n;}); };

  // Salesforce OAuth state
  const [sfdcToken, setSfdcToken] = useState(()=>localStorage.getItem("sfdc_access_token")||"");
  const [sfdcInstance, setSfdcInstance] = useState(()=>localStorage.getItem("sfdc_instance_url")||"");
  const [sfdcUserId, setSfdcUserId] = useState(()=>localStorage.getItem("sfdc_user_id")||"");
  const [sfdcUserName, setSfdcUserName] = useState(()=>localStorage.getItem("sfdc_user_name")||"");
  const sfdcConnected = !!sfdcToken && !!sfdcInstance;
  const [sfdcSyncing, setSfdcSyncing] = useState(null);
  const [sfdcResult, setSfdcResult] = useState(null);
  const [sfdcManual, setSfdcManual] = useState(false);
  const [sfdcManualInputs, setSfdcManualInputs] = useState({token:"", instance:"", userId:""});

  const connectSfdcManual = () => {
    const t = sfdcManualInputs.token.trim();
    const i = sfdcManualInputs.instance.trim().replace(/\/$/, "");
    const u = sfdcManualInputs.userId.trim();
    if(!t || !i) return;
    localStorage.setItem("sfdc_access_token", t);
    localStorage.setItem("sfdc_instance_url", i);
    if(u) localStorage.setItem("sfdc_user_id", u);
    localStorage.setItem("sfdc_user_name", "Manual token");
    setSfdcToken(t); setSfdcInstance(i); setSfdcUserId(u); setSfdcUserName("Manual token");
    setSfdcManual(false); setSfdcManualInputs({token:"", instance:"", userId:""});
  };

  const disconnectSfdc = () => {
    ["sfdc_access_token","sfdc_instance_url","sfdc_user_id","sfdc_user_name"].forEach(k=>localStorage.removeItem(k));
    setSfdcToken(""); setSfdcInstance(""); setSfdcUserId(""); setSfdcUserName("");
    setSfdcResult(null); setSfdcManual(false);
  };

  const syncFromSfdc = async (mode) => {
    if(!sfdcConnected) return;
    setSfdcSyncing(mode); setSfdcResult(null);
    try {
      const res = await fetch("/api/sfdc/accounts", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ access_token:sfdcToken, instance_url:sfdcInstance, user_id:sfdcUserId, mode }),
      });
      const data = await res.json();
      if(!res.ok || data.error) { setSfdcResult({error:data.error||"Sync failed",mode}); return; }
      const incoming = data.accounts || [];
      if(mode==="dormant"){
        onSaveToPool&&onSaveToPool(incoming);
      } else {
        if(onSave){
          const merged=[...accounts];
          incoming.forEach(na=>{
            const idx=merged.findIndex(x=>x.name.toLowerCase()===na.name.toLowerCase()||x.sfdc===na.sfdc);
            const target = idx>=0 ? merged[idx] : null;
            const mappedStage = mapSfdcStage(na.sfdcStageName);
            const dealStageUpdate = mappedStage && target?.dealStageSource !== "manual"
              ? { dealStage: mappedStage, dealStageSource: "sfdc", dealStageUpdatedAt: new Date().toISOString() }
              : {};
            if(idx>=0) Object.assign(merged[idx], na, dealStageUpdate);
            else merged.push({...na, stage:"Prospecting", by:currentUser?.name||"AE", ...dealStageUpdate});
          });
          onSave(merged);
        }
      }
      onSaveBatch&&onSaveBatch({id:Date.now(),fileName:`SFDC ${mode==="dormant"?"Dormant":"My Accounts"}`,uploadType:mode,date:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),total:incoming.length,gold:0,silver:0,note:`Pulled from Salesforce`});
      setSfdcResult({count:incoming.length,mode});
    } catch(err){
      setSfdcResult({error:err.message,mode});
    } finally {
      setSfdcSyncing(null);
    }
  };

  // Org chart drag state
  const [dragId,  setDragId]  = useState(null);
  const [dragOver,setDragOver]= useState(null);
  const [invitedIds, setInvitedIds] = useState(new Set());

  const [supabaseSyncing, setSupabaseSyncing] = useState(false);
  const [supabaseSeeded,  setSupabaseSeeded]  = useState(()=>localStorage.getItem('prospector_supabase_seeded')==='true');




  const importSeedTeam = () => {
    let tombstoned = new Set();
    try { tombstoned = new Set(JSON.parse(localStorage.getItem('prospector_removed_user_ids') || '[]')); } catch {}
    const existingEmails = new Set(users.map(u=>u.email?.toLowerCase()));
    const toAdd = seedTeam.filter(u =>
      !existingEmails.has(u.email?.toLowerCase()) && !tombstoned.has(u.id)
    );
    if(!toAdd.length) return;
    const next = [...users, ...toAdd];
    setUsers(next); onSaveUsers(next);
  };


  const togglePerm = (role, key) => {
    setPermsEdit(p=>({ ...p, [role]:{ ...p[role], [key]:!p[role][key] } }));
    setPermsSaved(false);
  };
  const resetRole = role => { setPermsEdit(p=>({ ...p, [role]:rolePerms[role] })); setPermsSaved(false); };
  const savePerms = () => { onSaveRolePerms(permsEdit); setPermsSaved(true); setTimeout(()=>setPermsSaved(false), 2000); };

  const LOCKED_ROLES = new Set(["Admin","Owner"]); // Admin/Owner always full-access, no edits

  // Pricing tab state (must live at component level — can't be inside a conditional)
  const [pricingOverrides, setPricingOverrides] = useState(()=>loadProductOverrides());
  const [pricingSearch, setPricingSearch] = useState("");

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom:18 }}>
        <h2 style={{ margin:"0 0 3px", fontSize:20, fontWeight:600, color:C.txt }}>Admin</h2>
        <p style={{ ...mono, margin:0, fontSize:12, color:C.dim }}>Users, roles, territories, and API keys</p>
      </div>

      {/* Tab bar — grouped */}
      {(()=>{
        const pendingNuggets = nuggets.filter(n=>n.status==="pending").length;
        const TAB_GROUPS = [
          { label:"TEAM", tabs:[
            ["users",       "👥 Members & Access"],
            ["orgchart",    "🌳 Org Chart"],
            ["permissions", "🔐 Permissions"],
            ["territories", "🗺 Territories"],
          ]},
          { label:"PLATFORM", tabs:[
            ["apikeys",    "🔌 Integrations"],
            ["pricing",    "💰 Pricing"],
            ["accesslog",  "📋 Access Log"],
            ["zoomevents", "☎ Zoom Events"],
            ["doctrine",   "✉ Outreach Intelligence"],
          ]},
          { label:"DATA", tabs:[
            ["nuggets",  `🪙 Nuggets${pendingNuggets>0?` (${pendingNuggets})`:""}`],
            ["removed",  `🗑 Removed${removedBlocklist.length>0?` (${removedBlocklist.length})`:""}`],
            ["settings", "⚙️ Settings"],
          ]},
        ];
        const tabColor = (id) => {
          if (tab===id) return C.gold;
          if (id==="nuggets" && pendingNuggets>0) return C.gold;
          if (id==="removed" && removedBlocklist.length>0) return C.orange;
          return C.mut;
        };
        return (
          <div style={{ display:"flex", alignItems:"flex-end", gap:0, marginBottom:22, borderBottom:`1px solid ${C.brd}`, paddingBottom:0, flexWrap:"wrap" }}>
            {TAB_GROUPS.map((grp, gi) => (
              <div key={grp.label} style={{ display:"flex", alignItems:"flex-end", gap:0 }}>
                {/* Vertical divider between groups */}
                {gi>0 && <div style={{ width:1, height:28, background:C.brd, margin:"0 8px 1px", flexShrink:0 }}/>}
                <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
                  {/* Group label */}
                  <span style={{ ...mono, fontSize:9, color:`${C.gold}66`, letterSpacing:"0.12em", textTransform:"uppercase", paddingLeft:12, marginBottom:4 }}>{grp.label}</span>
                  {/* Tabs in group */}
                  <div style={{ display:"flex", gap:0 }}>
                    {grp.tabs.map(([id,lb])=>(
                      <button key={id} onClick={()=>setTab(id)} style={{ ...mono, fontSize:12, padding:"6px 14px", background:"transparent", border:"none", borderBottom:`2px solid ${tab===id?C.gold:"transparent"}`, color:tabColor(id), cursor:"pointer", marginBottom:-1, whiteSpace:"nowrap" }}>{lb}</button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── MEMBERS & ACCESS TAB ── */}
      {tab==="users"&&<MembersAccess/>}

      {/* ── ORG CHART TAB ── */}
      {tab==="orgchart" && (
        <AdminOrgChart
          users={users}
          setUsers={setUsers}
          invitedIds={invitedIds}
          setInvitedIds={setInvitedIds}
          currentUser={currentUser}
          onSaveUsers={onSaveUsers}
          onUpdateCurrentUser={onUpdateCurrentUser}
          seedTeam={seedTeam}
          importSeedTeam={importSeedTeam}
        />
      )}
      {/* ── PERMISSIONS TAB ── */}
      {tab==="permissions"&&(<>
        <div style={{ display:"flex", alignItems:"center", marginBottom:18 }}>
          <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>Toggle what each role can do — Admin and Owner are always full access and cannot be changed</p>
          <button onClick={savePerms} style={{ marginLeft:"auto", ...mono, fontSize:12, padding:"6px 14px", background:permsSaved?`${C.green}22`:`${C.gold}18`, border:`1px solid ${permsSaved?C.green:C.gold}55`, color:permsSaved?C.green:C.gold, borderRadius:6, cursor:"pointer", fontWeight:600 }}>
            {permsSaved?"✓ Saved":"Save changes"}
          </button>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {ROLES_LIST.map(role=>{
            const rc = ROLE_COLORS[role]||C.gold;
            const locked = LOCKED_ROLES.has(role);
            const desc = ROLE_DESC[role];
            const rp = permsEdit[role]||{};
            return(
              <div key={role} style={{ background:C.card, border:`1px solid ${locked?rc+"44":C.brd}`, borderRadius:10, overflow:"hidden" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", borderBottom:`1px solid ${C.brd}`, background:locked?`${rc}08`:"transparent" }}>
                  <div style={{ width:34, height:34, borderRadius:"50%", background:`${rc}18`, border:`1px solid ${rc}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:rc, fontWeight:700, ...mono, flexShrink:0 }}>{role.slice(0,2).toUpperCase()}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                      <span style={{ fontSize:14, fontWeight:600, color:rc }}>{role}</span>
                      <span style={{ ...mono, fontSize:11, color:C.mut }}>{desc?.headline}</span>
                      {locked&&<span style={{ ...mono, fontSize:9, padding:"1px 6px", background:`${rc}18`, border:`1px solid ${rc}44`, color:rc, borderRadius:3 }}>LOCKED</span>}
                    </div>
                    <p style={{ ...mono, margin:"2px 0 0", fontSize:11, color:C.dim }}>{desc?.body}</p>
                  </div>
                  {!locked&&<button onClick={()=>resetRole(role)} style={{ ...mono, fontSize:10, padding:"2px 8px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer", flexShrink:0 }}>Reset</button>}
                </div>
                <div style={{ padding:"8px 0" }}>
                  {PERM_META.map(p=>{
                    const on = locked ? true : (rp[p.key]||false);
                    const defaultOn = (rolePerms[role]||{})[p.key]||false;
                    const changed = !locked && on !== defaultOn;
                    return(
                      <div key={p.key} style={{ display:"flex", alignItems:"center", gap:12, padding:"7px 16px", opacity:locked?0.6:1 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                            <span style={{ fontSize:13, color:on?C.txt:C.dim, fontWeight:on?500:400 }}>{p.label}</span>
                            {changed&&<span style={{ ...mono, fontSize:9, padding:"1px 5px", background:`${C.orange}18`, border:`1px solid ${C.orange}44`, color:C.orange, borderRadius:3 }}>modified</span>}
                          </div>
                          <p style={{ ...mono, margin:"1px 0 0", fontSize:11, color:C.dim }}>{p.desc}</p>
                        </div>
                        <button
                          disabled={locked}
                          onClick={()=>togglePerm(role, p.key)}
                          style={{ flexShrink:0, width:40, height:22, borderRadius:11, background:on?rc:"transparent", border:`1px solid ${on?rc:C.brdM}`, cursor:locked?"default":"pointer", position:"relative", transition:"background 0.15s" }}>
                          <span style={{ position:"absolute", top:2, left:on?20:2, width:16, height:16, borderRadius:"50%", background:on?"#fff":C.dim, transition:"left 0.15s" }}/>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </>)}

      {/* ── INTEGRATIONS TAB ── */}
      {tab==="apikeys"&&(
        <div>
          <p style={{ margin:"0 0 4px", fontSize:15, fontWeight:500, color:C.txt }}>Integrations</p>
          <p style={{ ...mono, margin:"0 0 14px", fontSize:12, color:C.mut }}>Stored locally in your browser only — never sent to any server other than the named service.</p>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>

            <GoogleConnections />

            {/* ── Salesforce ── */}
            <div style={{ background:C.card, border:`1px solid ${sfdcConnected?"#00A1E044":C.brd}`, borderRadius:8, padding:"14px 16px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                <p style={{ margin:0, fontSize:15, fontWeight:500, color:sfdcConnected?"#00A1E0":C.txt }}>Salesforce</p>
                <span style={{ ...mono, fontSize:10, color:C.dim, border:`1px solid ${C.brd}`, borderRadius:3, padding:"0 5px" }}>optional</span>
                <span style={{ ...mono, fontSize:11, color:sfdcConnected?C.green:C.dim, marginLeft:"auto" }}>{sfdcConnected?"● Connected":"○ Disconnected"}</span>
              </div>
              <p style={{ margin:"0 0 10px", fontSize:13, color:C.mut, lineHeight:1.5 }}>
                Connect via OAuth to pull My Accounts and Dormant accounts directly from SFDC — no CSV needed.{sfdcConnected&&sfdcUserName&&<span style={{ color:C.dim }}> Signed in as <span style={{ color:C.txt }}>{sfdcUserName}</span>.</span>}
              </p>
              {sfdcConnected ? (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    <button onClick={()=>syncFromSfdc("my_accounts")} disabled={!!sfdcSyncing}
                      style={{ fontSize:13, padding:"7px 16px", background:sfdcSyncing==="my_accounts"?"#001408":"#041408", border:`1px solid ${C.green}55`, color:C.green, borderRadius:5, cursor:sfdcSyncing?"default":"pointer", fontWeight:500, opacity:sfdcSyncing&&sfdcSyncing!=="my_accounts"?0.5:1 }}>
                      {sfdcSyncing==="my_accounts"?"Pulling…":"⊕ My Accounts"}
                    </button>
                    <button onClick={()=>syncFromSfdc("dormant")} disabled={!!sfdcSyncing}
                      style={{ fontSize:13, padding:"7px 16px", background:sfdcSyncing==="dormant"?"#0C0C00":"#1A1A00", border:`1px solid ${C.tin}55`, color:C.tin, borderRadius:5, cursor:sfdcSyncing?"default":"pointer", fontWeight:500, opacity:sfdcSyncing&&sfdcSyncing!=="dormant"?0.5:1 }}>
                      {sfdcSyncing==="dormant"?"Pulling…":"◎ Dormant → Pool"}
                    </button>
                    <button onClick={disconnectSfdc}
                      style={{ fontSize:12, padding:"7px 14px", background:"transparent", border:`1px solid ${C.red}44`, color:C.red, borderRadius:5, cursor:"pointer", marginLeft:"auto" }}>
                      Disconnect
                    </button>
                  </div>
                  {sfdcResult&&(
                    <div style={{ ...mono, fontSize:12, padding:"7px 12px", borderRadius:5, background:sfdcResult.error?"#1A0000":"#001408", border:`1px solid ${sfdcResult.error?C.red:C.green}44`, color:sfdcResult.error?C.red:C.green }}>
                      {sfdcResult.error ? `✕ ${sfdcResult.error}` : `✓ ${sfdcResult.count} account${sfdcResult.count!==1?"s":""} pulled from ${sfdcResult.mode==="dormant"?"Dormant → Claim Jumper pool":"My Accounts → territory"}. Run assay to score.`}
                    </div>
                  )}
                  <p style={{ ...mono, margin:0, fontSize:11, color:C.dim, lineHeight:1.5 }}>Pulls: Account Name, Website, Owner, Billing State, Vertical, Subvertical, Last Activity Date, Account ID. Accounts are added without scores — run a batch assay from Uploads to analyze them.</p>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <button onClick={()=>{ window.location.href="/api/sfdc/auth"; }}
                      style={{ fontSize:13, padding:"7px 18px", background:"#001828", border:"1px solid #00A1E066", color:"#00A1E0", borderRadius:5, cursor:"pointer", fontWeight:600 }}>
                      Connect via OAuth →
                    </button>
                    <button onClick={()=>setSfdcManual(m=>!m)}
                      style={{ fontSize:12, padding:"7px 14px", background:"transparent", border:`1px solid ${C.brd}`, color:C.mut, borderRadius:5, cursor:"pointer" }}>
                      {sfdcManual?"Cancel":"Paste token manually"}
                    </button>
                  </div>
                  {sfdcManual&&(
                    <div style={{ display:"flex", flexDirection:"column", gap:7, padding:"12px 14px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:7 }}>
                      <p style={{ ...mono, margin:"0 0 4px", fontSize:10, color:C.dim, textTransform:"uppercase", letterSpacing:"0.08em" }}>From: <code style={{ color:C.txt }}>sf org display --verbose</code></p>
                      {[["Access Token","token","eyJ0eXAiOiJKV1QiLCJh…"],["Instance URL","instance","https://your-org.my.salesforce.com"],["User ID (optional)","userId","0055g000000xxxABC"]].map(([label,key,ph])=>(
                        <div key={key}>
                          <div style={{ ...mono, fontSize:10, color:C.dim, marginBottom:3 }}>{label}</div>
                          <input type={key==="token"?"password":"text"} value={sfdcManualInputs[key]} onChange={e=>setSfdcManualInputs(p=>({...p,[key]:e.target.value}))} placeholder={ph}
                            style={{ ...mono, width:"100%", boxSizing:"border-box", fontSize:12, padding:"6px 10px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt, outline:"none" }}/>
                        </div>
                      ))}
                      <button onClick={connectSfdcManual} disabled={!sfdcManualInputs.token.trim()||!sfdcManualInputs.instance.trim()}
                        style={{ fontSize:13, padding:"7px 14px", background:sfdcManualInputs.token&&sfdcManualInputs.instance?"#001828":"transparent", border:`1px solid ${sfdcManualInputs.token&&sfdcManualInputs.instance?"#00A1E066":C.brd}`, color:sfdcManualInputs.token&&sfdcManualInputs.instance?"#00A1E0":C.dim, borderRadius:5, cursor:sfdcManualInputs.token&&sfdcManualInputs.instance?"pointer":"default", fontWeight:600, alignSelf:"flex-start" }}>
                        Connect →
                      </button>
                    </div>
                  )}
                  <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>OAuth requires a Connected App. Manual token works with the Salesforce CLI.</p>
                </div>
              )}
            </div>

            {INTEGRATION_DEFS.map(def=>{
              const connected=isConnected(def);
              const maskedKey=connected?`${getKeyValue(def).slice(0,8)}${"•".repeat(16)}`:"";
              return(
                <div key={def.id} style={{ background:C.card, border:`1px solid ${connected?def.color+"44":C.brd}`, borderRadius:8, padding:"14px 16px" }}>
                  <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                        <p style={{ margin:0, fontSize:15, fontWeight:500, color:connected?def.color:C.txt }}>{def.name}</p>
                        {def.required&&<span style={{ ...mono, fontSize:10, color:C.orange, border:`1px solid ${C.orange}44`, borderRadius:3, padding:"0 5px" }}>required</span>}
                        <span style={{ ...mono, fontSize:11, color:connected?C.green:C.dim, marginLeft:"auto" }}>{connected?"● Connected":"○ Disconnected"}</span>
                      </div>
                      <p style={{ margin:"0 0 10px", fontSize:13, color:C.mut, lineHeight:1.5 }}>{def.desc}</p>
                      {connected
                        ? <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                            <span style={{ ...mono, fontSize:12, color:C.dim, background:C.bg, border:`1px solid ${C.brd}`, borderRadius:4, padding:"4px 10px" }}>{maskedKey}</span>
                            <button onClick={()=>disconnectIntegration(def.id,def.storageKey)} style={{ fontSize:12, padding:"4px 12px", background:"transparent", border:`1px solid ${C.red}44`, color:C.red, borderRadius:5, cursor:"pointer" }}>Disconnect</button>
                          </div>
                        : <div style={{ display:"flex", gap:8 }}>
                            <input type="password" placeholder={`Paste ${def.keyLabel}`} value={keyInputs[def.id]||""} onChange={e=>setKeyInputs(p=>({...p,[def.id]:e.target.value}))} style={{ ...mono, fontSize:13, padding:"7px 10px", background:C.sur, border:`1px solid ${C.brd}`, borderRadius:5, color:C.txt, outline:"none", width:280, boxSizing:"border-box" }}/>
                            <button onClick={()=>connectIntegration(def.id,def.storageKey)} style={{ fontSize:13, padding:"7px 14px", background:C.sur, border:`1px solid ${def.color}66`, color:def.color, borderRadius:5, cursor:"pointer", fontWeight:500 }}>Connect →</button>
                          </div>
                      }

                      {/* Hunter.io: live connection test + quota display + key-handling warning */}
                      {def.id === 'hunter' && (
                        <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${C.brd}` }}>
                          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                            <button onClick={testHunterConnection} disabled={hunterTesting}
                              style={{ ...mono, fontSize:11, padding:"4px 12px", background:`${def.color}14`, border:`1px solid ${def.color}66`, color:def.color, borderRadius:4, cursor:hunterTesting?'default':'pointer' }}>
                              {hunterTesting ? "Testing…" : "✓ Test connection"}
                            </button>
                            {hunterAccount && (
                              <span style={{ ...mono, fontSize:11, color:C.dim }}>
                                {hunterAccount.plan && <span style={{ color:def.color, marginRight:8 }}>{hunterAccount.plan}</span>}
                                {hunterAccount.searches && <span>searches {hunterAccount.searches.used}/{hunterAccount.searches.available}</span>}
                                {hunterAccount.verifications && <span style={{ marginLeft:8 }}>verifications {hunterAccount.verifications.used}/{hunterAccount.verifications.available}</span>}
                              </span>
                            )}
                            {hunterTestError && (
                              <span style={{ ...mono, fontSize:11, color:C.red }}>⚠ {hunterTestError}</span>
                            )}
                          </div>
                          <p style={{ ...mono, margin:"8px 0 0", fontSize:10, color:C.orange, opacity:0.8 }}>
                            ⚠ Key stored locally — move to server env (HUNTER_API_KEY) for production
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div style={{ background:C.card, border:`1px solid #0088CC44`, borderRadius:8, padding:"14px 16px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                <p style={{ margin:0, fontSize:15, fontWeight:500, color:"#0099DD" }}>6sense</p>
                <span style={{ ...mono, fontSize:10, color:C.orange, border:`1px solid ${C.orange}44`, borderRadius:3, padding:"0 5px" }}>required</span>
                <span style={{ ...mono, fontSize:11, color:C.blue, marginLeft:"auto" }}>● CSV Upload</span>
              </div>
              <p style={{ margin:"0 0 10px", fontSize:13, color:C.mut, lineHeight:1.5 }}>Intent data and account enrichment via CSV export. No API key — upload enrichment files directly through the Uploads flow.</p>
              <button style={{ fontSize:13, padding:"6px 14px", background:"#001828", border:"1px solid #0088CC44", color:"#0099DD", borderRadius:5, cursor:"pointer", fontWeight:500 }}>Go to Uploads →</button>
            </div>


          </div>
        </div>
      )}

      {/* ── PRICING TAB ── */}
      {tab==="pricing"&&(()=>{
        const TYPE_OPTS = [
          { value:"S", label:"S — Per new user (single/onboarding)" },
          { value:"R", label:"R — Per active user (recurring)" },
          { value:"T", label:"T — On-demand (per call)" },
        ];
        const GROUP_OPTS = ["Standard","Moderate","Flexible","Limited"];
        const overrides = pricingOverrides;
        const save = (id, patch) => {
          const next = { ...overrides, [id]: { ...(overrides[id]||{}), ...patch } };
          setPricingOverrides(next);
          localStorage.setItem(PRODUCTS_OVERRIDE_KEY, JSON.stringify(next));
        };
        const reset = (id) => {
          const next = { ...overrides };
          delete next[id];
          setPricingOverrides(next);
          localStorage.setItem(PRODUCTS_OVERRIDE_KEY, JSON.stringify(next));
        };
        const filteredProducts = PRICING_PRODUCTS_DEFAULT.filter(p =>
          !pricingSearch.trim() || p.name.toLowerCase().includes(pricingSearch.toLowerCase())
        );
        const overrideCount = Object.keys(overrides).length;
        return (
          <div>
            <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:16 }}>
              <div style={{ flex:1 }}>
                <p style={{ ...mono, margin:"0 0 4px", fontSize:13, color:C.txt, fontWeight:600 }}>Product Defaults</p>
                <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>Override rack rates, billing type, and discount groups. Changes apply to all new and existing pricing sessions. Custom rates on saved deals are preserved.</p>
              </div>
              {overrideCount > 0 && <span style={{ ...mono, fontSize:11, color:C.gold, background:`${C.gold}14`, border:`1px solid ${C.gold}44`, borderRadius:4, padding:"3px 10px", flexShrink:0 }}>{overrideCount} override{overrideCount!==1?"s":""}</span>}
            </div>
            <input value={pricingSearch} onChange={e=>setPricingSearch(e.target.value)} placeholder="Filter products…"
              style={{ ...mono, fontSize:12, padding:"7px 11px", background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", marginBottom:10 }}/>
            <div style={{ border:`1px solid ${C.brd}`, borderRadius:8, overflow:"hidden" }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 90px 220px 130px 60px", padding:"6px 12px", background:C.card, borderBottom:`1px solid ${C.brd}` }}>
                {["Product","Rack ($)","Type","Discount Group",""].map((h,i)=>(
                  <span key={i} style={{ ...mono, fontSize:9, color:C.dim, textAlign:i===1?"right":"left", textTransform:"uppercase", letterSpacing:"0.07em" }}>{h}</span>
                ))}
              </div>
              <div style={{ maxHeight:520, overflowY:"auto" }}>
                {filteredProducts.map((p, i) => {
                  const ov = overrides[p.id] || {};
                  const changed = !!overrides[p.id];
                  const rack = ov.rack ?? p.rack;
                  const type = ov.type ?? p.type;
                  const dg   = ov.discountGroup ?? p.discountGroup;
                  return (
                    <div key={p.id} style={{ display:"grid", gridTemplateColumns:"1fr 90px 220px 130px 60px", alignItems:"center", padding:"5px 12px", borderBottom:i<filteredProducts.length-1?`1px solid ${C.brd}22`:"none", background:changed?`${C.gold}07`:"transparent" }}>
                      <span style={{ ...mono, fontSize:11, color:changed?C.gold:C.txt, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", paddingRight:8 }} title={p.name}>{p.name}</span>
                      <input type="number" step="0.001" min="0" value={rack ?? ""}
                        onChange={e => { const v = parseFloat(e.target.value); save(p.id, { rack: isNaN(v) ? null : v }); }}
                        style={{ ...mono, fontSize:11, padding:"3px 6px", background:C.bg, border:`1px solid ${(ov.rack!=null)?C.gold+"66":C.brd}`, borderRadius:4, color:C.txt, textAlign:"right", width:"100%", boxSizing:"border-box" }}
                      />
                      <select value={type} onChange={e=>save(p.id,{type:e.target.value})}
                        style={{ ...mono, fontSize:11, padding:"3px 6px", background:C.bg, border:`1px solid ${ov.type?C.gold+"66":C.brd}`, borderRadius:4, color:ov.type?C.gold:C.txt, cursor:"pointer" }}>
                        {TYPE_OPTS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <select value={dg} onChange={e=>save(p.id,{discountGroup:e.target.value})}
                        style={{ ...mono, fontSize:11, padding:"3px 6px", background:C.bg, border:`1px solid ${ov.discountGroup?C.gold+"66":C.brd}`, borderRadius:4, color:ov.discountGroup?C.gold:C.txt, cursor:"pointer" }}>
                        {GROUP_OPTS.map(o=><option key={o} value={o}>{o}</option>)}
                      </select>
                      <div style={{ textAlign:"center" }}>
                        {changed && <button onClick={()=>reset(p.id)} style={{ ...mono, fontSize:10, padding:"2px 7px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:4, color:C.dim, cursor:"pointer" }} title="Reset to default">↺</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}


      {/* ── ACCESS LOG TAB ── */}
      {tab==="accesslog"&&<AccessLogTab/>}
      {tab==="zoomevents"&&<ZoomEventsTab/>}

      {/* ── OUTREACH INTELLIGENCE TAB ── */}
      {tab==="doctrine"&&<OutreachIntelligenceTab currentUser={currentUser}/>}


      {/* ── SETTINGS TAB ── */}
      {tab==="settings"&&(()=>{
        const diamondsOn=localStorage.getItem("prospector_diamonds_enabled")!=="false";
        const toggle=()=>{ localStorage.setItem("prospector_diamonds_enabled",diamondsOn?"false":"true"); setTab(""); setTimeout(()=>setTab("settings"),0); };

        const exportData = () => {
          const data = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith("prospector_")) data[key] = localStorage.getItem(key);
          }
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `prospector-backup-${new Date().toISOString().slice(0,10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
        };

        const importData = (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              const data = JSON.parse(ev.target.result);
              let count = 0;
              Object.entries(data).forEach(([k, v]) => {
                if (k.startsWith("prospector_")) { localStorage.setItem(k, v); count++; }
              });
              alert(`✓ Imported ${count} keys. Reloading…`);
              window.location.reload();
            } catch { alert("Invalid backup file."); }
          };
          reader.readAsText(file);
          e.target.value = "";
        };

        return (
          <div>
            <p style={{ ...mono, margin:"0 0 18px", fontSize:11, color:C.dim }}>Feature flags and system toggles</p>

            {/* Export / Import */}
            <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:"16px 18px", marginBottom:16 }}>
              <p style={{ margin:"0 0 4px", fontSize:14, color:C.txt, fontWeight:500 }}>📦 Data Backup & Restore</p>
              <p style={{ ...mono, margin:"0 0 14px", fontSize:11, color:C.dim }}>Export all your accounts, pricing, tasks, and settings to a file. Import on any device or after a fresh deploy to Render.</p>
              <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                <button onClick={exportData} style={{ ...mono, fontSize:12, padding:"8px 20px", background:`${C.gold}18`, border:`1px solid ${C.gold}55`, color:C.gold, borderRadius:6, cursor:"pointer", fontWeight:600 }}>
                  ↓ Export all data
                </button>
                <label style={{ ...mono, fontSize:12, padding:"8px 20px", background:`${C.blue}14`, border:`1px solid ${C.blue}44`, color:C.blue, borderRadius:6, cursor:"pointer", fontWeight:600 }}>
                  ↑ Import backup
                  <input type="file" accept=".json" onChange={importData} style={{ display:"none" }} />
                </label>
              </div>
            </div>


            {/* Supabase sync */}
            {isSupabaseEnabled() && !supabaseSeeded && (
              <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:"16px 18px", marginBottom:16 }}>
                <p style={{ margin:"0 0 3px", fontSize:14, color:C.txt, fontWeight:500 }}>☁ Sync to Supabase</p>
                <p style={{ ...mono, margin:"0 0 14px", fontSize:11, color:C.dim }}>One-time seed — pushes current team roster and frontier to Supabase so all users share live data. Only needs to run once.</p>
                <button
                  onClick={async()=>{
                    setSupabaseSyncing(true);
                    try{
                      const tu=JSON.parse(localStorage.getItem('prospector_team_users')||'[]');
                      const fr=JSON.parse(localStorage.getItem('prospector_frontier')||'[]');
                      await saveTeamUsers(tu);
                      await saveFrontier(fr.filter(f=>!f.isDemo));
                      localStorage.setItem('prospector_supabase_seeded','true');
                      setSupabaseSeeded(true);
                    }catch(e){ alert('Sync failed: '+e.message); }
                    setSupabaseSyncing(false);
                  }}
                  disabled={supabaseSyncing}
                  style={{ ...mono, fontSize:12, padding:"8px 20px", background:`${C.blue}14`, border:`1px solid ${C.blue}44`, color:C.blue, borderRadius:6, cursor:supabaseSyncing?'default':'pointer', fontWeight:600, opacity:supabaseSyncing?0.6:1 }}>
                  {supabaseSyncing ? 'Syncing…' : '↑ Sync to Supabase'}
                </button>
              </div>
            )}
            {isSupabaseEnabled() && supabaseSeeded && (
              <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:"16px 18px", marginBottom:16, display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ ...mono, fontSize:13, color:C.green }}>● Supabase live</span>
                <span style={{ ...mono, fontSize:11, color:C.dim, flex:1 }}>Team and frontier syncing in real-time across all sessions.</span>
                <button onClick={()=>{ localStorage.removeItem('prospector_supabase_seeded'); setSupabaseSeeded(false); }}
                  style={{ ...mono, fontSize:10, padding:"3px 8px", background:"transparent", border:`1px solid ${C.brd}`, color:C.dim, borderRadius:4, cursor:"pointer" }}>
                  Re-sync
                </button>
              </div>
            )}

            {/* Diamonds toggle */}
            <div style={{ background:C.card, border:`1px solid ${C.brd}`, borderRadius:8, padding:"16px 18px", display:"flex", alignItems:"center", gap:16 }}>
              <div style={{ flex:1 }}>
                <p style={{ margin:"0 0 3px", fontSize:14, color:C.txt, fontWeight:500 }}>💎 Diamond Token System</p>
                <p style={{ ...mono, margin:0, fontSize:11, color:C.dim }}>Tracks diamonds earned for territory activity. Shows in profile panel with commission calculator.</p>
              </div>
              <button onClick={toggle}
                style={{ ...mono, fontSize:12, padding:"7px 18px", borderRadius:6, cursor:"pointer", fontWeight:600, flexShrink:0,
                  background: diamondsOn?`${C.green}18`:`${C.red}12`,
                  border: `1px solid ${diamondsOn?C.green+"55":C.red+"44"}`,
                  color: diamondsOn?C.green:C.red }}>
                {diamondsOn?"● Diamonds ON":"○ Diamonds OFF"}
              </button>
            </div>
          </div>
        );
      })()}



    </div>
  );
}

export default AdminPage;
