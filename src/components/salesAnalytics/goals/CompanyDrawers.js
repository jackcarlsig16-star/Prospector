import { useState, useEffect } from 'react';
import Drawer from '../../../ui/Drawer';
import { SignalsCard, TodosCard, WaitingCard, NotesCard, PeopleCard, notesRows, notesText } from './CompanyPanelSections';
import { ClientCard, FilesCard } from './ClientParts';
import { md, TIMELINE_KIND } from './companyPanelFacts';
import { readDrawers, writeDrawer } from '../../../utils/companyDrawers';

// company-window-v4 B3 - everything below Fit and Intel, tucked: one 40 px row per section (kit Drawer, dense) in this
// order - Signals & visits · People · Open to-dos · Waiting on them · Notes & touches · Client · Files - each with its
// count pill (warn when a signal count > 0, neutral otherwise, "—" for Client), a one-line preview of the latest item
// and the section's action link at the right (+ Contact, + Add, + Note, Make client / Edit, + Upload, Open in
// People →). A click expands the section's own card inline (the card in bare mode: the row already carries its label,
// count and action). Open state per viewer per company (D2, src/utils/companyDrawers.js); Signals & visits opens itself
// while the Interest band is live (no stored state overrides that). Viewers get rows without action links. Client and
// Files are an employer's; People shows for a record or when people are on file.
const RECORD = ['partner', 'employer', 'target'];
const when = at => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const titleCase = s => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const RowLink = ({ onClick, children }) => <button type="button" className="ui-link" style={{ fontSize: 12 }} onClick={onClick}>{children}</button>;

// -> [{ id, label, count, tone, preview, action: [label, fn] | null }] (pure).
export function drawerRows(row, detail, { files = null, flow = [], lookup = () => null, canEdit = false, onForm = () => {}, onOpenPeople = null, onMakeClient = () => {}, onUpload = () => {} } = {}) {
  const isRecord = RECORD.includes(row.type);
  const t = detail.timeline[0];
  const word = t ? (TIMELINE_KIND[t.kind] || ['Signal'])[0] : null;
  const people = detail.people;
  const todo = detail.todos[0], wait = detail.waiting[0];
  const notes = notesRows(detail, flow);
  const c = detail.record?.client || {};
  return [
    // The kind word leads unless the text already starts with it ("Visited · 1 in 7 days", not "Visited · Visited · …").
    { id: 'signals', label: 'Signals & visits', count: detail.timeline.length, tone: detail.timeline.length > 0 ? 'warn' : null, preview: t ? `${String(t.text).toLowerCase().startsWith(word.toLowerCase()) ? t.text : `${word} · ${t.text}`} · ${md(t.at)}` : 'No signals yet',
      action: canEdit && onOpenPeople && (row.type === 'partner' || row.type === 'employer') ? ['Open in People →', () => onOpenPeople({ type: row.type, id: row.id, name: row.name })] : null },
    (isRecord || people.length > 0) && { id: 'people', label: 'People', count: people.length, tone: null, preview: people.length ? [...people.slice(0, 2).map(p => p.name), people.length > 2 ? `+${people.length - 2}` : null].filter(Boolean).join(' · ') : 'Nobody on file',
      action: canEdit && isRecord ? ['+ Contact', () => onForm('contact')] : null },
    { id: 'todos', label: 'Open to-dos', count: detail.todos.length, tone: null, preview: todo ? `${todo.text}${todo.due_date ? ` · due ${md(todo.due_date)}` : ''}` : 'None open', action: canEdit ? ['+ Add', () => onForm('todo')] : null },
    { id: 'waiting', label: 'Waiting on them', count: detail.waiting.length, tone: null, preview: wait ? `${wait.waiting_on ? `${wait.waiting_on} · ` : ''}${wait.text}` : 'Nothing owed', action: null },
    { id: 'notes', label: 'Notes & touches', count: notes.length, tone: null, preview: notes.length ? notes.slice(0, 2).map(e => `${when(e.at)} · ${notesText(e, lookup)}`).join(' · ') : 'Nothing yet', action: canEdit ? ['+ Note', () => onForm('note')] : null },
    row.type === 'employer' && { id: 'client', label: 'Client', count: '—', tone: null, preview: c.client_status ? `${titleCase(c.client_status)}${c.client_since ? ` · since ${md(c.client_since)}` : ''}` : 'Not a client yet', action: canEdit ? [c.client_status ? 'Edit' : 'Make client', onMakeClient] : null },
    row.type === 'employer' && { id: 'files', label: 'Files', count: files ? files.length : '…', tone: null, preview: files?.length ? `${files[0].title} · ${md(files[0].uploaded_at)}` : 'No agreements or financials yet · PDF, DOCX, XLSX up to 20 MB', action: canEdit ? ['+ Upload', onUpload] : null },
  ].filter(Boolean);
}

export default function CompanyDrawers({ businessId, row, detail, canEdit, lookup, flow = [], files = null, version = 0, onForm, onChanged, onToast, onOpenPeople, onMakeClient, initialSection = null }) {
  const key = `${row.type}-${row.id}`;
  const live = !!detail.interest?.show;
  const initial = () => ({ ...readDrawers(key), ...(live ? { signals: true } : {}), ...(initialSection === 'people' ? { people: true } : {}) });
  const [open, setOpen] = useState(initial);
  useEffect(() => { setOpen(initial); }, [key, live]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (initialSection !== 'people') return;
    const el = document.querySelector('[data-company-drawers] [data-drawer="people"]');
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'start' });
  }, [initialSection]);
  const toggle = (id, next) => { setOpen(o => ({ ...o, [id]: next })); writeDrawer(key, id, next); };
  const cardProps = { businessId, row, detail, canEdit, onForm, onChanged, onToast, bare: true };
  const rows = drawerRows(row, detail, { files, flow, lookup, canEdit, onForm, onOpenPeople, onMakeClient, onUpload: () => toggle('files', true) });
  const body = id => {
    if (id === 'signals') return <SignalsCard {...cardProps} onOpenPeople={onOpenPeople} />;
    if (id === 'people') return <PeopleCard {...cardProps} />;
    if (id === 'todos') return <TodosCard {...cardProps} />;
    if (id === 'waiting') return <WaitingCard {...cardProps} />;
    if (id === 'notes') return <NotesCard {...cardProps} lookup={lookup} flow={flow} />;
    if (id === 'client') return <ClientCard {...cardProps} onMake={onMakeClient} />;
    return <FilesCard businessId={businessId} row={row} canEdit={canEdit} version={version} onToast={onToast} bare />;
  };
  return (
    <div data-company-drawers style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <span className="ui-group-label" style={{ padding: '0 2px 6px' }}>Everything else · tucked</span>
      {rows.map(r => (
        <Drawer key={r.id} dense testId={r.id} label={r.label} count={r.count} countTone={r.tone} summary={r.preview} open={!!open[r.id]} onOpenChange={next => toggle(r.id, next)}
          action={r.action ? <RowLink onClick={r.action[1]}>{r.action[0]}</RowLink> : null}>
          {body(r.id)}
        </Drawer>
      ))}
    </div>
  );
}
