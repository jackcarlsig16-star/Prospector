import { useState, useRef } from 'react';
import { C, mono, TIER_COLOR } from '../constants/colors';
import { productMonthlyCost, monthUsersAt } from '../utils/pricingMath';
import { CARD, kindTokens, ROLE } from './accountCard/tokens';
import AccountBadge from './accountCard/AccountBadge';
import AccountCardShell from './accountCard/AccountCardShell';
import AccountHeader from './accountCard/AccountHeader';
import AccountStateBar from './accountCard/AccountStateBar';
import AccountIntelligence from './accountCard/AccountIntelligence';
import AccountActivityPanel from './accountCard/AccountActivityPanel';
import AddNoteBox from './accountCard/AddNoteBox';
import { groupByTier } from './accountCard/actions/ActionRegistry';
import PrimaryAction from './accountCard/actions/PrimaryAction';
import ActionGroup from './accountCard/actions/ActionGroup';
import UtilityRow from './accountCard/actions/UtilityRow';
import AdminOverflowMenu from './accountCard/actions/AdminOverflowMenu';

import { QuickAskBar } from './accountCard/QuickAskBar';
import EmailModal from './EmailModal';
import CallPrepModal from './CallPrepModal';
import AccountCardComms from './AccountCardComms';
import AccountCardExtract from './AccountCardExtract';

import DebriefWorkspace from './accountCard/business/DebriefWorkspace';
import IntelWorkspace from './accountCard/business/IntelWorkspace';
import LinksAndOutbound from './accountCard/business/LinksAndOutbound';
import DealWorkspace, { IntelligenceSummary } from './accountCard/business/DealWorkspace';
import { buildBusinessStateItems, DEAL_STAGES } from './accountCard/business/BusinessStateControls';

import CreatorFitRelationship from './accountCard/influencer/CreatorFitRelationship';
import LinkedProjects from './accountCard/LinkedProjects';
import { setBdrList, URGENCY_OPTIONS } from '../utils/assignHelper';

// Unified Account Card — account-card-full-redesign-v2. Shared shell
// (Header -> State -> Actions -> Intelligence -> Activity) with business
// and influencer modules composed in. Every heavy panel below
// (CallPrepModal, DebriefWorkspace/IntelWorkspace's IntelPanel, Comms,
// Extract, DealWorkspace's DealStageBar/Compliance/WinReason/
// Competition/RawEdit, EmailModal, QuickAskBar) is reused unchanged
// internally — this file only owns which tier a trigger lives in and
// which boolean flag opens which panel.
export default function AccountCard({
  acc, business = null, expanded, onToggle, onReassay, reassaying, onUpdate,
  isFav, onToggleFav, onRemove, assignedEntry, onAssign, onUnassign, onFlagRemoval,
  onOpenPricing, onOpenRoi, onCreateTask, onUpdateTask,
  tasks = [], activeUser = {}, parentName = null, onRequestLinkParent, onUnlinkParent,
  userEmail, canEdit, onUpdated, projects = [], accountListIds = [], onAccountLinkedToProject,
  onRelationshipTypeChange,
}) {
  const isInfluencer = acc.accountKind === 'influencer';
  const kind = kindTokens(acc.accountKind);

  const [overflowOpen, setOverflowOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(null); // null | 'competition' | 'rawedit'
  const [intelFlash, setIntelFlash] = useState(null);
  const [newlyDetectedProds, setNewlyDetectedProds] = useState(new Set());
  const [outreachOpen, setOutreachOpen] = useState(false);
  const [callPrepOpen, setCallPrepOpen] = useState(false);
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [intelOpen, setIntelOpen] = useState(false);
  const [commsOpen, setCommsOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [fullIntelOpen, setFullIntelOpen] = useState(false);

  const debriefRef = useRef(null);

  // Influencer detail — same pattern the old InfluencerCard.js used: update
  // the local view immediately, then trigger a silent reload upstream.
  const [detail, setDetail] = useState(acc.influencerDetail || null);
  const applyDetailUpdate = (updated) => { setDetail(updated); onUpdated?.(); };

  const callCount = (acc.calls || []).length;
  const hasAnalysis = isInfluencer ? detail?.assessment_status === 'ready' : !!acc.analyzed;

  // ── Tier 1 — primary action ──────────────────────────────────────────
  const primaryAction = hasAnalysis
    ? { label: "Generate Outreach", icon: "✦", variant: 'generate', onClick: () => setOutreachOpen(true) }
    : isInfluencer
      ? { label: "Assess this creator first", icon: "◆", disabled: true }
      : onReassay
        ? { label: reassaying ? "Analyzing…" : "Run Assay first", icon: "◆", onClick: () => onReassay(acc), loading: reassaying, disabled: reassaying }
        : { label: "Run Assay first", icon: "◆", disabled: true };

  // ── Tier 2/3/4 — business (Ask lives in QuickAskBar above, not this row) ─
  const businessActions = !isInfluencer ? [
    { tier: 2, key: 'callprep', icon: '☎', label: 'Call Prep', onClick: () => setCallPrepOpen(true), active: callPrepOpen },
    // account-card-cleanup-v1 Stage 2 - closing must go through DebriefWorkspace's
    // real closeDebrief() (also resets debriefMode/quickUpdateText/etc, same as its
    // own "x"), not a raw boolean flip - Intel has no equivalent extra state so a
    // plain toggle is correct there, Debrief isn't a copy-paste of that pattern.
    { tier: 2, key: 'debrief', icon: '📋', label: 'Debrief', badge: callCount || null, onClick: () => { if (debriefOpen) debriefRef.current?.closeDebrief?.(); else setDebriefOpen(true); }, active: debriefOpen },
    { tier: 2, key: 'intel', icon: '◆', label: 'Intel', onClick: () => setIntelOpen(o => !o), active: intelOpen },
    { tier: 2, key: 'comms', icon: '💬', label: 'Comms', onClick: () => setCommsOpen(o => !o), active: commsOpen },
    { tier: 3, key: 'extract', icon: '⬇', label: 'Extract', onClick: () => setExtractOpen(o => !o), active: extractOpen },
    // account-card-cleanup-v1 Stage 4 - Timeline button removed from the card
    // (not deleted - DealTimeline.js is still live in LedgerPage.js). This is
    // a deliberate hold: Jack likes it as a generative feature and wants to
    // revisit it later, not a rejection of the feature.
    onOpenPricing ? { tier: 3, key: 'pricing', icon: '$', label: 'Pricing', onClick: () => onOpenPricing(acc.id) } : null,
    onOpenRoi ? { tier: 3, key: 'roi', icon: '📈', label: 'ROI', onClick: () => onOpenRoi(acc.id) } : null,
    // account-card-cleanup-v1 Stage 5 - Re-assay moved to AccountHeader's
    // icon row (near star/overflow), no longer a Tier-3 action.
  ].filter(Boolean) : [];

  const tiers = groupByTier(businessActions);

  // ── Tier 4 — admin (shared shell, kind-aware content) ────────────────
  const adminActions = isInfluencer ? [
    onRemove ? { key: 'remove', icon: '✕', label: 'Remove', danger: true, onClick: () => { if (window.confirm(`Remove ${acc.name}?`)) onRemove(acc.id); } } : null,
  ].filter(Boolean) : [
    onFlagRemoval ? { key: 'flag', icon: '🚩', label: 'Flag', onClick: () => onFlagRemoval(acc, "") } : null,
    { key: 'competition', icon: '⚔', label: 'Competition', onClick: () => setAdminOpen('competition') },
    { key: 'rawedit', icon: '⚙', label: 'Raw Edit', onClick: () => setAdminOpen('rawedit') },
    (onRequestLinkParent && !acc.parentId) ? { key: 'linkparent', icon: '⊕', label: 'Link parent', onClick: () => onRequestLinkParent() } : null,
    (onUnlinkParent && acc.parentId) ? { key: 'unlinkparent', icon: '⊖', label: `Unlink from ${parentName || 'parent'}`, onClick: () => onUnlinkParent() } : null,
    onRemove ? { key: 'remove', icon: '✕', label: 'Remove', danger: true, onClick: () => { if (window.confirm(`Remove ${acc.name}?`)) onRemove(acc.id); } } : null,
  ].filter(Boolean);

  // ── Header signals — only what genuinely needs attention right now ───
  const stale = acc.lastTouchedAt ? (Date.now() - new Date(acc.lastTouchedAt)) / 86400000 > 21 : false;
  const signals = [];
  if (!isInfluencer && stale) signals.push(<AccountBadge key="stale" tone="#F06060">⚠ at risk</AccountBadge>);
  if (!isInfluencer && assignedEntry) signals.push(<AccountBadge key="outbound" tone="#00b4d8">◆ OUTBOUND — {assignedEntry.assignedTo}</AccountBadge>);
  // account-business-details-v1 — new table first, legacy field as fallback
  // for accounts not yet re-assayed since this shipped (dual-write).
  const displayTier = acc.businessDetail?.tier || acc.tier;
  if (!isInfluencer && displayTier) signals.push(<AccountBadge key="tier" tone={TIER_COLOR[displayTier] || kind.accent}>{displayTier}</AccountBadge>);
  // account-card-score-to-confidence-swap-v1 — raw score duplicated tier
  // (1=Gold..4=Slag, same model output shown twice); confidence is the
  // real independently-varying signal, swapped in at the same position.
  const displayConfidence = acc.businessDetail?.fit_signals?.confidence;
  if (!isInfluencer && displayConfidence) signals.push(<AccountBadge key="confidence" tone={kind.accent}>{`Confidence: ${displayConfidence}`}</AccountBadge>);
  if (isInfluencer && detail?.priority) signals.push(<AccountBadge key="priority" tone={detail.priority === 'high' ? '#F06060' : detail.priority === 'medium' ? '#f5c542' : undefined}>{detail.priority} priority</AccountBadge>);
  if (isInfluencer) signals.push(<AccountBadge key="stage" tone={kind.accent}>{(detail?.relationship_stage || 'not_contacted').replace(/_/g, ' ')}</AccountBadge>);

  const meta = isInfluencer
    ? [detail?.follower_count != null ? `${detail.follower_count.toLocaleString()} followers` : null, detail?.niche_assessment?.category].filter(Boolean).join(' · ') || '@' + (detail?.instagram_handle || acc.name || '').replace(/^@/, '')
    : [acc.web, [acc.city, acc.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || '—';

  const name = isInfluencer ? `@${(detail?.instagram_handle || acc.name || '').replace(/^@/, '')}` : acc.name;

  const stateItems = isInfluencer ? [] : buildBusinessStateItems({
    acc, onUpdate, tasks, onCreateTask,
    // account-taxonomy-and-creation-upgrade-v1 Stage 4 - Closed Won auto-
    // converts relationship_type to Client (re-selecting Closed Won re-fires
    // this, consistent with existing behavior, not a new bug). The gift-modal
    // side effect that used to also fire here was removed - GiftModal.js is
    // archived, see below.
    onEnterClosedWon: () => { onRelationshipTypeChange?.(acc.id, 'Client'); },
    // account-taxonomy-gaps-fix-v1 Stage 1 - the manual control itself.
    onRelationshipTypeChange,
  });

  return (
    <AccountCardShell accountKind={acc.accountKind} expanded={expanded} id={`acct-${acc.id}`}>
      {intelFlash && <div style={{ position: "absolute", top: 8, right: 40, zIndex: 10, pointerEvents: "none", ...mono, fontSize: 10, color: intelFlash.startsWith('⚠') ? "#f59e0b" : "#4ade80" }}>{intelFlash === true ? '✦ Intel updated' : intelFlash}</div>}

      <AccountHeader
        accountKind={acc.accountKind}
        name={name}
        meta={meta}
        signals={signals}
        isFav={isFav}
        onToggleFav={() => onToggleFav && onToggleFav(acc.id)}
        expanded={expanded}
        onToggle={onToggle}
        onOpenOverflow={() => setOverflowOpen(o => !o)}
        onReassay={!isInfluencer && onReassay ? () => onReassay(acc) : undefined}
        reassaying={reassaying}
      />

      <AdminOverflowMenu open={overflowOpen} onClose={() => setOverflowOpen(false)} actions={adminActions} />

      {!isInfluencer && onUpdate && <AccountStateBar items={stateItems} />}

      {expanded && (
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 12 }}>

          <PrimaryAction accountKind={acc.accountKind} action={primaryAction} />

          <QuickAskBar acc={acc} />

          {isInfluencer ? (
            <div>
              <button onClick={() => setOutreachOpen(true)} style={{ ...mono, fontSize: 11, height: 28, padding: '0 14px', background: `${ROLE.generateAccent}16`, border: `1px solid ${ROLE.generateAccent}`, color: ROLE.generateAccent, borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>✦ Generate Outreach</button>
            </div>
          ) : (
            <>
              <ActionGroup actions={tiers[2]} />
              <UtilityRow actions={tiers[3]} />
              <LinksAndOutbound acc={acc} onUpdate={onUpdate} tasks={tasks} activeUser={activeUser} assignedEntry={assignedEntry} onAssign={onAssign} onUnassign={onUnassign} />
            </>
          )}

          <AccountIntelligence action={isInfluencer ? null : (
            <button onClick={() => setIntelOpen(true)} style={{ ...mono, fontSize: 10, color: CARD.textMuted, background: "transparent", border: "none", cursor: "pointer" }}>View Intelligence →</button>
          )}>
            {isInfluencer ? (
              <CreatorFitRelationship acc={acc} business={business} detail={detail} userEmail={userEmail} canEdit={canEdit} onAssessed={applyDetailUpdate} onUpdated={applyDetailUpdate} />
            ) : (
              <IntelligenceSummary acc={acc} />
            )}
          </AccountIntelligence>

          {business && <LinkedProjects accountId={acc.id} accountListIds={accountListIds} projects={projects} onLinked={listId => onAccountLinkedToProject?.(acc.id, listId)} />}

          <AccountActivityPanel acc={acc} />
          {!isInfluencer && onUpdate && <AddNoteBox acc={acc} userEmail={userEmail} onUpdate={onUpdate} />}

          {/* assay-safety-and-intel-visibility-v1 — bare raw dump of
              account_business_details, unstyled on purpose. Exists so any
              future Assay schema expansion is immediately visible here
              without a separate UI pass. */}
          {!isInfluencer && (
            <div style={{ marginTop: 12 }}>
              <button onClick={() => setFullIntelOpen(o => !o)} style={{ ...mono, fontSize: 10, color: "#888", background: "transparent", border: "1px solid #444", borderRadius: 3, padding: "3px 8px", cursor: "pointer" }}>
                {fullIntelOpen ? "▲ Hide Full Intel (raw)" : "▼ Full Intel (raw)"}
              </button>
              {fullIntelOpen && (
                <pre style={{ marginTop: 6, fontSize: 10, color: "#ccc", background: "#111", padding: 10, borderRadius: 4, maxHeight: 400, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {JSON.stringify(acc.businessDetail || null, null, 2)}
                </pre>
              )}
            </div>
          )}

        </div>
      )}

      {outreachOpen && (
        <EmailModal
          account={acc}
          business={business}
          persona={isInfluencer ? null : (acc.personas || [])[0] || null}
          accountKind={acc.accountKind}
          autoStart={false}
          projects={projects}
          onClose={() => setOutreachOpen(false)}
        />
      )}

      {!isInfluencer && callPrepOpen && (
        <CallPrepModal acc={acc} tasks={tasks} onUpdate={onUpdate} onClose={() => setCallPrepOpen(false)} />
      )}

      {!isInfluencer && (
        <DebriefWorkspace
          ref={debriefRef}
          acc={acc} business={business} onUpdate={onUpdate} tasks={tasks} activeUser={activeUser} onCreateTask={onCreateTask}
          setIntelFlash={setIntelFlash} onNewlyDetectedProds={setNewlyDetectedProds}
          open={debriefOpen} onClose={() => setDebriefOpen(false)}
        />
      )}

      {!isInfluencer && (
        <IntelWorkspace
          acc={acc} business={business} projects={projects} onUpdate={onUpdate} tasks={tasks} activeUser={activeUser}
          open={intelOpen} onClose={() => setIntelOpen(false)}
          newlyDetectedProds={newlyDetectedProds}
          debriefHandle={debriefRef.current}
        />
      )}

      {!isInfluencer && commsOpen && (
        <div style={{ margin: "0 14px 12px", background: "#f59e0b06", border: "1px solid #f59e0b22", borderRadius: 7, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ ...mono, fontSize: 11, fontWeight: 500, color: "#f59e0b" }}>✉ Comms — {acc.name}</span>
            <button onClick={() => setCommsOpen(false)} style={{ marginLeft: "auto", background: "transparent", border: "none", color: CARD.textMuted, fontSize: 14, cursor: "pointer" }}>✕</button>
          </div>
          <AccountCardComms acc={acc} tasks={tasks} activeUser={activeUser} onUpdate={onUpdate} business={business} projects={projects} />
        </div>
      )}

      {!isInfluencer && extractOpen && (
        <AccountCardExtract acc={acc} tasks={tasks} activeUser={activeUser} onClose={() => setExtractOpen(false)} />
      )}

      {!isInfluencer && (
        <DealWorkspace
          acc={acc} onUpdate={onUpdate} tasks={tasks} onUpdateTask={onUpdateTask} onRemove={onRemove}
          adminOpen={adminOpen} onAdminClose={() => setAdminOpen(null)}
          onRelationshipTypeChange={onRelationshipTypeChange}
        />
      )}
    </AccountCardShell>
  );
}

// ── Legacy re-exports ──────────────────────────────────────────────────────
// Pricing/Uploads/Intelligence/Analytics/Home pages import these directly
// from this file; kept stable across the redesign so nothing else needs to
// change import paths. Not part of the account-card system itself.
export const PRODUCT_IMPORT_SOURCES = [
  { url: "https://docs.example.com/products/core-verify/", name: "Core Verify", id: "live_core_verify" },
  { url: "https://docs.example.com/products/core-verify-plus/", name: "Core Verify Plus", id: "live_core_verify_plus" },
  { url: "https://docs.example.com/products/balance-insights/", name: "Balance Insights", id: "live_balance_insights" },
];

export const calcPricingAnnual = (f) => {
  if (!f?.products || !f?.monthlyUsers) return null;
  try {
    const prods = f.products.filter(p => p.included);
    let total = 0;
    const pfAmt = (() => {
      const TIERS = { base: 2000, plus: 5000, premium: 15000 };
      const t = TIERS[f.pfTier] || 0;
      if (!f.pfDiscount?.enabled) return t;
      return f.pfDiscount.type === "pct" ? t * (1 - f.pfDiscount.amount / 100) : Math.max(0, t - f.pfDiscount.amount);
    })();
    const sessionCtx = { avgAccounts: f.avgAccounts || 2.5, onDemand: f.onDemand || 0, tierMult: 1 };
    for (let i = 0; i < 12; i++) {
      const monthCtx = monthUsersAt(f.monthlyUsers, i);
      let apiSpend = 0;
      prods.forEach(p => { apiSpend += productMonthlyCost(p, monthCtx, sessionCtx); });
      const floorThisMo = f.commitRamp ? (f.commitRampSched?.[i] || 0) : (f.commitFee || 0);
      total += floorThisMo > 0 ? Math.max(apiSpend, floorThisMo) : apiSpend;
      total += f.pfRamp ? (f.pfRampSched?.[i] || 0) : pfAmt;
      if (f.isPartner) total += (f.partnerFee || 0);
    }
    return Math.round(total);
  } catch { return null; }
};

export function Badge({ label, color, bg, border, size = 11 }) {
  return <span style={{ display: "inline-flex", alignItems: "center", background: bg, border: `1px solid ${border}`, borderRadius: 4, padding: "2px 7px", fontSize: size, fontWeight: 500, color, whiteSpace: "nowrap" }}>{label}</span>;
}

export function Dot({ on }) {
  return <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: on ? C.green : C.red, flexShrink: 0 }} />;
}

export { DEAL_STAGES, setBdrList, URGENCY_OPTIONS };
