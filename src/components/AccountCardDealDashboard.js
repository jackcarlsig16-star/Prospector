import { useState } from 'react';
import { T } from '../constants/tokens';
import { MEDPICC_FIELDS } from '../utils/dealIntel';
import IntelligenceRadar from './IntelligenceRadar';
import DealStatusModule from './intel/DealStatusModule';

const QDIV = `0.5px solid ${T.border.dim}`;
const QBRD = `0.5px solid ${T.border.dim}`;
const SECTION_PAD = '11px 13px';

const SectionLabel = ({ children, indicator, isFirst }) => (
  <div style={{ fontSize: 11, letterSpacing: '0.06em', color: T.text.dim, textTransform: 'uppercase', marginBottom: 8, marginTop: isFirst ? 0 : 16, display: 'flex', alignItems: 'center', gap: 7 }}>
    <span>{children}</span>
    {indicator}
  </div>
);

const truncate = (s, n) => !s ? '' : s.length > n ? s.slice(0, n) + '…' : s;

const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

const ITEM_ROW = (isLast) => ({
  padding: '6px 0',
  borderBottom: isLast ? 'none' : `0.5px solid ${T.border.subtle}`,
  fontSize: 13,
  ...ellipsis,
});

function MoreLink({ count, open, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{ display: 'block', marginTop: 8, fontSize: 12, color: T.amber, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
    >
      {open ? '− Show less' : `+${count} more`}
    </button>
  );
}

function PainList({ acc, isFirst }) {
  const [open, setOpen] = useState(false);
  const seen = new Set();
  const all = [];
  if (acc.medpicc?.identify_pain) {
    all.push(acc.medpicc.identify_pain);
    seen.add(acc.medpicc.identify_pain);
  }
  (acc.calls || []).forEach(c => (c.painPoints || []).forEach(p => {
    const t = typeof p === 'string' ? p : p?.topic || '';
    if (t && !seen.has(t)) { seen.add(t); all.push(t); }
  }));

  if (all.length === 0) {
    return (
      <div>
        <SectionLabel isFirst={isFirst}>Pain → Solution</SectionLabel>
        <span style={{ fontSize: 13, color: T.text.dim }}>No pain points logged</span>
      </div>
    );
  }

  const visible = open ? all : all.slice(0, 2);
  const extra = all.length - 2;
  return (
    <div>
      <SectionLabel isFirst={isFirst}>Pain → Solution</SectionLabel>
      <div>
        {visible.map((t, i) => (
          <div key={i} style={{ ...ITEM_ROW(i === visible.length - 1), color: '#a78bfa' }}>
            {truncate(t, 60)}
          </div>
        ))}
      </div>
      {extra > 0 && <MoreLink count={extra} open={open} onClick={() => setOpen(o => !o)} />}
    </div>
  );
}

function PathToCloseList({ acc, isFirst }) {
  const [open, setOpen] = useState(false);

  const ledeFull = (acc.pathToClose || '').trim();
  let lede = '';
  if (ledeFull) {
    const m = ledeFull.match(/^[^.!?]+[.!?]/);
    lede = m ? m[0].trim() : ledeFull;
  }

  const seen = new Set();
  const all = [];
  (acc.calls || []).forEach(c => {
    if (c.timeline) {
      c.timeline.split('\n').map(m => m.trim()).filter(Boolean).forEach(m => {
        const k = m.toLowerCase();
        if (!seen.has(k)) { seen.add(k); all.push(m); }
      });
    }
    (c.nextSteps || []).forEach(ns => {
      const t = typeof ns === 'string' ? ns : ns?.text || '';
      const k = t.toLowerCase().trim();
      if (t && !seen.has(k)) { seen.add(k); all.push(t); }
    });
  });

  const empty = all.length === 0 && !lede;
  if (empty) {
    return (
      <div>
        <SectionLabel isFirst={isFirst}>Path to Close</SectionLabel>
        <span style={{ fontSize: 13, color: T.text.dim }}>No path defined</span>
      </div>
    );
  }

  const visible = open ? all : all.slice(0, 2);
  const extra = all.length - 2;
  return (
    <div>
      <SectionLabel isFirst={isFirst}>Path to Close</SectionLabel>
      {lede && (
        <div style={{ fontSize: 13, color: T.amber, marginBottom: 8, lineHeight: 1.5 }}>{lede}</div>
      )}
      {all.length > 0 && (
        <div>
          {visible.map((t, i) => (
            <div key={i} style={{ ...ITEM_ROW(i === visible.length - 1), color: T.text.muted }}>
              {t}
            </div>
          ))}
        </div>
      )}
      {extra > 0 && <MoreLink count={extra} open={open} onClick={() => setOpen(o => !o)} />}
    </div>
  );
}

function BlockersSection({ acc, compliance }) {
  const [open, setOpen] = useState(false);
  const bText = b => typeof b === 'string' ? b : b?.text || '';
  const callB = [...new Set((acc.calls || []).flatMap(c => (c.blockers || []).map(bText)))].filter(Boolean);
  const compB = acc.stage === 'Active Deal' && compliance?.steps
    ? compliance.steps
        .filter(s => s.status === 'Blocked')
        .map(s => `${s.id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}: blocked`)
    : [];
  const all = [...callB, ...compB];

  if (all.length === 0) return null;

  const visible = open ? all : all.slice(0, 2);
  const extra = all.length - 2;
  const redDot = (
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626', boxShadow: '0 0 4px #dc2626aa', display: 'inline-block' }} />
  );

  return (
    <div style={{ padding: SECTION_PAD, borderTop: QDIV }}>
      <SectionLabel indicator={redDot} isFirst>Blockers</SectionLabel>
      <div>
        {visible.map((b, i) => (
          <div key={i} style={{ ...ITEM_ROW(i === visible.length - 1), color: '#fca5a5' }}>
            {truncate(b, 80)}
          </div>
        ))}
      </div>
      {extra > 0 && <MoreLink count={extra} open={open} onClick={() => setOpen(o => !o)} />}
    </div>
  );
}

function OpenQuestionsSection({ acc }) {
  const [open, setOpen] = useState(false);
  const med = acc.medpicc || {};
  const OQ_MED_KEYS = ['metrics', 'economic_buyer', 'decision_criteria', 'champion', 'competition'];
  const missingMed = OQ_MED_KEYS.filter(k => !med[k]).map(k => {
    const f = MEDPICC_FIELDS.find(x => x.key === k);
    return `${f?.label || k} not yet discovered`;
  });
  const callOQ = [...new Set((acc.calls || []).flatMap(c => c.openQuestions || []))];
  const all = [...new Set([...callOQ, ...missingMed])];

  if (all.length === 0) return null;

  const visible = open ? all : all.slice(0, 2);
  const extra = all.length - 2;

  return (
    <div style={{ padding: SECTION_PAD, borderTop: QDIV }}>
      <SectionLabel isFirst>Open Questions</SectionLabel>
      <div>
        {visible.map((q, i) => (
          <div key={i} style={{ ...ITEM_ROW(i === visible.length - 1), color: '#fbbf24' }}>
            {truncate(q, 80)}
          </div>
        ))}
      </div>
      {extra > 0 && <MoreLink count={extra} open={open} onClick={() => setOpen(o => !o)} />}
    </div>
  );
}

export default function AccountCardDealDashboard({ acc, tasks = [], onUpdate, activeUser }) {
  const compliance = (() => {
    try { return JSON.parse(localStorage.getItem('prospector_compliance') || '{}')[acc.id] || null; }
    catch { return null; }
  })();
  const accTasks = tasks.filter(t => t.accId === acc.id || t.accountId === acc.id);

  return (
    <div style={{ background: '#080808', border: QBRD, borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
      {/* Top row: Radar + Deal Status */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'flex-start' }}>
        <div style={{ borderRight: QDIV, padding: SECTION_PAD }}>
          <IntelligenceRadar acc={acc} size={220} />
        </div>
        <div>
          <DealStatusModule acc={acc} tasks={accTasks} compliance={compliance} />
        </div>
      </div>
      {/* Middle row: Pain → Solution + Path to Close */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'flex-start', borderTop: QDIV, padding: SECTION_PAD }}>
        <PainList acc={acc} isFirst />
        <PathToCloseList acc={acc} isFirst />
      </div>
      <BlockersSection acc={acc} compliance={compliance} />
      <OpenQuestionsSection acc={acc} />
    </div>
  );
}
