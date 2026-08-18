import { mono } from '../../../constants/colors';
import { CARD, RADIUS, ROLE, GLOW_FOCUS_CLASS, GLOW_FOCUS_STYLE } from '../tokens';
import { STANDARD_STEPS, getCompliance, saveCompliance } from '../../../utils/storage';
import { trackDailyStat } from '../../../utils/stats';

export const DEAL_STAGES = [
  { id: "Prospecting", c: CARD.textMuted },
  { id: "Engaged", c: "#56A8F8" },
  { id: "Needs Follow-up", c: "#F5A050" },
  { id: "Active Deal", c: "#4ade80" },
  { id: "Qualified", c: "#42E890" },
  { id: "Closed Won", c: "#4ade80" },
  { id: "Closed Lost", c: "#F06060" },
];

// account-taxonomy-gaps-fix-v1 Stage 2 - "Partner Referral" (was "Partner")
// so this channel/source value no longer shares a bare word with
// relationship_type's "Partner" value - two genuinely different concepts
// (how we found this account vs. what it is to us) that read as connected
// sitting in adjacent dropdowns otherwise. SFDC sync (AccountsPage.js:508)
// writes the literal string, not a lookup key, so this rename takes effect
// immediately for any account synced after this ships - no separate
// mapping to update.
export const ACCOUNT_SOURCES = ["Cold", "Inbound", "Referral", "Partner Referral", "6sense", "SFDC"];
const SOURCE_C = { Cold: ROLE.neutralGray, Inbound: "#56A8F8", Referral: "#42E890", "Partner Referral": "#A878F0", "6sense": "#0099DD", SFDC: "#F5A050" };
const SOURCE_IC = { Cold: "○", Inbound: "↘", Referral: "🤝", "Partner Referral": "⬡", "6sense": "◎", SFDC: "☁" };

// account-taxonomy-gaps-fix-v1 Stage 1 - the manual relationship_type
// control the parent SPEC's own Stage 6 named as future work but never
// built. Same dropdown pattern as Stage/Source right next to it.
export const RELATIONSHIP_TYPES = ["Prospect/Lead", "Client", "Partner", "Competitor"];
const REL_C = { "Prospect/Lead": CARD.textMuted, Client: "#42E890", Partner: "#A878F0", Competitor: "#F06060" };

const selectStyle = (color, borderColor) => ({ ...mono, fontSize: 11, height: 24, padding: "0 6px", background: CARD.surface, border: `1px solid ${borderColor || CARD.border}`, borderRadius: RADIUS.sm, color, outline: "none", cursor: "pointer" });
const captionStyle = { ...mono, fontSize: 8, color: CARD.textSubtle, textTransform: "uppercase", letterSpacing: "0.07em" };
// account-taxonomy-gaps-fix-v1 Stage 2 - small caption above each control so
// TYPE (relationship_type) and SOURCE (lead channel) read as clearly
// different things rather than two unlabeled dropdowns that happen to sit
// next to each other. Labeling/clarity fix only, not a layout change.
const Captioned = ({ label, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
    <span style={captionStyle}>{label}</span>
    {children}
  </div>
);

// Feeds AccountStateBar's `items` for business accounts — Stage select,
// Gaming track toggle, Source select. Relocated verbatim (side effects on
// stage change: compliance seeding, task creation, gift-modal trigger) from
// the old AccountCard.js.
// account-taxonomy-and-creation-upgrade-v1 Stage 4 - Stage only
// meaningfully applies to Prospect/Lead accounts going forward. Client/
// Partner/Competitor accounts don't get the Stage control at all here
// (rather than showing it disabled/greyed - there's no "stage" concept for
// an existing client, so a visible-but-inert control would just invite
// confusion about whether it does something).
const isProspectOrLead = acc => (acc.relationshipType || 'Prospect/Lead') === 'Prospect/Lead';

export function buildBusinessStateItems({ acc, onUpdate, tasks, onCreateTask, onEnterClosedWon, onRelationshipTypeChange }) {
  if (!onUpdate) return [];
  const relType = acc.relationshipType || 'Prospect/Lead';
  const items = [
    // account-taxonomy-gaps-fix-v1 Stage 1 - the manual control. Calls
    // onRelationshipTypeChange (the real handleRelationshipTypeChange /
    // updateAccountRelationshipType path, same one the automatic Closed Won
    // conversion already uses) directly - not onUpdate, since this field
    // lives in a real accounts column, not the data blob (see db.js).
    {
      key: 'relType',
      control: (
        <Captioned label="Type">
          <select className={GLOW_FOCUS_CLASS} value={relType} onChange={e => onRelationshipTypeChange?.(acc.id, e.target.value)}
            style={selectStyle(REL_C[relType] || ROLE.neutralGray, `${REL_C[relType] || ROLE.neutralGray}66`)}>
            {RELATIONSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Captioned>
      ),
    },
    ...(isProspectOrLead(acc) ? [{
      key: 'stage',
      control: (
        <>
          <style>{GLOW_FOCUS_STYLE}</style>
          <Captioned label="Stage">
          <select className={GLOW_FOCUS_CLASS} value={acc.stage || "Prospecting"} onChange={e => {
          const newStage = e.target.value;
          const stageNow = new Date().toISOString();
          onUpdate({ ...acc, stage: newStage, ...(newStage === "Active Deal" && acc.stage !== "Active Deal" ? { activeDealAt: stageNow } : {}) });
          trackDailyStat("accounts_touched");
          if (newStage === "Active Deal" && acc.stage !== "Active Deal") {
            if (!getCompliance(acc.id)) saveCompliance(acc.id, { type: "standard", steps: STANDARD_STEPS.map(s => ({ id: s.id, status: "Not Started", days: 0, notes: "", startedAt: null, completedAt: null })) });
            if (onCreateTask) {
              const today = new Date().toISOString().split("T")[0];
              onCreateTask({ id: Date.now(), title: `Check production request status for ${acc.name}`, type: "Follow up", accId: acc.id, accName: acc.name, priority: "High", assignee: "AE", status: "Open", dueDate: today, pricingFileId: null, pricingFileName: null, notes: "", createdAt: today });
            }
          }
          if (newStage === "Closed Won") {
            onEnterClosedWon && onEnterClosedWon();
            if (onCreateTask) {
              const now = new Date().toISOString();
              const existing = tasks || [];
              [{ title: "Account Manager Intro", type: "Other" }, { title: "Turn on Production", type: "Salesforce" }].forEach((tmpl, i) => {
                const dupe = existing.some(t => t.title === tmpl.title && t.accId === acc.id);
                if (!dupe) onCreateTask({ id: Date.now() + i, title: tmpl.title, type: tmpl.type, accId: acc.id, accName: acc.name, priority: "High", status: "Open", dueDate: null, createdAt: now });
              });
            }
          }
        }} style={selectStyle(ROLE.stageAccent, `${ROLE.stageAccent}66`)}>
            {DEAL_STAGES.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
          </select>
          </Captioned>
        </>
      ),
    }] : []),
    {
      key: 'source',
      control: (
        <Captioned label="Source">
          <select className={GLOW_FOCUS_CLASS} value={acc.source || "Cold"} onChange={e => onUpdate({ ...acc, source: e.target.value })} style={selectStyle(SOURCE_C[acc.source || "Cold"] || ROLE.neutralGray, CARD.border)}>
            {ACCOUNT_SOURCES.map(s => <option key={s} value={s}>{SOURCE_IC[s]} {s}</option>)}
          </select>
        </Captioned>
      ),
    },
  ];
  if (acc.stage === "Active Deal") {
    items.push({
      key: 'gaming',
      control: (
        <button onClick={() => onUpdate({ ...acc, isGaming: !acc.isGaming })} title={acc.isGaming ? "Remove gaming track" : "Add gaming track"}
          style={{ background: "transparent", border: "none", fontSize: 13, color: acc.isGaming ? "#f59e0b" : CARD.textSubtle, cursor: "pointer", opacity: acc.isGaming ? 1 : 0.5 }}>🎲</button>
      ),
    });
  }
  return items;
}
