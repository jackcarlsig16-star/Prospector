import { EntityIcon, Marked, WorkspaceTag, StarGlyph } from './ScoutParts';
import { destination } from './scoutModel';

// scout-v2 REV3 B3 - grouped hits in the registry's order (the server's group order; empty groups never arrive), the
// matched words in neon, the keyboard row with a neon bar + wash, a workspace tag per row when the scope is all, and the
// footer whose right side asks the typed line as a question. The input owns focus (a combobox); rows are options.
export const optionId = (listId, i) => `${listId}-o${i}`;

export default function ScoutResults({ listId, groups, q, active, onActive, onOpen, onAsk, scopeAll, colorOf, phone = false }) {
  let i = -1;
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const short = q.length > 24 ? `${q.slice(0, 24)}…` : `${q}…`;
  return (
    <div id={listId} role="listbox" aria-label="Scout results" className="scout-results">
      {groups.map(g => (
        <div key={g.entity} role="group" aria-label={`${g.label}, ${g.items.length}`} data-scout-group={g.entity}>
          <div className="scout-gh" aria-hidden="true"><span className="scout-lbl"><EntityIcon entity={g.entity} />{g.label}</span><span className="scout-count">{g.items.length}</span></div>
          {g.items.map(item => {
            i += 1;
            const idx = i;
            return (
              <div key={`${item.workspace_id}:${item.id}`} id={optionId(listId, idx)} role="option" aria-selected={active === idx}
                className={active === idx ? 'scout-row is-active' : 'scout-row'} data-scout-row={g.entity}
                onMouseEnter={() => onActive(idx)} onMouseDown={e => e.preventDefault()} onClick={() => onOpen(item)}>
                <span className="scout-t"><b><Marked text={item.title} q={q} /></b>{item.subtitle && <span><Marked text={item.subtitle} q={q} /></span>}</span>
                {scopeAll ? <WorkspaceTag name={item.workspace_name} color={colorOf(item.workspace_id)} /> : <span />}
                <span className="scout-dest">{phone ? '→' : destination(item)}</span>
              </div>
            );
          })}
        </div>
      ))}
      <div className="scout-foot">
        {!phone && <><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span></>}
        <span id={optionId(listId, total)} role="option" aria-selected={active === total} className={active === total ? 'scout-ask-row is-active' : 'scout-ask-row'} data-scout-ask
          onMouseEnter={() => onActive(total)} onMouseDown={e => e.preventDefault()} onClick={onAsk}>
          <StarGlyph />Ask “{short}” as a question{!phone && <> <kbd>↵</kbd> on free text</>}
        </span>
      </div>
    </div>
  );
}
