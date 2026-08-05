import { C, mono } from '../../constants/colors';
import { MEDPICC_FIELDS } from '../../utils/dealIntel';
import { ComplianceMiniBar } from '../AccountCardCompliance';

const PAD = { padding: '11px 13px' };
const LBL = { ...mono, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8, color: '#00b4d899' };
const ROW_LBL = { ...mono, fontSize: 11, color: C.dim, width: 80, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.06em' };
const ROW_VAL = { ...mono, fontSize: 13, fontWeight: 500 };

const touchColor = (s) => {
  if (!s) return C.dim;
  const d = Math.max(0, Math.floor((Date.now() - new Date(s.length === 10 ? s + 'T12:00:00' : s).getTime()) / 86400000));
  return d < 7 ? '#4ade80' : d < 14 ? '#f59e0b' : '#f87171';
};

const fmtFull = s => {
  if (!s) return '—';
  const d = new Date(s.length === 10 ? s + 'T12:00:00' : s);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
};

const timeAgo = (iso) => {
  if (!iso) return null;
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return d < 7 ? `${d}d ago` : d < 30 ? `${Math.floor(d / 7)}w ago` : `${Math.floor(d / 30)}mo ago`;
};

export default function DealStatusModule({ acc, tasks, compliance }) {
  const medFilled = MEDPICC_FIELDS.filter(f => (acc.medpicc?.[f.key] || '').length >= 25).length;
  const openTasks = (tasks || []).filter(t => t.status !== 'Done' && t.status !== 'Completed');
  const lastTouch = (() => {
    const calls = acc.calls;
    const callDate = calls?.length ? calls[calls.length - 1]?.date : null;
    return callDate || acc.last || null;
  })();
  const tcol = touchColor(lastTouch);

  return (
    <div style={PAD}>
      <span style={LBL}>Deal Status</span>
      {/* MEDPICC bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, minHeight: 28 }}>
        <span style={ROW_LBL}>MEDPICC</span>
        <div style={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          {Array.from({ length: MEDPICC_FIELDS.length }, (_, i) => (
            <div key={i} style={{ width: 9, height: 5, borderRadius: 1, background: i < medFilled ? '#00b4d8' : '#1a1a1a' }} />
          ))}
        </div>
        <span style={{ ...ROW_VAL, color: '#00b4d8', fontSize: 13 }}>{medFilled}/{MEDPICC_FIELDS.length}</span>
      </div>
      {/* Compliance */}
      {compliance && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, minHeight: 28 }}>
          <span style={ROW_LBL}>COMPLIANCE</span>
          <ComplianceMiniBar accId={acc.id} />
        </div>
      )}
      {/* Open tasks */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, minHeight: 28 }}>
        <span style={ROW_LBL}>TASKS</span>
        {openTasks.length === 0
          ? <span style={{ ...mono, fontSize: 13, color: '#4ade80' }}>No open tasks ✦</span>
          : <>
            <span style={{ ...ROW_VAL, color: '#00b4d8' }}>{openTasks.length} open</span>
            {openTasks[0]?.title && (
              <span style={{ ...mono, fontSize: 11, color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                {' → '}{openTasks[0].title}
              </span>
            )}
          </>
        }
      </div>
      {/* Last touch */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 28 }}>
        <span style={ROW_LBL}>LAST TOUCH</span>
        <span style={{ ...ROW_VAL, color: tcol, fontSize: 12 }}>
          {lastTouch ? `${fmtFull(lastTouch)} (${timeAgo(lastTouch)})` : '—'}
        </span>
      </div>
    </div>
  );
}
