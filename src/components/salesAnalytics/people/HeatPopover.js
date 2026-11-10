import { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_THEME_ROOT_ID } from '../theme';
import HeatPill, { HEAT_COLOR } from './HeatPill';
import { HEADCOUNT_SOURCE_GLYPH } from '../../../constants/headcount';

// heat-v2 D3 - the ⓘ on the Heat header: a button (aria-expanded; Enter / Space open it, Esc and a click outside close
// it; a Viewer sees it) and a 360 px popover - "How heat works", the three brackets as pills, the bracket rule, the
// fade, the size glyphs and the two columns the old footnote explained. It replaces the footnote under the sticky
// header. Rendered through a portal (fixed, under the button) so the table box's scroll never clips it.
const SIZE_WORDS = { apollo: 'from Apollo', manual: 'typed in', research: 'from research' };
const mdy = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null);
const h4 = { margin: 0, fontSize: 13, fontWeight: 600, color: SA.text };
const row = { display: 'flex', alignItems: 'center', gap: 10 };
const divider = { borderTop: `1px solid ${SA.border}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 };

export default function HeatPopover({ rule, historySince = null }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btn = useRef(null), pop = useRef(null);
  const id = useId();
  const hot = rule?.hot ?? 40, warm = rule?.warm ?? 10, fade = rule?.fade || { fresh: 7, mid: 0.5, old: 30, floor: 0.25 };
  const place = () => { const r = btn.current?.getBoundingClientRect(); if (!r) return; setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left - 120, window.innerWidth - 360 - 12)) }); };
  useEffect(() => {
    if (!open) return undefined;
    place();
    pop.current?.focus();
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    const onDown = e => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  const root = typeof document !== 'undefined' ? document.getElementById(SA_THEME_ROOT_ID) || document.body : null;
  return (
    <>
      <button ref={btn} type="button" data-heat-info aria-label="How heat works" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(o => !o)} style={{ all: 'unset', cursor: 'pointer', color: SA.accent, display: 'inline-flex', alignItems: 'center', marginLeft: 2, verticalAlign: 'middle' }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 7.5v4M8 5.2h.01" /></svg>
      </button>
      {open && root && createPortal(
        <div ref={pop} id={id} role="dialog" aria-label="How heat works" tabIndex={-1} data-heat-popover className="ui-theme-dark" style={{ position: 'fixed', top: pos.top, left: pos.left, width: 360, boxSizing: 'border-box', zIndex: 4006, background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 12, padding: '14px 16px', boxShadow: '0 16px 40px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5, lineHeight: 1.5, color: SA.soft, whiteSpace: 'normal', textAlign: 'left', fontWeight: 400, textTransform: 'none', letterSpacing: 0, outline: 'none' }}>
          <h4 style={h4}>How heat works</h4>
          <div>One number, 0–200, per person. Points for every real signal: a human open, a click, a reply, and a company visit in the last 7 days. Older signals fade.</div>
          <div style={row}><HeatPill heat={108} band="hot" /><span>score ≥ {hot}</span></div>
          <div style={row}><HeatPill heat={28} band="warm" /><span>score {warm}–{hot - 1}</span></div>
          <div style={row}><HeatPill heat={4} band="cold" /><span>score below {warm}</span></div>
          <div style={{ color: SA.muted }}>Band is the number's bracket, nothing else — a <span style={{ color: HEAT_COLOR.warm }}>Warm</span> person is never above a <span style={{ color: HEAT_COLOR.hot }}>Hot</span> one. Signals fade with age: whole for {fade.fresh} days, ×{fade.mid} to {fade.old} days, then ×{fade.floor}. Opens count humans only (scanners and link checkers are excluded). Times are Pacific. <span data-history-since>{historySince ? `History since ${mdy(historySince)}.` : 'History starts with the next sync.'}</span></div>
          <div style={divider}><h4 style={h4}>Size glyphs</h4>{Object.entries(HEADCOUNT_SOURCE_GLYPH).map(([k, g]) => <div key={k} style={row}><span aria-hidden="true" style={{ width: 14, textAlign: 'center' }}>{g}</span><span>{SIZE_WORDS[k]}</span></div>)}</div>
          <div style={divider}><h4 style={h4}>Columns</h4><div><b style={{ color: SA.text }}>Identified</b> — the date Apollo named this person on the site. <b style={{ color: SA.text }}>buyer</b> tag — the title matches your buyer-title list (Settings).</div></div>
        </div>, root)}
    </>
  );
}
