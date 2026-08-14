import { useState, forwardRef, useImperativeHandle } from 'react';
import { mono } from '../../../constants/colors';
import { CARD, RADIUS, ROLE } from '../tokens';
import { DealComplianceTracker } from '../../AccountCardCompliance';
import DealStageBar from '../../AccountCardDealStage';
import GiftModal from '../../GiftModal';
import WinReasonPanel from '../../WinReasonPanel';
import AccountCardCompetition from '../../AccountCardCompetition';
import AccountCardRawEdit from '../../AccountCardRawEdit';
import { loadWinReason } from '../../../utils/winReasons';

const SH = { ...mono, fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: CARD.textSubtle };

// Section 12's business Intelligence content (compact summary text) plus
// the deal-workflow surfaces that stay visible inline rather than behind a
// drawer (Active Deal compliance, Win Reason) and the Tier-4 admin panels
// (Competition, Raw Edit) triggered from AdminOverflowMenu. Relocated
// unchanged internals — AccountCardCompliance/AccountCardDealStage/
// GiftModal/WinReasonPanel/AccountCardCompetition/AccountCardRawEdit are
// not touched, only how they're triggered.
export function IntelligenceSummary({ acc }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <p style={SH}>Business Model</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: CARD.textSecondary, lineHeight: 1.6 }}>{acc.bm ? acc.bm.slice(0, 160) + (acc.bm.length > 160 ? "…" : "") : "Not yet analyzed"}</p>
        </div>
        <div>
          <p style={SH}>Product Fit</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: CARD.textSecondary, lineHeight: 1.6 }}>{acc.pf ? acc.pf.slice(0, 160) + (acc.pf.length > 160 ? "…" : "") : "Run assay to analyze"}</p>
        </div>
      </div>
      {acc.prods?.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
          {acc.prods.map(p => <span key={p} style={{ ...mono, fontSize: 10, color: CARD.textMuted, background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: 3, padding: "2px 6px" }}>{p}</span>)}
        </div>
      )}
    </div>
  );
}

const DealWorkspace = forwardRef(function DealWorkspace({ acc, onUpdate, tasks, onUpdateTask, onRemove, adminOpen, onAdminClose }, ref) {
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [winReasonModal, setWinReasonModal] = useState(false);
  const [winReason, setWinReason] = useState(() => loadWinReason(acc.id));
  const isClosedWon = (acc.stage || "") === "Closed Won";

  useImperativeHandle(ref, () => ({ openGift: () => setGiftModalOpen(true) }));

  return (
    <>
      {(acc.dealStage || acc.stage === "Active Deal") && (
        <div style={{ marginTop: 12 }}>
          <p style={{ ...SH, color: ROLE.dealStageLabel }}>Deal Stage</p>
          <div style={{ marginTop: 6 }}>
            <DealStageBar acc={acc} onUpdate={onUpdate} />
            {acc.stage === "Active Deal" && <DealComplianceTracker accId={acc.id} accName={acc.name} acc={acc} tasks={tasks} onUpdateTask={onUpdateTask} onUpdateAcc={onUpdate} />}
          </div>
        </div>
      )}

      {isClosedWon && (
        <div style={{ marginTop: 12, padding: "10px 12px", background: CARD.surface, border: `1px solid ${winReason ? "#4ade8044" : "#f59e0b55"}`, borderRadius: RADIUS.md }}>
          {!winReason ? (
            <button onClick={() => setWinReasonModal(true)} style={{ ...mono, fontSize: 12, padding: "4px 0", background: "transparent", border: "none", color: "#f59e0b", cursor: "pointer", fontWeight: 600 }}>◆ Add win reason</button>
          ) : (
            <>
              <p style={{ ...mono, margin: 0, fontSize: 11, color: CARD.textSecondary }}>
                <span style={{ color: "#4ade80" }}>◆ Win Reason —</span> {winReason.top3?.[0] || '—'}
                {winReason.top3?.length > 1 && <span style={{ color: CARD.textMuted }}> · +{winReason.top3.length - 1} more</span>}
              </p>
              <button onClick={() => setWinReasonModal(true)} style={{ ...mono, marginTop: 6, fontSize: 10, padding: "2px 8px", background: "transparent", border: `1px solid ${CARD.border}`, color: CARD.textMuted, borderRadius: RADIUS.sm, cursor: "pointer" }}>Edit</button>
            </>
          )}
        </div>
      )}

      {giftModalOpen && onUpdate && (
        <GiftModal acc={acc} onClose={() => setGiftModalOpen(false)} onUpdate={onUpdate} userName={(() => { try { return JSON.parse(localStorage.getItem("prospector_user") || "{}").name || "AE"; } catch { return "AE"; } })()} />
      )}

      {winReasonModal && (
        <div onClick={() => setWinReasonModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.76)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 560, maxHeight: "90vh", overflowY: "auto", background: CARD.surface2, border: "1px solid #4ade8055", borderRadius: 12, padding: "22px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
              <p style={{ ...mono, margin: 0, fontSize: 11, color: "#4ade80", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, flex: 1 }}>◆ Win Reason — {acc.name}</p>
              <button onClick={() => setWinReasonModal(false)} style={{ background: "transparent", border: "none", color: CARD.textMuted, fontSize: 18, cursor: "pointer" }}>✕</button>
            </div>
            <WinReasonPanel acc={acc} initial={winReason} onSaved={data => { setWinReason({ ...data, savedAt: new Date().toISOString() }); setWinReasonModal(false); }} />
          </div>
        </div>
      )}

      {adminOpen === 'competition' && onUpdate && (
        <div onClick={e => e.stopPropagation()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.76)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClickCapture={e => { if (e.target === e.currentTarget) onAdminClose(); }}>
          <div style={{ width: 480, background: CARD.surface2, border: `1px solid ${CARD.borderStrong}`, borderRadius: 12, padding: "18px 20px" }}>
            <div style={{ display: "flex", marginBottom: 10 }}><span style={{ ...mono, fontSize: 11, color: CARD.textSecondary, flex: 1 }}>Competition — {acc.name}</span><button onClick={onAdminClose} style={{ background: "transparent", border: "none", color: CARD.textMuted, cursor: "pointer" }}>✕</button></div>
            <AccountCardCompetition acc={acc} onUpdate={patch => onUpdate({ ...acc, ...patch })} />
          </div>
        </div>
      )}

      {adminOpen === 'rawedit' && onUpdate && (
        <div onClick={e => e.stopPropagation()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.76)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClickCapture={e => { if (e.target === e.currentTarget) onAdminClose(); }}>
          <div style={{ width: 560, maxHeight: "85vh", overflowY: "auto", background: CARD.surface2, border: `1px solid ${CARD.borderStrong}`, borderRadius: 12, padding: "18px 20px" }}>
            <div style={{ display: "flex", marginBottom: 10 }}><span style={{ ...mono, fontSize: 11, color: CARD.textSecondary, flex: 1 }}>Raw Edit — {acc.name}</span><button onClick={onAdminClose} style={{ background: "transparent", border: "none", color: CARD.textMuted, cursor: "pointer" }}>✕</button></div>
            <AccountCardRawEdit acc={acc} onUpdate={patch => onUpdate({ ...acc, ...patch })} onDelete={onRemove ? () => onRemove(acc.id) : undefined} />
          </div>
        </div>
      )}
    </>
  );
});

export default DealWorkspace;
