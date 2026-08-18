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
// account-business-details-v1 — reads acc.businessDetail (the new
// account_business_details row) first, falls back to the legacy bm/pf/prods
// flat fields for any account not yet re-assayed since this shipped (dual-
// write means legacy fields stay correct too, just not the source of truth
// going forward).
const PILL_STYLE = { ...mono, fontSize: 10, color: CARD.textMuted, background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: 3, padding: "2px 6px" };

// surface-existing-intel-v1 — internal-only helper for Signal Breakdown's
// four sub-arrays, which repeat the same labeled-pill-row shape. Not a
// shared/exported Pill component (explicitly out of scope) - scoped to this
// file, just avoiding four near-identical blocks inline.
function SignalSubGroup({ label, items }) {
  if (!items?.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <p style={{ ...mono, fontSize: 9, color: CARD.textMuted }}>{label}</p>
      <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
        {items.map((s, i) => <span key={i} style={PILL_STYLE}>{s}</span>)}
      </div>
    </div>
  );
}

export function IntelligenceSummary({ acc }) {
  const detail = acc.businessDetail;
  const businessModel = detail?.business_model || acc.bm;
  const fitRationale = detail?.fit_rationale || acc.pf;
  const products = detail?.fit_signals?.products?.length ? detail.fit_signals.products : acc.prods;
  const keySignals = detail?.fit_signals?.key_signals || [];
  const tractionSignals = detail?.fit_signals?.traction_signals || [];
  const breakdown = detail?.fit_signals?.signal_breakdown;
  const disqualifier = detail?.disqualifier;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <p style={SH}>Business Model</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: CARD.textSecondary, lineHeight: 1.6, maxHeight: 200, overflowY: "auto" }}>{businessModel || "Not yet analyzed"}</p>
        </div>
        <div>
          <p style={SH}>Product Fit</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: CARD.textSecondary, lineHeight: 1.6, maxHeight: 200, overflowY: "auto" }}>{fitRationale || "Run assay to analyze"}</p>
        </div>
      </div>
      {products?.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
          {products.map(p => <span key={p} style={PILL_STYLE}>{p}</span>)}
        </div>
      )}
      {disqualifier && (
        <div style={{ marginTop: 12 }}>
          <p style={SH}>Disqualifier</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: CARD.textSecondary, lineHeight: 1.6 }}>{disqualifier}</p>
        </div>
      )}
      {keySignals.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p style={SH}>Key Signals</p>
          <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
            {keySignals.map((s, i) => <span key={i} style={PILL_STYLE}>{s}</span>)}
          </div>
        </div>
      )}
      {tractionSignals.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p style={SH}>Traction Signals</p>
          <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
            {tractionSignals.map((s, i) => <span key={i} style={PILL_STYLE}>{s}</span>)}
          </div>
        </div>
      )}
      {breakdown && (
        <div style={{ marginTop: 12 }}>
          <p style={SH}>Signal Breakdown</p>
          {(breakdown.topSignal || breakdown.signalScore != null) && (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: CARD.textSecondary }}>
              {breakdown.topSignal ? `Top Signal: ${breakdown.topSignal}` : ""}
              {breakdown.topSignal && breakdown.signalScore != null ? " · " : ""}
              {breakdown.signalScore != null ? `Score: ${breakdown.signalScore}` : ""}
            </p>
          )}
          <SignalSubGroup label="Payment Signals" items={breakdown.paymentSignals} />
          <SignalSubGroup label="Onboarding Signals" items={breakdown.onboardingSignals} />
          <SignalSubGroup label="Scale Signals" items={breakdown.scaleSignals} />
          <SignalSubGroup label="Platform Signals" items={breakdown.platformSignals} />
        </div>
      )}
    </div>
  );
}

const DealWorkspace = forwardRef(function DealWorkspace({ acc, onUpdate, tasks, onUpdateTask, onRemove, adminOpen, onAdminClose, onRelationshipTypeChange }, ref) {
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
            <AccountCardRawEdit acc={acc} onUpdate={patch => onUpdate({ ...acc, ...patch })} onDelete={onRemove ? () => onRemove(acc.id) : undefined} onRelationshipTypeChange={onRelationshipTypeChange} />
          </div>
        </div>
      )}
    </>
  );
});

export default DealWorkspace;
