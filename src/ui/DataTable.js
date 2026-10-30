import React, { useState, useEffect, useRef, useMemo, useId } from 'react';
import './kitTheme';
import { KIT_TABLE } from './tokens';

// pipeline-wide-table-v1 - a real <table> with a sticky header, a sticky first
// column, per-group sorting and collapsible groups. Hand-built on the kit, no
// grid library.
//   columns: [{ id, label, width?, minWidth?, sticky?, stickyEnd?, sortValue?(row), render(row), title?(row) }]
//   sticky pins a column to the left edge, stickyEnd to the right (row actions
//   that must stay in view while the rest scrolls sideways).
//   groups:  [{ id, header, icon?, rows, collapsed?, onToggle? }]
//   rowStyle(row) -> style for the <tr>; `--ui-row-tint` and `--ui-row-bar`
//   custom properties paint the tint and the 3px bar (the sticky cell keeps a
//   solid surface under the tint so it covers scrolled columns).
//   compact + renderCompact(row): the phone list, same groups and keys.
// A header click cycles asc -> desc -> off; off = the rows as given. Pass
// sort ({ id, dir } | null) + onSort to own the sort (e.g. to remember it).
//   dense: KIT_TABLE.denseRowHeight rows (sales-ia-v2 Pipeline > Companies).
//   pinUnder: selector of the page's sticky header. The box is as tall as the
//   window under that header (a fixed height, so the page never grows while
//   it scrolls); at the top of the page its bottom sits below the fold, and
//   scrolling the page by the rows above it (filters) brings it up until it
//   fills the window under the header. A wheel down over the box scrolls the
//   page first (until pinned), then the rows - without it the page would
//   never move while the pointer is over the table.
//   onRowClick(row): a press on the row outside its controls (priorities-v2: a row selects its chart dot).
//   renderDetail(row) + a column with detail: true: that cell starts with a
//   ▸ / ▾ button, and the button or a click on the cell opens the detail panel
//   in a full-width row under it (phone list: under the item). One open at a
//   time; Esc or the button closes it. Controls inside a row never toggle it.
//   serverSort (opt-in): the rows arrive sorted by the server for `sort` - the header still cycles it through onSort,
//   but the loaded rows are never re-sorted here.
//   onReachEnd() (opt-in): called when the end of the rows scrolls into view (load the next page); a sentinel after
//   the last row, watched by IntersectionObserver where the browser has one.

const compare = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));

// Blanks stay last in both directions; ties keep the given order.
export function sortRows(rows, column, dir) {
  if (!column || !dir) return rows;
  const sign = dir === 'asc' ? 1 : -1;
  return rows.map((r, i) => [r, i, column.sortValue(r)]).sort(([, i, a], [, j, b]) => ((a == null) - (b == null)) || (a == null ? 0 : sign * compare(a, b)) || i - j).map(([r]) => r);
}

const cellClass = c => [c.sticky ? 'ui-table__sticky' : c.stickyEnd ? 'ui-table__sticky-end' : null, c.detail ? 'ui-table__detail-cell' : null].filter(Boolean).join(' ') || undefined;
const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"]';
const detailText = (r, c) => String(c?.title?.(r) || '');

function GroupHeading({ group }) {
  const h = <h3>{group.header}</h3>;
  return group.onToggle
    ? <button type="button" className="ui-table__toggle" aria-expanded={!group.collapsed} onClick={group.onToggle}>{group.icon}{h}</button>
    : <span className="ui-table__gh">{group.icon}{h}</span>;
}

export default function DataTable({ columns, groups, rowStyle, rowKey, compact = false, renderCompact, renderDetail, emptyText, label, sort: sortProp, onSort, dense = false, pinUnder = null, onRowClick, serverSort = false, onReachEnd = null }) {
  const [sortState, setSortState] = useState(null);
  const [openKey, setOpenKey] = useState(null);
  const idBase = useId();
  const sort = onSort ? sortProp : sortState;
  const setSort = onSort ? f => onSort(f(sortProp)) : setSortState;
  const boxRef = useRef(null);
  const [height, setHeight] = useState(null);
  const sortCol = useMemo(() => columns.find(c => c.id === sort?.id) || null, [columns, sort]);
  const rowClick = r => (onRowClick ? e => { if (!e.target.closest?.(INTERACTIVE)) onRowClick(r); } : undefined);
  const endRef = useRef(null);
  const reachEnd = useRef(onReachEnd);
  reachEnd.current = onReachEnd;
  const watchEnd = !!onReachEnd;
  useEffect(() => {
    const el = endRef.current;
    if (!watchEnd || !el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) reachEnd.current?.(); }, { root: compact ? null : boxRef.current, rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [watchEnd, compact]);
  const ordered = rows => (serverSort ? rows : sortRows(rows, sortCol, sort?.dir));

  useEffect(() => {
    if (compact) return undefined;
    // The header's bottom while stuck; its own height if the page has scrolled past where it stays stuck.
    const pin = () => { const r = pinUnder && document.querySelector(pinUnder)?.getBoundingClientRect(); return r ? Math.max(r.bottom, r.height) : 0; };
    const slack = () => Math.max(0, boxRef.current.getBoundingClientRect().top - pin());
    const fit = () => {
      const el = boxRef.current;
      if (!el) return;
      const top = pinUnder ? pin() : el.getBoundingClientRect().top;
      const h = Math.max(KIT_TABLE.minHeight, window.innerHeight - top - KIT_TABLE.bottomGap);
      setHeight(prev => (prev != null && Math.abs(prev - h) < 1 ? prev : h));
      if (!pinUnder) return;
      // Whatever the page keeps under the table (shell padding) would let it scroll past the
      // pin and under the header; pull it up by that much so the page stops exactly pinned.
      el.style.marginBottom = '';
      const below = document.documentElement.scrollHeight - (el.getBoundingClientRect().bottom + window.scrollY);
      el.style.marginBottom = `${-Math.max(0, below - KIT_TABLE.bottomGap)}px`;
    };
    const onWheel = e => {
      if (e.deltaY <= 0 || e.ctrlKey) return;
      const by = Math.min(e.deltaY, slack());
      if (by < 1) return;
      e.preventDefault();
      window.scrollBy(0, by);
    };
    fit();
    const el = boxRef.current;
    window.addEventListener('resize', fit);
    if (pinUnder) { window.addEventListener('scroll', fit, { passive: true }); el?.addEventListener('wheel', onWheel, { passive: false }); }
    return () => { window.removeEventListener('resize', fit); window.removeEventListener('scroll', fit); el?.removeEventListener('wheel', onWheel); };
  }, [compact, pinUnder]);

  const cycle = col => setSort(s => (s?.id !== col.id ? { id: col.id, dir: 'asc' } : s.dir === 'asc' ? { id: col.id, dir: 'desc' } : null));
  const ariaSort = col => (!col.sortValue ? undefined : sort?.id !== col.id ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending');
  const glyph = col => (sort?.id !== col.id ? '↕' : sort.dir === 'asc' ? '▲' : '▼');
  const visible = groups.filter(g => g.rows.length || g.emptyText);
  const detailCol = renderDetail ? columns.find(c => c.detail) || null : null;
  const hasDetail = !!renderDetail && (compact || !!detailCol);
  const panelId = key => `${idBase}-detail-${key}`;
  const buttonId = key => `${idBase}-disclose-${key}`;
  const toggle = key => setOpenKey(k => (k === key ? null : key));
  // Clicks on the row's own controls (and the disclosure, which handles itself) never toggle.
  const onAreaClick = key => e => { if (e.target.closest(INTERACTIVE)) return; toggle(key); document.getElementById(buttonId(key))?.focus(); };
  const onKeyDown = e => { if (e.key !== 'Escape' || openKey == null) return; const key = openKey; setOpenKey(null); document.getElementById(buttonId(key))?.focus(); };
  const disclose = r => {
    const key = rowKey(r);
    const open = openKey === key;
    const text = detailText(r, detailCol);
    return <button type="button" id={buttonId(key)} className="ui-table__disclose" aria-expanded={open} aria-controls={open ? panelId(key) : undefined} aria-label={`${open ? 'Hide' : 'Show'} details${text ? ` for ${text}` : ''}`} onClick={() => toggle(key)} />;
  };

  if (compact) {
    return (
      <ul className="ui-list" aria-label={label} onKeyDown={hasDetail ? onKeyDown : undefined}>
        {visible.map(g => (
          <React.Fragment key={g.id}>
            <li className="ui-list__group"><GroupHeading group={g} /></li>
            {!g.collapsed && !g.rows.length && g.emptyText && <li className="ui-table__empty">{g.emptyText}</li>}
            {!g.collapsed && g.rows.map(r => (
              <React.Fragment key={rowKey(r)}>
                <li className={hasDetail ? 'ui-list__row ui-list__row--detail' : 'ui-list__row'} data-row data-key={rowKey(r)} style={rowStyle?.(r)} onClick={hasDetail ? onAreaClick(rowKey(r)) : rowClick(r)}>{hasDetail && disclose(r)}{renderCompact(r)}</li>
                {hasDetail && openKey === rowKey(r) && <li id={panelId(rowKey(r))} className="ui-list__detail" data-detail={rowKey(r)}><div className="ui-detail">{renderDetail(r)}</div></li>}
              </React.Fragment>
            ))}
          </React.Fragment>
        ))}
        {!visible.length && emptyText && <li className="ui-table__empty">{emptyText}</li>}
        {watchEnd && <li ref={endRef} aria-hidden="true" data-reach-end />}
      </ul>
    );
  }

  const minWidth = columns.reduce((n, c) => n + (c.width || c.minWidth || 0), 0);
  return (
    <div ref={boxRef} className="ui-table-box" style={{ maxHeight: height || undefined }} onKeyDown={hasDetail ? onKeyDown : undefined}>
      <table className={dense ? 'ui-table ui-table--dense' : 'ui-table'} style={{ minWidth }} aria-label={label}>
        <colgroup>{columns.map(c => <col key={c.id} style={c.width ? { width: c.width } : undefined} />)}</colgroup>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.id} scope="col" className={cellClass(c)} aria-sort={ariaSort(c)}>
                {c.sortValue
                  ? <button type="button" className="ui-table__sort" onClick={() => cycle(c)}>{c.label} <span aria-hidden="true">{glyph(c)}</span></button>
                  : <><span className="ui-table__label" aria-hidden="true">{c.headerGlyph ?? ''}</span><span className="ui-sr-only">{c.label}</span></>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map(g => (
            <React.Fragment key={g.id}>
              <tr className="ui-table__group" data-group={g.id}><td colSpan={columns.length}><GroupHeading group={g} /></td></tr>
              {!g.collapsed && !g.rows.length && g.emptyText && <tr><td colSpan={columns.length} className="ui-table__empty">{g.emptyText}</td></tr>}
              {!g.collapsed && ordered(g.rows).map(r => (
                <React.Fragment key={rowKey(r)}>
                  <tr data-row data-key={rowKey(r)} style={rowStyle?.(r)} onClick={rowClick(r)}>
                    {columns.map(c => (hasDetail && c === detailCol
                      ? <td key={c.id} className={cellClass(c)} title={c.title?.(r) || undefined} onClick={onAreaClick(rowKey(r))}><span className="ui-table__detail-wrap">{disclose(r)}{c.render(r)}</span></td>
                      : <td key={c.id} className={cellClass(c)} title={c.title?.(r) || undefined}>{c.render(r)}</td>))}
                  </tr>
                  {hasDetail && openKey === rowKey(r) && <tr className="ui-table__detail-row" data-detail={rowKey(r)}><td id={panelId(rowKey(r))} colSpan={columns.length}><div className="ui-detail">{renderDetail(r)}</div></td></tr>}
                </React.Fragment>
              ))}
            </React.Fragment>
          ))}
          {!visible.length && emptyText && <tr><td colSpan={columns.length} className="ui-table__empty">{emptyText}</td></tr>}
        </tbody>
      </table>
      {watchEnd && <div ref={endRef} aria-hidden="true" data-reach-end />}
    </div>
  );
}
