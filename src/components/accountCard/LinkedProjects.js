import { useState } from 'react';
import { C, mono } from '../../constants/colors';
import { linkAccountToLists } from '../../utils/db';

// project-guidance-and-creation-flow-v1 — account -> project, reverse entry
// point of the project's "Add accounts" action. Same underlying write
// (linkAccountToLists against a project's list_id), just initiated from the
// account side. Only rendered business-scoped (business != null) - projects
// are a business concept, not meaningful on the unscoped territory page.
export default function LinkedProjects({ accountId, accountListIds = [], projects = [], onLinked }) {
  const [picking, setPicking] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');

  const linked = projects.filter(p => p.list_id && accountListIds.includes(p.list_id));
  const linkable = projects.filter(p => p.list_id && !accountListIds.includes(p.list_id));

  const addTo = async (project) => {
    setLinking(true);
    setError('');
    const { error: err } = await linkAccountToLists(accountId, [project.list_id]);
    setLinking(false);
    if (err) { setError(err); return; }
    setPicking(false);
    onLinked?.(project.list_id);
  };

  if (!projects.length) return null;

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ ...mono, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Projects</span>
        {linked.map(p => (
          <span key={p.id} style={{ ...mono, fontSize: 10, padding: '2px 8px', borderRadius: 10, background: `${p.color || C.gold}18`, border: `1px solid ${p.color || C.gold}55`, color: p.color || C.gold }}>{p.name}</span>
        ))}
        {!linked.length && <span style={{ ...mono, fontSize: 10, color: C.dim, fontStyle: 'italic' }}>none</span>}
        {linkable.length > 0 && (
          <button onClick={() => setPicking(o => !o)} style={{ ...mono, fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'transparent', border: `1px dashed ${C.brd}`, color: C.dim, cursor: 'pointer' }}>
            + Add to project
          </button>
        )}
      </div>
      {error && <div style={{ ...mono, fontSize: 10, color: C.red, marginTop: 4 }}>⚠ {error}</div>}
      {picking && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, padding: 8, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 6 }}>
          {linkable.map(p => (
            <button key={p.id} onClick={() => addTo(p)} disabled={linking} style={{ ...mono, fontSize: 11, padding: '5px 8px', background: 'transparent', border: 'none', color: C.txt, textAlign: 'left', cursor: 'pointer', borderRadius: 4 }}>
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
