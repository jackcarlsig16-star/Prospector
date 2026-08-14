import { mono } from '../../../constants/colors';
import { CARD, RADIUS } from '../tokens';
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

export const ACCOUNT_SOURCES = ["Cold", "Inbound", "Referral", "Partner", "6sense", "SFDC"];
const SOURCE_C = { Cold: CARD.textMuted, Inbound: "#56A8F8", Referral: "#42E890", Partner: "#A878F0", "6sense": "#0099DD", SFDC: "#F5A050" };
const SOURCE_IC = { Cold: "○", Inbound: "↘", Referral: "🤝", Partner: "⬡", "6sense": "◎", SFDC: "☁" };

const selectStyle = color => ({ ...mono, fontSize: 11, height: 24, padding: "0 6px", background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: RADIUS.sm, color, outline: "none", cursor: "pointer" });

// Feeds AccountStateBar's `items` for business accounts — Stage select,
// Gaming track toggle, Source select. Relocated verbatim (side effects on
// stage change: compliance seeding, task creation, gift-modal trigger) from
// the old AccountCard.js.
export function buildBusinessStateItems({ acc, onUpdate, tasks, onCreateTask, onEnterClosedWon }) {
  if (!onUpdate) return [];
  const items = [
    {
      key: 'stage',
      control: (
        <select value={acc.stage || "Prospecting"} onChange={e => {
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
        }} style={selectStyle(DEAL_STAGES.find(d => d.id === (acc.stage || "Prospecting"))?.c || CARD.textMuted)}>
          {DEAL_STAGES.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
        </select>
      ),
    },
    {
      key: 'source',
      control: (
        <select value={acc.source || "Cold"} onChange={e => onUpdate({ ...acc, source: e.target.value })} style={selectStyle(SOURCE_C[acc.source || "Cold"] || CARD.textMuted)}>
          {ACCOUNT_SOURCES.map(s => <option key={s} value={s}>{SOURCE_IC[s]} {s}</option>)}
        </select>
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
