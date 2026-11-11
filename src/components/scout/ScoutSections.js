import { useEffect, useRef, useState } from 'react';
import HeatPill from '../salesAnalytics/people/HeatPill';
import { OpenGlyph, SortGlyph, CaretGlyph, WorkspaceTag } from './ScoutParts';
import { entityLabel } from './scoutModel';
import { keyOf, rowKind, menuFor, sectionNoun, countPill, SNOOZE_CHOICES, PHONE_SHOWN } from './scoutActions';

// scout-v3 Stage 2 (specs/design/scout-v3/Scout3Answer + Scout3Phone) - one numbered section per part of the ask: its
// title, a count pill, a table of the part's rows (people: name over title · company over stage · heat on the one
// scale · last visit · last email; tasks: text · owner · due; companies: name · kind · owner · score), and a footer
// carrying the rule (from the intent, never the model) and what was read. The rows ARE the records - no Records block.
// Each row: Open and a ⋯ menu. Phone: stacked cards, "n more ▾" after three people / two tasks.
const fmt = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const stage = s => (s ? String(s).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : null);
const Stack = ({ top, sub, title }) => <span className="scout-stack" title={title || top}><b>{top}</b>{sub && <small>{sub}</small>}</span>;
const Mark = ({ children, dir = '▼' }) => <span className="scout-sortmark" data-scout-sort><SortGlyph />{children} {dir}</span>;
function Result({ r }) {
  if (!r) return null;
  return <span className={`scout-result is-${r.state}`} data-scout-result={r.state} role="status">{r.state === 'updated' ? `${r.text || 'done'} · updated` : r.state === 'failed' ? `failed: ${r.text}` : r.text}</span>;
}

function due(row) {
  if (!row.due) return <span className="scout-dim">no date</span>;
  return <span className={row.overdue ? 'scout-overdue' : undefined} data-scout-due={row.overdue ? 'overdue' : 'dated'}>{row.overdue ? `overdue · ${fmt(row.due)}` : fmt(row.due)}</span>;
}

// columns per row kind: [{ label, cell(item), w }]
// A company named on a row opens through the opener the server attached (never a route built here).
const CompanyLink = ({ refTo, onOpen, sub }) => (refTo?.open
  ? <span className="scout-stack"><button type="button" className="scout-link" title={`Open ${refTo.name}`} onClick={() => onOpen({ entity: refTo.entity, id: refTo.id, title: refTo.name, open: refTo.open })}>{refTo.name}</button>{sub && <small>{sub}</small>}</span>
  : <Stack top={refTo.name} sub={sub} />);
const ownerName = (row, members) => { const m = row.owner_user_id ? members.find(x => x.user_id === row.owner_user_id) : null; return m ? { name: m.first, color: m.color } : { name: ({ mine: 'You', unassigned: 'Unassigned' })[row.owner] || 'Another owner', color: null }; };
const Owner = ({ row, members }) => { const o = ownerName(row, members); return <span className="scout-owner">{o.color && <i className="scout-dot" style={{ background: o.color }} />}{o.name}</span>; };

function columnsFor(kind, { scopeAll, colorOf, sorted, members, onOpen }) {
  const ws = scopeAll ? [{ label: 'Workspace', w: 140, cell: r => <WorkspaceTag name={r.workspace_name} color={colorOf(r.workspace_id)} /> }] : [];
  if (kind === 'person') return [
    { label: 'Person', cell: r => <Stack top={r.row.name} sub={r.row.title} /> },
    { label: 'Company', cell: r => (r.row.company ? <CompanyLink refTo={r.row.company} onOpen={onOpen} sub={r.row.company.id ? stage(r.row.company.stage) : 'no company record'} /> : <span className="scout-dim">—</span>) },
    ...ws,
    { label: <Mark>Heat</Mark>, w: 104, cell: r => <HeatPill heat={r.row.heat} band={r.row.heat_band} size="sm" /> },
    { label: 'Last visit', w: 150, cell: r => (r.row.last_visit ? <span title={r.row.last_path || undefined}>{[fmt(r.row.last_visit), r.row.last_path].filter(Boolean).join(' · ')}</span> : <span className="scout-dim">—</span>) },
    { label: 'Last email', w: 128, cell: r => (r.row.last_email ? `${fmt(r.row.last_email.at)} · ${r.row.last_email.what}` : <span className="scout-dim">—</span>) },
  ];
  if (kind === 'task') return [
    { label: 'Task', cell: r => <span title={r.row.text} className="scout-clip">{r.row.text}</span> },
    { label: 'Company', w: 150, cell: r => (r.row.link ? <CompanyLink refTo={r.row.link} onOpen={onOpen} /> : <span className="scout-dim">—</span>) },
    ...ws,
    { label: 'Owner', w: 120, cell: r => <Owner row={r.row} members={members} /> },
    { label: <Mark dir="▲">Due</Mark>, w: 136, cell: r => due(r.row) },
  ];
  if (kind === 'company') return [
    { label: 'Company', cell: r => <CompanyLink refTo={{ entity: r.entity, id: r.id, name: r.title, open: r.open }} onOpen={onOpen} sub={[entityLabel(r.entity), stage(r.row?.stage)].filter(Boolean).join(' · ')} /> },
    ...ws,
    { label: 'Owner', w: 120, cell: r => r.row?.owner || <span className="scout-dim">Unassigned</span> },
    { label: sorted ? <Mark>Score</Mark> : 'Score', w: 92, cell: r => <span className="scout-num">{r.score ?? r.row?.score ?? '—'}{r.row?.band ? ` · ${r.row.band}` : ''}</span> },
  ];
  return [
    { label: 'Record', cell: r => <Stack top={r.title} sub={[entityLabel(r.entity), r.subtitle].filter(Boolean).join(' · ')} /> },
    ...ws,
    { label: 'When', w: 110, cell: r => (r.date ? fmt(r.date) : r.score ?? <span className="scout-dim">—</span>) },
  ];
}

// The ⋯ menu: a popover on desktop, a bottom action sheet on the phone (44 px rows). Assign ▸ members, Snooze ▸ dates.
export function RowMenu({ item, phone, members, onPick, onClose }) {
  const [sub, setSub] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); if (sub) setSub(null); else onClose(); } };
    const out = e => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener('keydown', key, true); document.addEventListener('mousedown', out);
    ref.current?.querySelector('button')?.focus();
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('mousedown', out); };
  }, [sub, onClose]);
  const items = menuFor(item);
  const subItems = sub === 'members' ? [...members.map(m => ({ id: m.user_id, label: m.first || m.name, color: m.color })), { id: null, label: 'Unassigned' }] : sub === 'dates' ? SNOOZE_CHOICES : null;
  const title = [item.title, item.row?.company?.name].filter(Boolean).join(' · ');
  return (
    <div ref={ref} className={`scout-menu${phone ? ' scout-menu--sheet' : ''}`} data-scout-menu={sub || 'root'}>
      {phone && <div className="scout-menu__title">{sub ? <button type="button" className="scout-btn" onClick={() => setSub(null)}>‹ Back</button> : title}</div>}
      {subItems && !subItems.length && <span className="scout-note" style={{ padding: '8px 12px' }}>Loading…</span>}
      <div role="menu" aria-label={`Actions for ${item.title}`} className="scout-menu__list">
      {!subItems && items.map(m => (
        <button key={m.id} type="button" role="menuitem" data-scout-pick={m.id} aria-haspopup={m.sub ? 'menu' : undefined} onClick={() => (m.sub ? setSub(m.sub) : onPick(m.id))}>
          <span>{m.label}</span>{m.sub && <span aria-hidden="true">▸</span>}
        </button>
      ))}
      {subItems && subItems.map(m => (
        <button key={String(m.id)} type="button" role="menuitem" data-scout-pick={`${sub}:${m.id}`} onClick={() => onPick(sub === 'members' ? 'assign' : 'snooze', sub === 'members' ? { owner_user_id: m.id } : { days: m.days })}><span className="scout-owner">{m.color && <i className="scout-dot" style={{ background: m.color }} />}{m.label}</span></button>
      ))}
      </div>
    </div>
  );
}

function Actions({ item, canAct, onOpen, onMenu, menu, phone, members, onPick }) {
  const open = menu === keyOf(item);
  const has = canAct && menuFor(item).length > 0;
  return (
    <span className="scout-actions" style={{ position: 'relative' }}>
      {item.open && <button type="button" className="scout-btn" onClick={() => onOpen(item)} aria-label={`Open ${item.title}`}><OpenGlyph />Open</button>}
      {has && <button type="button" className="scout-btn scout-more-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${item.title}`} onClick={() => onMenu(open ? null : keyOf(item))}>⋯</button>}
      {open && <RowMenu item={item} phone={phone} members={members} onPick={(id, args) => onPick(item, id, args)} onClose={() => onMenu(null)} />}
    </span>
  );
}

function PhoneCard({ item, kind, actions, members }) {
  const r = item.row || {};
  return (
    <div className="scout-card" data-scout-row={keyOf(item)}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ flex: 1, minWidth: 0 }}>{kind === 'task' ? r.text : item.title}</span>{kind === 'person' && <HeatPill heat={r.heat} band={r.heat_band} size="sm" />}</span>
      {kind === 'person' && <small className="scout-dim">{[r.title, r.company?.name].filter(Boolean).join(' · ')}</small>}
      <div><span>{kind === 'person' ? (r.last_visit ? `visit ${fmt(r.last_visit)}${r.last_path ? ` · ${r.last_path}` : ''}` : r.last_email ? `${r.last_email.what} ${fmt(r.last_email.at)}` : 'no visit yet') : kind === 'task' ? <>{[r.link?.name, ownerName(r, members).name].filter(Boolean).join(' · ')} · {due(r)}</> : [entityLabel(item.entity), item.subtitle, item.date ? fmt(item.date) : item.score].filter(Boolean).join(' · ')}</span>{actions}</div>
      <Result r={item.result} />
    </div>
  );
}

export function Section({ n, section, numbered, phone, scopeAll, colorOf, sorted, canAct, onOpen, menu, onMenu, members, onPick }) {
  const [all, setAll] = useState(false);
  const kinds = new Set(section.rows.map(rowKind));
  const kind = kinds.size === 1 ? [...kinds][0] : 'other';
  const cols = columnsFor(kind, { scopeAll, colorOf, sorted, members, onOpen });
  const cap = phone && !all ? PHONE_SHOWN[kind === 'person' ? 'people' : kind === 'task' ? 'todos' : ''] || section.rows.length : section.rows.length;
  const shown = section.rows.slice(0, cap), hidden = section.rows.length - shown.length;
  const act = item => <Actions item={item} canAct={canAct} onOpen={onOpen} onMenu={onMenu} menu={menu} phone={phone} members={members} onPick={onPick} />;
  const foot = [section.rule, section.read ? `read from ${section.read}` : null].filter(Boolean);
  return (
    <section className="scout-section" data-scout-section={n} aria-label={section.title || `Part ${n}`}>
      {(numbered || section.title) && (
        <header className="scout-section__head">
          {numbered && <span className="scout-num-badge" aria-hidden="true">{n}</span>}
          <b className="scout-section__title">{section.title || `Part ${n}`}</b>
          <span className="scout-count" data-scout-count>{countPill(section, sectionNoun(section))}</span>
        </header>
      )}
      {!section.rows.length && <p className="scout-empty" data-scout-empty>{section.line || 'Nothing matched.'}</p>}
      {shown.length > 0 && !phone && (
        <div className="scout-tablewrap">
          <table className="scout-table" data-scout-table={kind}>
            <thead><tr>{cols.map((c, i) => <th key={i} scope="col" style={c.w ? { width: c.w } : undefined}>{c.label}</th>)}<th scope="col" style={{ width: 118 }}><span className="scout-sr">Actions</span></th></tr></thead>
            <tbody>
              {shown.map(item => (
                <tr key={keyOf(item)} data-scout-row={keyOf(item)} className={item.result ? `is-${item.result.state}` : undefined}>
                  {cols.map((c, i) => <td key={i}>{c.cell(item)}{i === 0 && <Result r={item.result} />}</td>)}
                  <td>{act(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > 0 && phone && <div className="scout-cards" data-scout-cards>{shown.map(item => <PhoneCard key={keyOf(item)} item={item} kind={kind} actions={act(item)} members={members} />)}</div>}
      {hidden > 0 && <button type="button" className="scout-btn scout-more" onClick={() => setAll(true)}>{hidden} more <CaretGlyph /></button>}
      {foot.length > 0 && section.rows.length > 0 && <footer className="scout-rule" data-scout-rule>{foot.map((f, i) => <span key={i}>{f}</span>)}</footer>}
    </section>
  );
}

// D9: a brief (one company or person + a brief word) opens with its header - Brief · 1 record · the name · heat or
// score · Open · Copy for Claude - above its rows.
export function BriefHead({ item, onOpen, onCopy }) {
  const person = item.entity === 'people';
  return (
    <div className="scout-brief" data-scout-brief>
      <span className="scout-count">Brief · 1 {person ? 'person' : 'company'}</span>
      <b>{item.title}</b>
      {person ? <HeatPill heat={item.row?.heat} band={item.row?.heat_band} size="sm" /> : (item.score ?? item.row?.score) != null && <span className="scout-num scout-dim">Score {item.score ?? item.row.score}{item.row?.band ? ` · ${item.row.band}` : ''}</span>}
      <span style={{ flex: 1 }} />
      {item.open && <button type="button" className="scout-btn" onClick={() => onOpen(item)} aria-label={`Open ${item.title}`}><OpenGlyph />Open</button>}
      <button type="button" className="scout-btn scout-btn--accent" data-scout-copy onClick={() => onCopy([item])}>Copy for Claude</button>
    </div>
  );
}
