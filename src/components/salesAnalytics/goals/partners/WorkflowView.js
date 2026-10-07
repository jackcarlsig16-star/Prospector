import { useState } from 'react';
import { SA, saSans } from '../../theme';
import { WORKFLOW_STEPS, stepOf, isTouched, comparePartners } from '../../../../constants/partnerPipeline';
import { labelStyle, h3Style, subStyle, numStyle, ShowingChip } from '../goalsUi';
import { FAMILIES, familyOf, categoryNumber, categoryName } from './partnerTypes';
import PartnerRow from './PartnerRow';

// sales-partners-workflow-v1 - Partners as a workflow: one bar of every
// partner by stage (click a segment to filter), the key, Top priorities,
// then one group per category with its top 5.
const TOP = 5;
// prospector_partners_key - per-viewer convenience: key collapsed or open.
const KEY_KEY = 'prospector_partners_key';
const readKeyOpen = () => { try { return localStorage.getItem(KEY_KEY) !== 'collapsed'; } catch { return true; } };
const writeKeyOpen = open => { try { localStorage.setItem(KEY_KEY, open ? 'open' : 'collapsed'); } catch { /* private mode */ } };
const PAUSED = { id: 'paused', label: 'Paused' };
// Stage colors for the overall bar: one sequential ramp, light -> accent.
const stageColor = i => `color-mix(in srgb, var(--sa-accent) ${20 + i * 11}%, var(--sa-track))`;
const stageKey = p => (stepOf(p.pipeline_status) === null ? 'paused' : WORKFLOW_STEPS[stepOf(p.pipeline_status)].id);

function OverallBar({ partners, stage, onStage }) {
  const total = partners.length || 1;
  const segs = [...WORKFLOW_STEPS.map((s, i) => ({ ...s, color: stageColor(i) })), { ...PAUSED, color: SA.neutral }]
    .map(s => ({ ...s, count: partners.filter(p => stageKey(p) === s.id).length })).filter(s => s.count);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div role="group" aria-label="Partners by stage" style={{ display: 'flex', gap: 2, height: 28, borderRadius: 8, overflow: 'hidden' }}>
        {segs.map(s => {
          const on = stage === s.id;
          return (
            <button key={s.id} type="button" aria-pressed={on} onClick={() => onStage(on ? null : s.id)} title={`${s.label}: ${s.count}`}
              aria-label={`${s.label} ${s.count}`}
              style={{ all: 'unset', cursor: 'pointer', flex: `${s.count / total} 1 0`, minWidth: 22, background: s.color, opacity: stage && !on ? 0.35 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: SA.text, ...numStyle,
                outline: on ? `2px solid ${SA.text}` : undefined, outlineOffset: -2 }}>
              {s.count}
            </button>
          );
        })}
      </div>
      <div aria-hidden="true" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: SA.muted }}>
        {segs.map(s => (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: stage === s.id ? SA.text : SA.muted }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />{s.label} <span style={numStyle}>{s.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Key({ open, onToggle }) {
  return (
    <div style={{ background: SA.inset, border: `1px solid ${SA.border}`, borderRadius: 10, padding: open ? '12px 14px' : '8px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button type="button" aria-expanded={open} onClick={onToggle}
        style={{ all: 'unset', ...saSans, cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: SA.soft, minHeight: 28 }}>
        <span style={{ ...labelStyle }}>Key</span>
        {!open && <span style={{ ...subStyle, fontSize: 12 }}>8 stages · 6 partner types · Next moves one step</span>}
        <span style={{ marginLeft: 'auto', color: SA.muted }}>{open ? 'Hide ▾' : 'Show ▸'}</span>
      </button>
      {open && <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, color: SA.muted }}>Stages, in order. Each row's bar fills up to where the partner is; the outlined step (labeled under it) is now.</span>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 13 }}>
            {WORKFLOW_STEPS.map((s, i) => <li key={s.id}><span style={{ ...numStyle, color: SA.muted }}>{i + 1}</span> {s.label}</li>)}
            <li style={{ color: SA.muted }}>· Paused = parked, bar greyed</li>
          </ol>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, color: SA.muted }}>Partner type: the colored edge on each row and its stage bar.</span>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 13 }}>
            {FAMILIES.map(f => (
              <li key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 4, height: 16, borderRadius: 2, background: f.color }} />{f.label}
              </li>
            ))}
          </ul>
        </div>
        <span style={{ fontSize: 13, color: SA.soft }}>
          <b>Next</b> moves a partner one step · <b>⋯</b> has everything else (jump to a stage, assign, hot, snooze, note) · ▲▼ moves a row up or down · 🔥 hot · P1–P3 priority · days = since last touch (red at 7+; — = contacted, no date recorded)
        </span>
      </>}
    </div>
  );
}

function Group({ cat, items, lookup, compact }) {
  const [showAll, setShowAll] = useState(false);
  const fam = familyOf(cat);
  const sorted = [...items].sort(comparePartners);
  const shown = showAll ? sorted : sorted.slice(0, TOP);
  const touched = items.filter(isTouched).length;
  const progressed = items.filter(p => (stepOf(p.pipeline_status) ?? 0) >= 2).length;
  const owners = new Map();
  for (const p of items) { const k = p.owner_user_id || 'none'; owners.set(k, (owners.get(k) || 0) + 1); }
  const n = categoryNumber(cat);
  return (
    <section aria-label={categoryName(cat)} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span aria-hidden="true" style={{ width: 4, height: 22, borderRadius: 2, background: fam.color }} />
        <h3 style={{ ...h3Style, display: 'flex', gap: 6, alignItems: 'baseline' }}>
          {n && <span style={{ ...numStyle, color: SA.muted, fontWeight: 500 }}>{n}.</span>}{categoryName(cat)}
        </h3>
        <span style={{ ...subStyle, ...numStyle, fontSize: 13 }}>{touched} of {items.length} touched</span>
        <span role="img" aria-label={`${progressed} of ${items.length} past research`} title={`${progressed} of ${items.length} past research (drafted or further)`}
          style={{ width: 80, height: 4, borderRadius: 999, background: SA.track, overflow: 'hidden' }}>
          <span style={{ display: 'block', height: 4, width: `${Math.round((progressed / items.length) * 100)}%`, background: fam.color }} />
        </span>
        <span style={{ display: 'flex', gap: 8, marginLeft: 'auto', fontSize: 12, color: SA.muted }}>
          {[...owners.entries()].map(([id, c]) => {
            const o = id === 'none' ? { first: 'Unassigned', color: lookup(null).color } : lookup(id);
            return <span key={id} title={o.first} aria-label={`${o.first} ${c}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: o.color }} />{c}</span>;
          })}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shown.map(p => <PartnerRow key={p.id} partner={p} lookup={lookup} compact={compact} />)}
      </div>
      {sorted.length > TOP && (
        <button type="button" aria-expanded={showAll} onClick={() => setShowAll(s => !s)}
          style={{ all: 'unset', ...saSans, cursor: 'pointer', color: SA.link, fontSize: 13, minHeight: 28, alignSelf: 'flex-start' }}>
          {showAll ? 'Show top 5 ▴' : `Show ${sorted.length - TOP} more ▾`}
        </button>
      )}
    </section>
  );
}

export default function WorkflowView({ partners, shown, lookup, compact, stage, onStage }) {
  const [keyOpen, setKeyOpen] = useState(readKeyOpen);
  const visible = stage ? shown.filter(p => stageKey(p) === stage) : shown;
  const top = visible.filter(p => p.priority === 1 || p.hot).sort(comparePartners).slice(0, TOP);
  const cats = [...new Set(visible.map(p => p.category || null))].sort((a, b) => (categoryNumber(a) ?? 99) - (categoryNumber(b) ?? 99) || String(a).localeCompare(String(b)));
  const stageLabel = stage === 'paused' ? 'Paused' : WORKFLOW_STEPS.find(s => s.id === stage)?.label;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 20 }}>
      <OverallBar partners={partners} stage={stage} onStage={onStage} />
      <Key open={keyOpen} onToggle={() => { setKeyOpen(o => !o); writeKeyOpen(!keyOpen); }} />
      {stage && <div><ShowingChip label={stageLabel} count={visible.length} onClear={() => onStage(null)} /></div>}
      {top.length > 0 && (
        <section aria-label="Top priorities" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 12, border: `1px solid color-mix(in srgb, var(--sa-accent) 30%, var(--sa-border))`, background: 'color-mix(in srgb, var(--sa-accent) 5%, transparent)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h3 style={h3Style}>Top priorities</h3>
            <span style={{ ...subStyle, fontSize: 12 }}>P1 and 🔥 hot partners across every category, highest first</span>
          </div>
          {top.map(p => <PartnerRow key={p.id} partner={p} lookup={lookup} compact={compact} showCategory />)}
        </section>
      )}
      {cats.map(c => <Group key={c || 'none'} cat={c} items={visible.filter(p => (p.category || null) === c)} lookup={lookup} compact={compact} />)}
    </div>
  );
}

