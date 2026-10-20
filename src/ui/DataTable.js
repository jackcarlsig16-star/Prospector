import React, { useState, useEffect, useRef, useMemo } from 'react';
import './kitTheme';
import { KIT_TABLE } from './tokens';

// pipeline-wide-table-v1 - a real <table> with a sticky header, a sticky first
// column, per-group sorting and collapsible groups. Hand-built on the kit, no
// grid library.
//   columns: [{ id, label, width?, minWidth?, sticky?, sortValue?(row), render(row), title?(row) }]
//   groups:  [{ id, header, icon?, rows, collapsed?, onToggle? }]
//   rowStyle(row) -> style for the <tr>; `--ui-row-tint` and `--ui-row-bar`
//   custom properties paint the tint and the 3px bar (the sticky cell keeps a
//   solid surface under the tint so it covers scrolled columns).
//   compact + renderCompact(row): the phone list, same groups and keys.
// A header click cycles asc -> desc -> off; off = the rows as given. Pass
// sort ({ id, dir } | null) + onSort to own the sort (e.g. to remember it).

const compare = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));

// Blanks stay last in both directions; ties keep the given order.
export function sortRows(rows, column, dir) {
  if (!column || !dir) return rows;
  const sign = dir === 'asc' ? 1 : -1;
  return rows.map((r, i) => [r, i, column.sortValue(r)]).sort(([, i, a], [, j, b]) => ((a == null) - (b == null)) || (a == null ? 0 : sign * compare(a, b)) || i - j).map(([r]) => r);
}

function GroupHeading({ group }) {
  const h = <h3>{group.header}</h3>;
  return group.onToggle
    ? <button type="button" className="ui-table__toggle" aria-expanded={!group.collapsed} onClick={group.onToggle}>{group.icon}{h}</button>
    : <span className="ui-table__gh">{group.icon}{h}</span>;
}

export default function DataTable({ columns, groups, rowStyle, rowKey, compact = false, renderCompact, emptyText, label, sort: sortProp, onSort }) {
  const [sortState, setSortState] = useState(null);
  const sort = onSort ? sortProp : sortState;
  const setSort = onSort ? f => onSort(f(sortProp)) : setSortState;
  const boxRef = useRef(null);
  const [height, setHeight] = useState(null);
  const sortCol = useMemo(() => columns.find(c => c.id === sort?.id) || null, [columns, sort]);

  useEffect(() => {
    if (compact) return undefined;
    const fit = () => {
      const el = boxRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(KIT_TABLE.minHeight, window.innerHeight - top - KIT_TABLE.bottomGap));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [compact]);

  const cycle = col => setSort(s => (s?.id !== col.id ? { id: col.id, dir: 'asc' } : s.dir === 'asc' ? { id: col.id, dir: 'desc' } : null));
  const ariaSort = col => (!col.sortValue ? undefined : sort?.id !== col.id ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending');
  const glyph = col => (sort?.id !== col.id ? '↕' : sort.dir === 'asc' ? '▲' : '▼');
  const visible = groups.filter(g => g.rows.length || g.emptyText);

  if (compact) {
    return (
      <ul className="ui-list" aria-label={label}>
        {visible.map(g => (
          <React.Fragment key={g.id}>
            <li className="ui-list__group"><GroupHeading group={g} /></li>
            {!g.collapsed && !g.rows.length && g.emptyText && <li className="ui-table__empty">{g.emptyText}</li>}
            {!g.collapsed && g.rows.map(r => <li key={rowKey(r)} className="ui-list__row" data-row data-key={rowKey(r)} style={rowStyle?.(r)}>{renderCompact(r)}</li>)}
          </React.Fragment>
        ))}
        {!visible.length && emptyText && <li className="ui-table__empty">{emptyText}</li>}
      </ul>
    );
  }

  const minWidth = columns.reduce((n, c) => n + (c.width || c.minWidth || 0), 0);
  return (
    <div ref={boxRef} className="ui-table-box" style={{ maxHeight: height || undefined }}>
      <table className="ui-table" style={{ minWidth }} aria-label={label}>
        <colgroup>{columns.map(c => <col key={c.id} style={c.width ? { width: c.width } : undefined} />)}</colgroup>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.id} scope="col" className={c.sticky ? 'ui-table__sticky' : undefined} aria-sort={ariaSort(c)} aria-label={c.sortValue ? undefined : c.label}>
                {c.sortValue
                  ? <button type="button" className="ui-table__sort" onClick={() => cycle(c)}>{c.label} <span aria-hidden="true">{glyph(c)}</span></button>
                  : <span className="ui-table__label" aria-hidden="true">{c.headerGlyph ?? ''}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map(g => (
            <React.Fragment key={g.id}>
              <tr className="ui-table__group" data-group={g.id}><td colSpan={columns.length}><GroupHeading group={g} /></td></tr>
              {!g.collapsed && !g.rows.length && g.emptyText && <tr><td colSpan={columns.length} className="ui-table__empty">{g.emptyText}</td></tr>}
              {!g.collapsed && sortRows(g.rows, sortCol, sort?.dir).map(r => (
                <tr key={rowKey(r)} data-row data-key={rowKey(r)} style={rowStyle?.(r)}>
                  {columns.map(c => <td key={c.id} className={c.sticky ? 'ui-table__sticky' : undefined} title={c.title?.(r) || undefined}>{c.render(r)}</td>)}
                </tr>
              ))}
            </React.Fragment>
          ))}
          {!visible.length && emptyText && <tr><td colSpan={columns.length} className="ui-table__empty">{emptyText}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
