import { useState, useEffect, useCallback } from 'react';
import { C, mono } from '../constants/colors';
import { getHandoffIntels, updateHandoffStatus } from '../utils/db';

const STATUS_COLORS = {
  pending:  { bg: `${C.gold}18`,   bdr: `${C.gold}55`,   txt: C.gold    },
  accepted: { bg: `${C.green}14`,  bdr: `${C.green}44`,  txt: C.green   },
  declined: { bg: '#3a0a0a',       bdr: '#cc333344',      txt: '#cc4444' },
};

const srcColor = s => s === 'DiscoCoach' ? '#00B4D8' : s === 'BDR' ? C.blue : C.dim;

function StatusBadge({ status }) {
  const sc = STATUS_COLORS[status] || STATUS_COLORS.pending;
  return (
    <span style={{ ...mono, fontSize: 9, padding: '2px 8px', borderRadius: 10,
      background: sc.bg, border: `1px solid ${sc.bdr}`, color: sc.txt,
      textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
      {status || 'pending'}
    </span>
  );
}

function SortIcon({ active, dir }) {
  if (!active) return <span style={{ color: C.dim, marginLeft: 3, fontSize: 9 }}>⇅</span>;
  return <span style={{ color: C.gold, marginLeft: 3, fontSize: 9 }}>{dir === 'asc' ? '↑' : '↓'}</span>;
}

export default function HandoffsPage({ accounts, onAddAccount, activeUser, activeRole, teamUsers = [] }) {
  const [tab, setTab]             = useState('queue');
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [sortCol, setSortCol]     = useState('updated_at');
  const [sortDir, setSortDir]     = useState('desc');
  const [filterStatus, setFilter] = useState('all');
  const [filterAE, setFilterAE]   = useState('all');
  const [selected, setSelected]   = useState(null);
  const [declining, setDeclining] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [saving, setSaving]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getHandoffIntels();
    setRows(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Sorting ───────────────────────────────────────────────────────────────
  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  // ── Filtering ─────────────────────────────────────────────────────────────
  const isManager = activeRole === 'Manager' || activeRole === 'Admin' || activeRole === 'Owner';
  const aeEmail   = activeUser?.email || '';

  const visible = rows
    .filter(r => filterStatus === 'all' || (r.status || 'pending') === filterStatus)
    .filter(r => {
      if (!isManager) {
        // AE sees rows matching their ae_email or ae_sfdc — or all if no match possible
        if (!aeEmail) return true;
        return (r.ae_email || '') === aeEmail || !r.ae_email;
      }
      if (filterAE === 'all') return true;
      return (r.ae_email || '') === filterAE || (r.ae_sfdc || '') === filterAE;
    })
    .sort((a, b) => {
      const av = a[sortCol] || '';
      const bv = b[sortCol] || '';
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });

  // Unique AEs for manager filter
  const aeOptions = [...new Set(rows.map(r => r.ae_email || r.ae_sfdc).filter(Boolean))];

  // ── Actions ───────────────────────────────────────────────────────────────
  const acceptHandoff = async (row) => {
    setSaving(true);
    const debrief  = row.debrief_result;
    const payload  = row.raw_payload?.f || {};
    const contacts = row.contacts || [];
    const today    = new Date().toISOString().slice(0, 10);

    const newAcc = {
      id:          Date.now(),
      name:        row.company,
      web:         payload.website   || '',
      sfdc:        payload.sflink    || row.sfdc_link || '',
      linkedin:    payload.linkedin  || '',
      vert:        'Unknown',
      stage:       'Qualified',
      tier:        'Silver',
      notes:       row.intel         || '',
      handoffNotes: row.intel        || '',
      last:        row.meeting_date  || today,
      addedAt:     today,
      addedSource: 'DiscoCoach',
      isHandoff:   true,
      prods:       debrief?.useCases || [],
      medpicc:     debrief?.medpiccUpdates
        ? Object.fromEntries(Object.entries(debrief.medpiccUpdates).filter(([, v]) => v))
        : {},
      nextSteps: (debrief?.nextSteps || []).map((ns, i) => ({
        id: `hoff_${Date.now()}_${i}`,
        text: typeof ns === 'string' ? ns : ns.text || '',
        done: false,
        source: 'DiscoCoach',
        createdAt: today,
      })),
      calls: debrief ? [{
        id:               Date.now(),
        date:             row.meeting_date || today,
        summary:          debrief.summary || '',
        callQuality:      debrief.callQuality || 'Neutral',
        painPoints:       debrief.painPoints || [],
        productsDiscussed: debrief.productsDiscussed || [],
        keySignals:       debrief.keySignals || [],
        nextSteps:        debrief.nextSteps || [],
        medpiccUpdates:   debrief.medpiccUpdates || {},
        source:           'DiscoCoach',
      }] : [],
      personas: contacts.map((c, i) => ({
        id:    `hoff_p_${i}`,
        name:  c.name  || '',
        title: c.title || '',
        email: c.email || '',
        notes: '',
      })).filter(p => p.name),
    };

    if (onAddAccount) onAddAccount(newAcc);

    const updated = { status: 'accepted', accepted_account_id: String(newAcc.id) };
    await updateHandoffStatus(row.event_id, updated);
    setRows(rs => rs.map(r => r.event_id === row.event_id ? { ...r, ...updated } : r));
    if (selected?.event_id === row.event_id) setSelected(r => ({ ...r, ...updated }));
    setSaving(false);
  };

  const declineHandoff = async () => {
    if (!declining) return;
    setSaving(true);
    const updated = { status: 'declined', decline_reason: declineReason.trim() || null };
    await updateHandoffStatus(declining.event_id, updated);
    setRows(rs => rs.map(r => r.event_id === declining.event_id ? { ...r, ...updated } : r));
    if (selected?.event_id === declining.event_id) setSelected(r => ({ ...r, ...updated }));
    setDeclining(null);
    setDeclineReason('');
    setSaving(false);
  };

  // ── Table header cell ─────────────────────────────────────────────────────
  const Th = ({ col, label, w }) => (
    <th onClick={() => handleSort(col)}
      style={{ ...mono, fontSize: 9, color: sortCol === col ? C.gold : C.dim, textTransform: 'uppercase',
        letterSpacing: '0.07em', padding: '8px 10px', cursor: 'pointer', userSelect: 'none',
        width: w, textAlign: 'left', background: '#080e18', fontWeight: 600,
        borderBottom: `1px solid ${C.brd}`, whiteSpace: 'nowrap' }}>
      {label}<SortIcon active={sortCol === col} dir={sortDir} />
    </th>
  );

  // ── Side panel ────────────────────────────────────────────────────────────
  const panel = selected ? (() => {
    const r = selected;
    const debrief = r.debrief_result;
    const payload = r.raw_payload?.f || {};
    const aeCtx   = r.raw_payload?.ae || {};
    const contacts = r.contacts || [];
    const painPts  = r.pain_points || debrief?.painPoints || [];
    const status   = r.status || 'pending';
    const linkedAcc = r.accepted_account_id
      ? accounts?.find(a => String(a.id) === String(r.accepted_account_id))
      : null;

    return (
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
        background: '#07101a', borderLeft: `1px solid ${C.brd}`, zIndex: 200,
        display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${C.brd}`,
          display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: C.txt }}>{r.company}</span>
              <StatusBadge status={status} />
              <span style={{ ...mono, fontSize: 9, color: srcColor(r.source), border: `1px solid ${srcColor(r.source)}44`,
                padding: '1px 7px', borderRadius: 8 }}>{r.source || 'BDR'}</span>
            </div>
            <div style={{ ...mono, fontSize: 10, color: C.dim }}>
              {r.meeting_date || r.ae_meeting_time || '—'} · received {r.updated_at?.slice(0, 10)}
              {r.ae_email && ` · ${r.ae_email}`}
            </div>
          </div>
          <button onClick={() => setSelected(null)}
            style={{ ...mono, fontSize: 16, color: C.dim, background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Debrief summary */}
          {debrief?.summary && (
            <Section label="Call Summary" color={C.green}>
              <p style={{ margin: 0, fontSize: 12, color: C.txt, lineHeight: 1.7 }}>{debrief.summary}</p>
              {debrief.callQuality && <span style={{ ...mono, fontSize: 9, marginTop: 6, display: 'inline-block',
                color: debrief.callQuality === 'Strong' ? C.green : debrief.callQuality === 'Weak' ? '#cc4444' : C.dim,
                background: debrief.callQuality === 'Strong' ? `${C.green}14` : 'transparent',
                border: `1px solid ${debrief.callQuality === 'Strong' ? C.green+'33' : C.brd}`,
                padding: '1px 8px', borderRadius: 8 }}>{debrief.callQuality}</span>}
            </Section>
          )}

          {/* Pain points */}
          {painPts.length > 0 && (
            <Section label="Pain Points" color={C.orange}>
              {painPts.map((p, i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <span style={{ ...mono, fontSize: 10, fontWeight: 600, color: C.orange }}>{p.topic || `Pain ${i+1}`}</span>
                  {p.detail && <p style={{ ...mono, margin: '1px 0 0', fontSize: 11, color: C.mut, lineHeight: 1.5 }}>{p.detail}</p>}
                  {p.solution && <p style={{ ...mono, margin: '1px 0 0', fontSize: 10, color: C.green }}>→ {p.solution}</p>}
                </div>
              ))}
            </Section>
          )}

          {/* Key signals */}
          {(r.key_signals?.length || debrief?.keySignals?.length) && (
            <Section label="Key Signals" color="#00B4D8">
              {(r.key_signals || debrief?.keySignals || []).map((s, i) => (
                <p key={i} style={{ ...mono, margin: '2px 0', fontSize: 11, color: C.mut }}>· {s}</p>
              ))}
            </Section>
          )}

          {/* Intel text */}
          {r.intel && (
            <Section label="Intel Notes" color={C.dim}>
              <pre style={{ ...mono, margin: 0, fontSize: 11, color: C.mut, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.intel}</pre>
            </Section>
          )}

          {/* Contacts */}
          {contacts.length > 0 && (
            <Section label="Contacts" color={C.blue}>
              {contacts.map((c, i) => (
                <div key={i} style={{ marginBottom: 5, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: `${C.blue}22`,
                    border: `1px solid ${C.blue}44`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: C.blue, fontWeight: 700, flexShrink: 0 }}>
                    {(c.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ ...mono, fontSize: 11, color: C.txt, fontWeight: 600 }}>{c.name}</div>
                    {c.title && <div style={{ ...mono, fontSize: 10, color: C.dim }}>{c.title}</div>}
                    {c.email && <div style={{ ...mono, fontSize: 10, color: C.blue }}>{c.email}</div>}
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* MEDPICC from debrief */}
          {debrief?.medpiccUpdates && Object.values(debrief.medpiccUpdates).some(v => v) && (
            <Section label="MEDPICC" color={C.gold}>
              {Object.entries(debrief.medpiccUpdates).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 5 }}>
                  <span style={{ ...mono, fontSize: 9, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {k.replace(/_/g, ' ')}
                  </span>
                  <p style={{ ...mono, margin: '1px 0 0', fontSize: 11, color: C.mut, lineHeight: 1.5 }}>{v}</p>
                </div>
              ))}
            </Section>
          )}

          {/* Prospect email */}
          {r.raw_payload?.email && (
            <Section label="Prospect Email" color={C.mut}>
              <pre style={{ ...mono, margin: 0, fontSize: 11, color: C.mut, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.raw_payload.email}</pre>
            </Section>
          )}

          {/* AE Slack */}
          {r.raw_payload?.slack && (
            <Section label="AE Slack Message" color={C.purple}>
              <pre style={{ ...mono, margin: 0, fontSize: 11, color: C.mut, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.raw_payload.slack}</pre>
            </Section>
          )}

          {/* Volume context */}
          {(payload.vol_count || payload.dev_employees || payload.funding) && (
            <Section label="Company Context" color={C.dim}>
              {payload.vol_count     && <p style={{ ...mono, margin: '2px 0', fontSize: 11, color: C.mut }}>Volume: {payload.vol_count}</p>}
              {payload.dev_employees && <p style={{ ...mono, margin: '2px 0', fontSize: 11, color: C.mut }}>Employees: {payload.dev_employees}</p>}
              {payload.dev_devs      && <p style={{ ...mono, margin: '2px 0', fontSize: 11, color: C.mut }}>Devs: {payload.dev_devs}</p>}
              {payload.funding       && <p style={{ ...mono, margin: '2px 0', fontSize: 11, color: C.mut }}>Funding: {payload.funding}</p>}
            </Section>
          )}

          {/* AE context */}
          {(aeCtx.ae_calllink || aeCtx.ae_discogong) && (
            <Section label="AE Links" color={C.dim}>
              {aeCtx.ae_calllink  && <a href={aeCtx.ae_calllink}  target="_blank" rel="noreferrer" style={{ ...mono, fontSize: 11, color: C.blue, display: 'block', marginBottom: 3 }}>🔗 Call link</a>}
              {aeCtx.ae_discogong && <a href={aeCtx.ae_discogong} target="_blank" rel="noreferrer" style={{ ...mono, fontSize: 11, color: '#00B4D8', display: 'block' }}>⬡ Gong recording</a>}
            </Section>
          )}

          {/* Pricing */}
          {r.pricing_notes && (
            <Section label="Pricing Notes (WTP)" color={C.gold}>
              <p style={{ ...mono, margin: 0, fontSize: 11, color: C.mut, lineHeight: 1.5 }}>{r.pricing_notes}</p>
            </Section>
          )}
        </div>

        {/* Action footer */}
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.brd}`, display: 'flex', gap: 8 }}>
          {status === 'pending' && (
            <>
              <button onClick={() => acceptHandoff(r)} disabled={saving}
                style={{ flex: 1, fontSize: 12, padding: '8px 0', background: `${C.green}18`,
                  border: `1px solid ${C.green}55`, color: C.green, borderRadius: 6, cursor: saving ? 'default' : 'pointer', fontWeight: 600 }}>
                {saving ? '…' : '✓ Accept → Add to Territory'}
              </button>
              <button onClick={() => { setDeclining(r); setDeclineReason(''); }}
                style={{ fontSize: 12, padding: '8px 14px', background: 'transparent',
                  border: `1px solid #cc333355`, color: '#cc4444', borderRadius: 6, cursor: 'pointer' }}>
                Decline
              </button>
            </>
          )}
          {status === 'accepted' && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ ...mono, fontSize: 11, color: C.green }}>✓ Accepted</span>
              {linkedAcc && (
                <span style={{ ...mono, fontSize: 11, color: C.dim }}>→ {linkedAcc.name}</span>
              )}
            </div>
          )}
          {status === 'declined' && (
            <div style={{ flex: 1 }}>
              <span style={{ ...mono, fontSize: 11, color: '#cc4444' }}>Declined</span>
              {r.decline_reason && <span style={{ ...mono, fontSize: 11, color: C.dim }}> — {r.decline_reason}</span>}
              <button onClick={() => {
                updateHandoffStatus(r.event_id, { status: 'pending', decline_reason: null });
                setRows(rs => rs.map(x => x.event_id === r.event_id ? { ...x, status: 'pending', decline_reason: null } : x));
                setSelected(x => ({ ...x, status: 'pending', decline_reason: null }));
              }} style={{ ...mono, marginLeft: 10, fontSize: 10, padding: '2px 8px', background: 'transparent',
                border: `1px solid ${C.brd}`, color: C.dim, borderRadius: 3, cursor: 'pointer' }}>
                Reopen
              </button>
            </div>
          )}
        </div>
      </div>
    );
  })() : null;

  // ── Render ────────────────────────────────────────────────────────────────
  const counts = { all: rows.length, pending: rows.filter(r => (r.status||'pending')==='pending').length,
    accepted: rows.filter(r => r.status==='accepted').length, declined: rows.filter(r => r.status==='declined').length };

  return (
    <div style={{ position: 'relative' }}>
      {/* Decline modal */}
      {declining && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000aa', zIndex: 300,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10,
            padding: '20px 22px', width: 360 }}>
            <p style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: C.txt }}>Decline {declining.company}?</p>
            <input value={declineReason} onChange={e => setDeclineReason(e.target.value)}
              placeholder="Reason (optional)" autoFocus
              style={{ width: '100%', fontSize: 12, padding: '7px 10px', background: C.sur,
                border: `1px solid ${C.brd}`, borderRadius: 5, color: C.txt, outline: 'none',
                boxSizing: 'border-box', marginBottom: 12, fontFamily: 'inherit' }}
              onKeyDown={e => { if (e.key === 'Enter') declineHandoff(); if (e.key === 'Escape') setDeclining(null); }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={declineHandoff} disabled={saving}
                style={{ flex: 1, fontSize: 12, padding: '7px 0', background: '#3a0a0a',
                  border: '1px solid #cc333355', color: '#cc4444', borderRadius: 5, cursor: 'pointer' }}>
                {saving ? '…' : 'Decline'}
              </button>
              <button onClick={() => setDeclining(null)}
                style={{ fontSize: 12, padding: '7px 14px', background: 'transparent',
                  border: `1px solid ${C.brd}`, color: C.dim, borderRadius: 5, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay tint when panel open */}
      {selected && (
        <div onClick={() => setSelected(null)}
          style={{ position: 'fixed', inset: 0, background: '#00000055', zIndex: 199 }} />
      )}
      {panel}

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <p style={{ margin: '0 0 2px', fontSize: 17, fontWeight: 700, color: C.txt }}>🤝 Handoffs</p>
          <p style={{ ...mono, margin: 0, fontSize: 11, color: C.dim }}>Incoming Disco Coach handoffs — accept to add to territory</p>
        </div>
        <button onClick={load} disabled={loading}
          style={{ ...mono, fontSize: 11, padding: '5px 12px', background: 'transparent',
            border: `1px solid ${C.brd}`, color: C.dim, borderRadius: 5, cursor: 'pointer' }}>
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.brd}`, paddingBottom: 0 }}>
        {[['queue','Queue'],['analytics','Analytics']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ ...mono, fontSize: 12, padding: '6px 16px', background: 'transparent', cursor: 'pointer',
              border: 'none', borderBottom: `2px solid ${tab === id ? C.gold : 'transparent'}`,
              color: tab === id ? C.gold : C.dim, marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'analytics' && <HandoffAnalytics rows={rows} teamUsers={teamUsers} loading={loading} />}

      {tab === 'queue' && <>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {['all','pending','accepted','declined'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ ...mono, fontSize: 11, padding: '4px 12px', borderRadius: 5, cursor: 'pointer',
              background: filterStatus === s ? `${C.gold}14` : 'transparent',
              border: `1px solid ${filterStatus === s ? C.goldBdr : C.brd}`,
              color: filterStatus === s ? C.gold : C.dim }}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
            <span style={{ marginLeft: 5, opacity: 0.6 }}>({counts[s]})</span>
          </button>
        ))}
        {isManager && aeOptions.length > 0 && (
          <select value={filterAE} onChange={e => setFilterAE(e.target.value)}
            style={{ ...mono, fontSize: 11, padding: '4px 10px', background: C.sur,
              border: `1px solid ${C.brd}`, borderRadius: 5, color: C.dim, marginLeft: 'auto', cursor: 'pointer' }}>
            <option value="all">All AEs</option>
            {aeOptions.map(ae => <option key={ae} value={ae}>{ae}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <p style={{ ...mono, fontSize: 12, color: C.dim, padding: '20px 0' }}>Loading handoffs…</p>
      ) : visible.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', border: `1px dashed ${C.brd}`, borderRadius: 8 }}>
          <p style={{ ...mono, fontSize: 12, color: C.dim, margin: 0 }}>
            {rows.length === 0 ? 'No handoffs yet — waiting for Disco Coach to fire' : 'No handoffs match the current filter'}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${C.brd}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th col="company"         label="Company"      w={160} />
                <Th col="source"          label="Source"       w={90} />
                <Th col="ae_email"        label="AE"           w={120} />
                <Th col="meeting_date"    label="Meeting"      w={90} />
                <Th col="status"          label="Status"       w={90} />
                <Th col="contact_name"    label="Contact"      w={120} />
                <Th col="updated_at"      label="Received"     w={90} />
              </tr>
            </thead>
            <tbody>
              {visible.map((r, idx) => {
                const status   = r.status || 'pending';
                const products = r.raw_payload?.f?.products || r.debrief_result?.productsDiscussed?.map(p => p.product).join(', ') || '—';
                const aeName   = r.ae_email || (r.ae_sfdc ? `sfdc:${r.ae_sfdc.slice(0,8)}` : '—');
                const isActive = selected?.event_id === r.event_id;
                return (
                  <tr key={r.event_id} onClick={() => setSelected(r)}
                    style={{ background: isActive ? `${C.gold}0a` : idx % 2 === 0 ? C.card : '#0a1018',
                      cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = `${C.gold}08`; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = idx % 2 === 0 ? C.card : '#0a1018'; }}>
                    <td style={{ padding: '9px 10px', borderBottom: `1px solid ${C.brd}22` }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.txt }}>{r.company}</span>
                      {products !== '—' && <p style={{ ...mono, margin: '1px 0 0', fontSize: 10, color: C.dim }}>{products.slice(0,40)}{products.length>40?'…':''}</p>}
                    </td>
                    <td style={{ padding: '9px 10px', borderBottom: `1px solid ${C.brd}22` }}>
                      <span style={{ ...mono, fontSize: 10, color: srcColor(r.source) }}>{r.source || 'BDR'}</span>
                    </td>
                    <td style={{ padding: '9px 10px', borderBottom: `1px solid ${C.brd}22` }}>
                      <span style={{ ...mono, fontSize: 10, color: C.dim }}>{aeName.length > 20 ? aeName.slice(0,20)+'…' : aeName}</span>
                    </td>
                    <td style={{ padding: '9px 10px', borderBottom: `1px solid ${C.brd}22` }}>
                      <span style={{ ...mono, fontSize: 10, color: C.dim }}>{r.meeting_date || r.ae_meeting_time || '—'}</span>
                    </td>
                    <td style={{ padding: '9px 10px', borderBottom: `1px solid ${C.brd}22` }}>
                      <StatusBadge status={status} />
                    </td>
                    <td style={{ padding: '9px 10px', borderBottom: `1px solid ${C.brd}22` }}>
                      <span style={{ ...mono, fontSize: 11, color: C.mut }}>{r.contact_name || (r.contacts?.[0]?.name) || '—'}</span>
                    </td>
                    <td style={{ padding: '9px 10px', borderBottom: `1px solid ${C.brd}22` }}>
                      <span style={{ ...mono, fontSize: 10, color: C.dim }}>{r.updated_at?.slice(0,10) || '—'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>}
    </div>
  );
}

// ── Analytics tab ─────────────────────────────────────────────────────────────
function HandoffAnalytics({ rows, teamUsers, loading }) {
  if (loading) return <p style={{ ...mono, fontSize: 12, color: C.dim }}>Loading…</p>;
  if (!rows.length) return (
    <div style={{ padding: '40px 20px', textAlign: 'center', border: `1px dashed ${C.brd}`, borderRadius: 8 }}>
      <p style={{ ...mono, fontSize: 12, color: C.dim, margin: 0 }}>No handoffs yet</p>
    </div>
  );

  const total    = rows.length;
  const accepted = rows.filter(r => r.status === 'accepted').length;
  const pending  = rows.filter(r => (r.status || 'pending') === 'pending').length;
  const declined = rows.filter(r => r.status === 'declined').length;
  const acceptRate = total ? Math.round((accepted / total) * 100) : 0;

  // Per-AE breakdown
  const aeMap = {};
  rows.forEach(r => {
    const key = r.ae_email || r.ae_sfdc || 'Unknown AE';
    // Try to resolve a display name from teamUsers
    const tu = teamUsers.find(u => u.email === r.ae_email);
    const label = tu?.name || r.ae_email || (r.ae_sfdc ? `SFDC: ${r.ae_sfdc.slice(0,10)}` : 'Unknown AE');
    if (!aeMap[key]) aeMap[key] = { label, total: 0, accepted: 0, pending: 0, declined: 0, companies: [] };
    const st = r.status || 'pending';
    aeMap[key].total++;
    aeMap[key][st === 'pending' ? 'pending' : st]++;
    aeMap[key].companies.push(r.company);
  });
  const aeRows = Object.values(aeMap).sort((a, b) => b.total - a.total);

  // Per-source breakdown
  const srcMap = {};
  rows.forEach(r => {
    const src = r.source || 'Unknown';
    if (!srcMap[src]) srcMap[src] = { total: 0, accepted: 0 };
    srcMap[src].total++;
    if (r.status === 'accepted') srcMap[src].accepted++;
  });
  const srcRows = Object.entries(srcMap).sort((a, b) => b[1].total - a[1].total);

  // Recent activity (last 7 days)
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const recent = rows.filter(r => (r.updated_at || '') >= cutoff);

  const StatCard = ({ label, value, sub, color }) => (
    <div style={{ padding: '14px 16px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, flex: 1, minWidth: 100 }}>
      <p style={{ ...mono, margin: '0 0 4px', fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</p>
      <p style={{ margin: 0, fontSize: 24, fontWeight: 700, color: color || C.txt }}>{value}</p>
      {sub && <p style={{ ...mono, margin: '3px 0 0', fontSize: 10, color: C.dim }}>{sub}</p>}
    </div>
  );

  const Bar = ({ value, max, color }) => (
    <div style={{ flex: 1, height: 6, background: `${C.brd}`, borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${max ? Math.round((value/max)*100) : 0}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatCard label="Total Handoffs"   value={total}      sub={`${recent.length} this week`} />
        <StatCard label="Accepted"         value={accepted}   color={C.green}   sub={`${acceptRate}% rate`} />
        <StatCard label="Pending"          value={pending}    color={C.gold} />
        <StatCard label="Declined"         value={declined}   color="#cc4444" />
      </div>

      {/* Per-AE breakdown */}
      <div>
        <p style={{ ...mono, margin: '0 0 10px', fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>By AE — handed off to</p>
        <div style={{ border: `1px solid ${C.brd}`, borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#080e18' }}>
                {['AE','Received','Accepted','Pending','Declined','Rate'].map(h => (
                  <th key={h} style={{ ...mono, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em',
                    padding: '8px 12px', textAlign: h === 'AE' ? 'left' : 'center', borderBottom: `1px solid ${C.brd}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {aeRows.map((ae, i) => {
                const rate = ae.total ? Math.round((ae.accepted / ae.total) * 100) : 0;
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? C.card : '#0a1018' }}>
                    <td style={{ padding: '9px 12px', borderBottom: `1px solid ${C.brd}22` }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.txt }}>{ae.label}</div>
                      <div style={{ ...mono, fontSize: 10, color: C.dim, marginTop: 1 }}>
                        {ae.companies.slice(0, 2).join(', ')}{ae.companies.length > 2 ? ` +${ae.companies.length - 2}` : ''}
                      </div>
                    </td>
                    <td style={{ ...mono, fontSize: 13, fontWeight: 700, color: C.txt, textAlign: 'center', padding: '9px 12px', borderBottom: `1px solid ${C.brd}22` }}>{ae.total}</td>
                    <td style={{ ...mono, fontSize: 13, fontWeight: 700, color: C.green, textAlign: 'center', padding: '9px 12px', borderBottom: `1px solid ${C.brd}22` }}>{ae.accepted}</td>
                    <td style={{ ...mono, fontSize: 13, color: C.gold, textAlign: 'center', padding: '9px 12px', borderBottom: `1px solid ${C.brd}22` }}>{ae.pending}</td>
                    <td style={{ ...mono, fontSize: 13, color: '#cc4444', textAlign: 'center', padding: '9px 12px', borderBottom: `1px solid ${C.brd}22` }}>{ae.declined}</td>
                    <td style={{ padding: '9px 12px', borderBottom: `1px solid ${C.brd}22` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Bar value={ae.accepted} max={ae.total} color={C.green} />
                        <span style={{ ...mono, fontSize: 10, color: rate >= 60 ? C.green : rate >= 30 ? C.gold : '#cc4444', minWidth: 30, textAlign: 'right' }}>{rate}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-source breakdown */}
      {srcRows.length > 0 && (
        <div>
          <p style={{ ...mono, margin: '0 0 10px', fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>By Source — handed off from</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {srcRows.map(([src, s]) => (
              <div key={src} style={{ padding: '12px 16px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, minWidth: 140 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: srcColor(src) }}>{src}</span>
                </div>
                <p style={{ margin: '0 0 2px', fontSize: 22, fontWeight: 700, color: C.txt }}>{s.total}</p>
                <p style={{ ...mono, margin: 0, fontSize: 10, color: C.green }}>{s.accepted} accepted</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section helper ────────────────────────────────────────────────────────────
function Section({ label, color, children }) {
  return (
    <div>
      <p style={{ ...mono, margin: '0 0 6px', fontSize: 9, color, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>{label}</p>
      {children}
    </div>
  );
}
