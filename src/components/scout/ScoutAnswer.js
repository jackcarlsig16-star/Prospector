import { useMemo } from 'react';
import { StarGlyph, LockGlyph, ClearGlyph } from './ScoutParts';
import { footerParts, summaryOf, clock } from './scoutModel';
import { sectionsOf, keyOf } from './scoutActions';
import { Section, BriefHead } from './ScoutSections';

// scout-v2 REV3 B4-B6 + D13 - the panel under the bar: working (the question, a neon sweep, elapsed seconds; the reads
// arrive WITH the answer - ask is not streamed), the answer (prose · list answers as the kit table sorted on Scout's
// field, marked in neon · Open + Task per row · Records with a one-line why · the footer from context_stats and the
// usage row · the thread), and the edge states (one line, at most one way out). Phone: stacked cards, no table.

function Prose({ text }) {
  const blocks = String(text || '').split(/\n{2,}/).map(b => b.split('\n').filter(l => l.trim()));
  const inline = s => s.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p));
  return (
    <div className="scout-prose" data-scout-prose>
      {blocks.map((lines, i) => (lines.every(l => /^\s*[-*•]\s+/.test(l))
        ? <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>)}</ul>
        : <p key={i}>{inline(lines.join(' '))}</p>))}
    </div>
  );
}

export function WorkingPanel({ q, elapsed }) {
  return (
    <div className="scout-panel" data-scout-working aria-live="polite">
      <div className="scout-q"><span className="scout-neon" style={{ display: 'inline-flex' }}><StarGlyph /></span><span>{q}</span></div>
      <div className="scout-sweep" aria-hidden="true" />
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--ui-muted)' }}>
        <span>Reading your workspace…</span><span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }} data-scout-elapsed>{elapsed} s</span>
      </div>
    </div>
  );
}

// scout-v3 Stage 2: the answer = the summary, then one numbered section per part (ScoutSections), the action block
// for this answer (the confirm card, working, done + Undo, can't-do) and its action sub-lines (D11). No Records block.
export function AnswerPanel({ turn, scopeChip, phone, scopeAll, colorOf, viewer, canAct, onOpen, inlineKey, turns, onReopen, onClear, members = [], menu = null, onMenu, onPick, onCopy, act = null }) {
  const sections = useMemo(() => sectionsOf(turn), [turn]);
  const foot = footerParts(turn);
  const numbered = sections.length > 1;
  const single = sections.length === 1 ? sections[0] : null;
  const briefOf = s => (s.brief ? s.rows.find(r => r.entity === s.brief.entity && String(r.id) === String(s.brief.id)) || null : null);
  const inline = inlineKey ? sections.flatMap(s => s.rows).find(r => keyOf(r) === inlineKey) : null;
  return (
    <div className="scout-answer" data-scout-answer>
      <div className="scout-head scout-q"><span className="scout-neon" style={{ display: 'inline-flex' }}><StarGlyph /></span><span>{turn.q}</span>{scopeChip}</div>
      <div className="scout-panel" style={{ gap: 14 }}>
        <Prose text={turn.summary || turn.answer_md} />
        {sections.map((s, i) => {
          const b = briefOf(s);
          // one part with one record and no brief: the prose is the answer, the record rides as a single row
          if (single && !s.rows.length) return null;
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
              {b && <BriefHead item={b} onOpen={onOpen} onCopy={onCopy} />}
              <Section n={i + 1} section={numbered ? s : { ...s, title: s.rows.length >= 2 ? s.title : null }} numbered={numbered} phone={phone} scopeAll={scopeAll} colorOf={colorOf} sorted={turn.ask?.sort === 'score' || turn.ask?.sort === 'heat'}
                canAct={canAct} onOpen={onOpen} menu={menu} onMenu={onMenu} members={members} onPick={onPick} />
            </div>
          );
        })}
        {inline?.why && <span className="scout-note is-inline" data-scout-inline title={inline.why}><b>{inline.title}</b> — {inline.why}</span>}
        {act}
        {(turn.actions || []).length > 0 && <div data-scout-actions>{turn.actions.map((a, i) => <div key={i} className="scout-actline">→ {a}</div>)}</div>}
        {viewer && <span className="scout-note" data-scout-viewer>Search and ask work read-only. Open goes to the record; Scout's actions need Member access.</span>}
      </div>
      <div className="scout-footer" data-scout-footer>
        <span><b>{foot.records}</b> records read · {foot.reads}</span>
        {foot.cost && <span data-scout-cost>{foot.cost}</span>}
        {turn.elapsed != null && <span>{turn.elapsed} s</span>}
        <span style={{ flex: 1 }} />
        {foot.asks && <span data-scout-asks>{foot.asks}</span>}
      </div>
      <div className="scout-thread" data-scout-thread>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="scout-lbl">{phone ? `Thread · ${turns.length}` : 'Thread · last 6'}</span>
          <button type="button" className="scout-btn" onClick={onClear}><ClearGlyph />Clear</button>
        </div>
        {!phone && turns.map(t => (t.at === turn.at
          ? <div key={t.at} className="scout-turn is-now"><b>now</b><span>{t.q}</span></div>
          : <div key={t.at} className="scout-turn"><b>{clock(t.at)}</b><span>{t.q} → {summaryOf(t.summary || t.answer_md)} · <button type="button" className="ui-link" onClick={() => onReopen(t)}>reopen</button></span></div>))}
      </div>
    </div>
  );
}

// B5 - one panel each: no hits · withheld · daily cap · empty scope · offline / 5xx (the Viewer's line rides in the answer).
export function EdgePanel({ kind, q, cap, message, onAsk, onRetry }) {
  const line = (glyph, children) => <div className="scout-edge-line">{glyph}<span>{children}</span></div>;
  const star = <StarGlyph size={14} />;
  const body = {
    nohits: { label: 'No hits', text: <>Nothing matches <b>“{q}”</b>. Try fewer letters, a person's last name, or ask it as a question.</>,
      action: <button type="button" className="scout-btn scout-btn--neon" onClick={onAsk}><StarGlyph size={13} />Ask “{q}” anyway</button> },
    withheld: { label: 'Answer withheld', glyph: <LockGlyph />, text: "The answer contained an email address, so Scout didn't show it. Ask for the person or company instead; names and titles are fine.",
      action: <button type="button" className="scout-btn scout-btn--plain" onClick={onRetry}>Retry without contact details</button> },
    cap: { label: 'Daily cap', text: <>You've used <b>{cap?.used ?? 40} of {cap?.max ?? 40}</b> asks today. Search still works; asking opens again at midnight PT.</> },
    empty: { label: 'No workspace', text: 'No workspace yet — ask the owner to add you.' },
    error: { label: 'Scout', text: message },
    offline: { label: 'Offline', text: "Scout can't reach the server · try again.", action: <button type="button" className="scout-btn scout-btn--plain" onClick={onRetry}>Retry</button> },
  }[kind];
  return (
    <div className="scout-edge" data-scout-edge={kind} role={kind === 'nohits' ? undefined : 'status'}>
      <span className="scout-lbl">{body.label}</span>
      {line(body.glyph || star, body.text)}
      {body.action && <div>{body.action}</div>}
    </div>
  );
}

