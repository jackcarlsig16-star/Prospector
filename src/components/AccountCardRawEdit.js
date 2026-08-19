import { useState, useEffect } from 'react';
import { mono } from '../constants/colors';
import { T } from '../constants/tokens';
import { RELATIONSHIP_TYPES } from './accountCard/business/BusinessStateControls';
import { upsertAccountBusinessDetails } from '../utils/db';

// account-taxonomy-gaps-fix-v1 Stage 1 - relationshipType included here for
// consistency/visibility with every other field, but it's a real accounts
// column (not part of the data blob, see db.js's updateAccountRelationshipType),
// so save() special-cases it below rather than folding it into the generic
// patch - the generic path would silently write it into data.relationshipType
// instead of the real column, which the next real read would ignore.
const EDITABLE_FIELDS = ["name", "web", "vert", "linkedin", "stage", "relationshipType", "tier", "score", "bm", "pf", "ucs", "headline", "blurb", "handoffNotes"];
const READONLY_FIELDS = ["id", "addedAt", "assayedAt", "source", "sfdc", "sfdcOppId", "sfdcAccountId", "parentId", "childIds"];

const renderReadonly = (v) => {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? `[${v.join(", ")}]` : "[]";
  return String(v);
};
const SUBOBJECT_FIELDS = ["personas", "callRecords"];

const dedupeLines = (text) => {
  const lines = (text || "").split("\n");
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const key = line.trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(line);
  }
  return out.join("\n");
};

export default function AccountCardRawEdit({ acc, onUpdate, onDelete, onRelationshipTypeChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const [parseError, setParseError] = useState("");
  const [showDanger, setShowDanger] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  useEffect(() => {
    if (!open) return;
    const seed = {};
    EDITABLE_FIELDS.forEach(f => { seed[f] = acc[f] !== undefined && acc[f] !== null ? (Array.isArray(acc[f]) ? acc[f].join(", ") : String(acc[f])) : ""; });
    SUBOBJECT_FIELDS.forEach(f => { seed[f] = JSON.stringify(acc[f] || [], null, 2); });
    setDraft(seed);
    setParseError("");
  }, [open, acc]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const setField = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const clearField = (k) => setDraft(d => ({ ...d, [k]: "" }));

  const handlePaste = (field, e) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted.includes("\n")) return;
    e.preventDefault();
    const current = draft[field] || "";
    const existingLines = new Set(current.split("\n").map(l => l.trim()).filter(Boolean));
    const newLines = pasted.split("\n").filter(l => !existingLines.has(l.trim()));
    const insertion = newLines.join("\n");
    const target = e.target;
    const start = target.selectionStart || 0;
    const end = target.selectionEnd || 0;
    const next = current.slice(0, start) + insertion + current.slice(end);
    setField(field, next);
  };

  const handleBlurTextarea = (field) => {
    setField(field, dedupeLines(draft[field]));
  };

  // assay-citation-leak-and-raw-edit-dual-write-v1 Fix 2 - bm/pf edits here
  // used to only reach the legacy acc.bm/acc.pf fields via onUpdate(patch)
  // (the generic merge every other field already uses). The card's own
  // IntelligenceSummary display prefers businessDetail.business_model/
  // fit_rationale over those legacy fields, so a manual correction here was
  // invisible on the card even though it correctly reached generation
  // (which reads acc.bm/acc.pf directly). Reuses the same real dual-write
  // function AccountsPage.js's reassay already calls
  // (upsertAccountBusinessDetails) - confirmed live against a real row that
  // its partial-payload upsert only touches the columns actually passed
  // (score/tier/fit_signals survive untouched), not a full-row replace.
  const save = async () => {
    const patch = {};
    EDITABLE_FIELDS.forEach(f => {
      const v = draft[f];
      if (f === "relationshipType") return; // real column, handled separately below
      if (v === "") { patch[f] = undefined; return; }
      if (f === "score") { const n = Number(v); patch[f] = Number.isFinite(n) ? n : v; return; }
      if (f === "ucs") { patch[f] = v.split(",").map(s => s.trim()).filter(Boolean); return; }
      patch[f] = v;
    });
    const nextRelType = draft.relationshipType?.trim();
    if (nextRelType && RELATIONSHIP_TYPES.includes(nextRelType) && nextRelType !== (acc.relationshipType || 'Prospect/Lead')) {
      onRelationshipTypeChange?.(acc.id, nextRelType);
    } else if (nextRelType && !RELATIONSHIP_TYPES.includes(nextRelType)) {
      setParseError(`relationshipType must be one of: ${RELATIONSHIP_TYPES.join(', ')}`);
      return;
    }
    for (const f of SUBOBJECT_FIELDS) {
      const raw = draft[f] || "";
      if (!raw.trim()) { patch[f] = []; continue; }
      try { patch[f] = JSON.parse(raw); }
      catch (err) { setParseError(`Invalid JSON in ${f}: ${err.message}`); return; }
    }
    setParseError("");
    onUpdate(patch);
    const bmChanged = (patch.bm || '') !== (acc.bm || '');
    const pfChanged = (patch.pf || '') !== (acc.pf || '');
    if (bmChanged || pfChanged) {
      const { error } = await upsertAccountBusinessDetails(acc.id, {
        business_model: patch.bm || null, fit_rationale: patch.pf || null,
      });
      // Legacy fields already saved via onUpdate above regardless - this is
      // a best-effort sync of the display-preferred copy, not blocking.
      if (error) { setParseError(`Saved, but the card's own display may still show the old value: ${error}`); return; }
    }
    setOpen(false);
  };

  const confirmDelete = () => {
    if (deleteConfirm.trim() !== (acc.name || "").trim()) return;
    onDelete && onDelete();
  };

  const SH = { ...mono, fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: T.text.muted };
  const inputStyle = { ...mono, flex: 1, fontSize: 11, padding: "4px 8px", background: T.bg.surface, border: `1px solid ${T.border.muted}`, borderRadius: 3, color: T.text.primary, outline: "none", boxSizing: "border-box" };
  const textareaStyle = { ...mono, width: "100%", fontSize: 11, padding: "6px 9px", background: T.bg.surface, border: `1px solid ${T.border.muted}`, borderRadius: 3, color: T.text.primary, outline: "none", boxSizing: "border-box", resize: "vertical", minHeight: 80, fontFamily: mono.fontFamily };

  if (!open) {
    return (
      <div style={{ marginTop: 12, borderLeft: `2px solid ${T.border.muted}`, paddingLeft: 12, paddingTop: 6, paddingBottom: 6 }}>
        <button onClick={e => { e.stopPropagation(); setOpen(true); }} style={{ ...mono, fontSize: 10, padding: "3px 8px", background: "transparent", border: `1px solid ${T.border.muted}`, color: T.text.muted, borderRadius: 3, cursor: "pointer" }}>
          ⚙ Raw Data — Edit ▾
        </button>
      </div>
    );
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{ marginTop: 12, borderLeft: `2px solid ${T.border.mid}`, paddingLeft: 12, paddingTop: 8, paddingBottom: 8, background: "rgba(255,255,255,0.02)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ ...SH, color: T.text.primary }}>⚙ Raw Data</span>
        <span style={{ ...mono, fontSize: 9, color: T.text.dim }}>Esc to close</span>
        <div style={{ flex: 1 }} />
        <button onClick={save} style={{ ...mono, fontSize: 10, padding: "3px 10px", background: `${T.neon}14`, border: `1px solid ${T.neon}55`, color: T.neon, borderRadius: 3, cursor: "pointer" }}>Save</button>
        <button onClick={() => setOpen(false)} style={{ ...mono, fontSize: 10, padding: "3px 8px", background: "transparent", border: `1px solid ${T.border.muted}`, color: T.text.muted, borderRadius: 3, cursor: "pointer" }}>Cancel</button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <p style={{ ...SH, margin: "0 0 6px" }}>Read-only</p>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "3px 10px" }}>
          {READONLY_FIELDS.map(f => (
            <div key={f} style={{ display: "contents" }}>
              <span style={{ ...mono, fontSize: 10, color: T.text.dim }}>{f}</span>
              <span style={{ ...mono, fontSize: 10, color: T.text.muted, wordBreak: "break-all" }}>{renderReadonly(acc[f])}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <p style={{ ...SH, margin: "0 0 6px" }}>Editable</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {EDITABLE_FIELDS.map(f => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ ...mono, fontSize: 10, color: T.text.muted, width: 90, flexShrink: 0 }}>{f}</span>
              <input value={draft[f] ?? ""} onChange={e => setField(f, e.target.value)} style={inputStyle} />
              <button onClick={() => clearField(f)} title="Clear field" style={{ background: "transparent", border: "none", color: T.red, fontSize: 11, cursor: "pointer", padding: "0 4px", opacity: 0.5 }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0.5}>✕</button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <p style={{ ...SH, margin: "0 0 6px" }}>Sub-objects (JSON)</p>
        {SUBOBJECT_FIELDS.map(f => (
          <div key={f} style={{ marginBottom: 8 }}>
            <p style={{ ...mono, margin: "0 0 3px", fontSize: 10, color: T.text.muted }}>{f}</p>
            <textarea
              value={draft[f] ?? ""}
              onChange={e => setField(f, e.target.value)}
              onPaste={e => handlePaste(f, e)}
              onBlur={() => handleBlurTextarea(f)}
              style={textareaStyle}
              rows={6}
            />
          </div>
        ))}
        {parseError && <p style={{ ...mono, margin: "4px 0 0", fontSize: 10, color: T.red }}>{parseError}</p>}
      </div>

      <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${T.border.muted}` }}>
        {!showDanger ? (
          <button onClick={() => setShowDanger(true)} style={{ ...mono, fontSize: 9, padding: "2px 8px", background: "transparent", border: `1px solid ${T.red}55`, color: T.red, borderRadius: 3, cursor: "pointer", opacity: 0.6 }}>Show danger zone</button>
        ) : (
          <div>
            <p style={{ ...mono, margin: "0 0 6px", fontSize: 10, color: T.red, textTransform: "uppercase", letterSpacing: "0.08em" }}>⚠ Danger zone</p>
            <p style={{ ...mono, margin: "0 0 6px", fontSize: 10, color: T.text.muted }}>Type the account name to confirm deletion: <span style={{ color: T.text.primary }}>{acc.name}</span></p>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder={acc.name} style={{ ...inputStyle, flex: 1 }} />
              <button
                onClick={confirmDelete}
                disabled={!onDelete || deleteConfirm.trim() !== (acc.name || "").trim()}
                style={{ ...mono, fontSize: 10, padding: "3px 10px", background: deleteConfirm.trim() === (acc.name || "").trim() ? `${T.red}22` : "transparent", border: `1px solid ${T.red}`, color: T.red, borderRadius: 3, cursor: deleteConfirm.trim() === (acc.name || "").trim() ? "pointer" : "not-allowed", opacity: deleteConfirm.trim() === (acc.name || "").trim() ? 1 : 0.5 }}
              >
                Delete account
              </button>
              <button onClick={() => { setShowDanger(false); setDeleteConfirm(""); }} style={{ ...mono, fontSize: 10, padding: "3px 8px", background: "transparent", border: `1px solid ${T.border.muted}`, color: T.text.muted, borderRadius: 3, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
