import { useState, useRef } from 'react';
import { SA, SA_SHAPE, saSans } from '../theme';
import { laDateString, laWeekStart } from '../periods';
import { goalsApi } from '../goals/goalsApi';
import { labelStyle, inputStyle, Btn, ErrorNote } from '../goals/goalsUi';
import { docxText } from '../../../utils/docxText';
import LinkPicker, { chipStyle } from './LinkPicker';
import { Box, md, linkBtn } from './TaskRow';
import { Section, CompanyRows, PeopleRows, TouchRows, IntelRows, DecisionRows, WaitingRows, TermsRows, MeetingRows } from './IntakeSections';
import { acceptBody, acceptCount } from './intakeBody';
import LeadListPanel from './LeadListPanel';
import Segmented from '../../../ui/Segmented';

// call-notes-to-tasks-v1 - paste or upload call notes, review what the AI
// proposes, create the ones kept. call-notes-targets-v1 REV3 ("Intake"): any
// source, and the review also lists the companies, people, past touches,
// ownership and lasting facts in the notes. Nothing is written until Accept.
// lead-upload-v1: the same panel reads a lead list (LeadListPanel) behind the "Call notes | Lead list" switch.
const MAX_CHARS = 120000; // same cap as the extract route
const SOURCE_TYPES = [['call', 'Call'], ['partner_update', 'Partner update'], ['email_thread', 'Email thread'], ['doc', 'Doc'], ['other', 'Other']];
const NO_INTAKE = { companies: [], ownership: [], people: [], touches: [], facts: [], decisions: [], waiting_on: [], terms: [], next_meeting: [] };
const fieldStyle = { all: 'unset', ...saSans, fontSize: 12, color: SA.soft, cursor: 'pointer' };
const MODES = [{ id: 'notes', label: 'Call notes' }, { id: 'leads', label: 'Lead list' }];

// Zoom transcripts (.vtt): drop the header, cue numbers and timestamps.
const vttText = t => t.replace(/^WEBVTT.*$/m, '').replace(/^\d+\s*$/gm, '').replace(/^[\d:.]+ --> [\d:.]+.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

async function readFile(file, { vtt = true } = {}) {
  if (/\.docx$/i.test(file.name)) return docxText(await file.arrayBuffer());
  if (/\.(txt|md)$/i.test(file.name)) return file.text();
  if (vtt && /\.vtt$/i.test(file.name)) return vttText(await file.text());
  throw new Error(`Upload a .txt, .docx${vtt ? ', .vtt' : ''} or .md file`);
}
const readLeadFile = file => readFile(file, { vtt: false });

const toPick = p => ({ ...p, on: !p.similar_to });

function Proposal({ p, i, members, lookup, links, set }) {
  const label = p.text || `task ${i + 1}`;
  return (
    <li style={{ borderTop: `1px solid ${SA.track}`, padding: '10px 0', display: 'flex', gap: 10, alignItems: 'flex-start', opacity: p.on ? 1 : 0.55 }}>
      <div style={{ paddingTop: 8 }}><Box checked={p.on} label={`Create: ${label}`} onClick={() => set({ on: !p.on })} /></div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Wraps instead of scrolling sideways; one line of text, so Enter isn't a newline. */}
        <textarea value={p.text} onChange={e => set({ text: e.target.value.replace(/\n/g, ' ') })} aria-label={`Task text ${i + 1}`}
          rows={Math.max(1, Math.ceil(p.text.length / 36))}
          style={{ ...inputStyle, height: 'auto', padding: '7px 12px', resize: 'none', lineHeight: 1.4, fontSize: 14, fontWeight: 600, width: '100%' }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={chipStyle}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: lookup(p.owner_user_id || null).color }} />
            <select aria-label={`Owner of ${label}`} value={p.owner_user_id || ''} onChange={e => set({ owner_user_id: e.target.value || null })} style={fieldStyle}>
              <option value="">Unassigned</option>
              {members.map(m => <option key={m.user_id} value={m.user_id}>{lookup(m.user_id).first}</option>)}
            </select>
          </label>
          <label style={chipStyle}>
            <span>Due</span>
            <input type="date" aria-label={`Due date of ${label}`} value={p.due_date || ''} onChange={e => set({ due_date: e.target.value || null })} style={{ ...fieldStyle, colorScheme: 'dark' }} />
          </label>
          <LinkPicker link={p.link_type ? { type: p.link_type, id: p.link_id } : null} links={links} taskText={label}
            onChange={(type, id) => set({ link_type: type, link_id: id })} />
        </div>
        {p.steps.length > 0 && (
          <ul aria-label={`Steps of ${label}`} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {p.steps.map((s, n) => (
              <li key={n} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 13, color: SA.soft }}>
                <span aria-hidden="true">·</span><span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{s}</span>
                <button type="button" aria-label={`Remove step: ${s}`} onClick={() => set({ steps: p.steps.filter((_, k) => k !== n) })}
                  style={{ all: 'unset', cursor: 'pointer', width: 24, textAlign: 'center', color: SA.muted }}>×</button>
              </li>
            ))}
          </ul>
        )}
        {p.similar_to && <span style={{ fontSize: 12, color: SA.warn }}>Already a task from an earlier call: “{p.similar_to.text}” - left unticked</span>}
        {p.company_name && !p.link_type && <span style={{ fontSize: 12, color: SA.muted }}>Mentions {p.company_name}, which isn’t in Goals → Companies</span>}
        {p.evidence && <span style={{ fontSize: 12, color: SA.muted, fontStyle: 'italic', overflowWrap: 'anywhere' }}>“{p.evidence}”</span>}
      </div>
    </li>
  );
}

export default function CallNotesPanel({ businessId, members, lookup, links, onClose, onCreated, onShowCalls, onFiled }) {
  const [mode, setMode] = useState('notes');
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState('call');
  const [sourceLabel, setSourceLabel] = useState('');
  const [intake, setIntake] = useState(NO_INTAKE);
  const [callDate, setCallDate] = useState(laDateString);
  const [text, setText] = useState('');
  const [result, setResult] = useState(null); // { summary, tasks, call_date } | { duplicate }
  const [picks, setPicks] = useState([]);
  const [busy, setBusy] = useState('');
  const [reportState, setReportState] = useState(''); // '' | 'busy' | 'added'
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const chosen = picks.filter(p => p.on && p.text.trim());
  const body = acceptBody(intake);
  const total = chosen.length + acceptCount(body);

  const upload = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const t = await readFile(file);
      if (!t.trim()) throw new Error(`${file.name} has no text in it`);
      setText(t);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
    } catch (err) { setError(err.message); }
  };
  const extract = async () => {
    setBusy('extract'); setError('');
    try {
      const r = await goalsApi.extractCallNotes(businessId, { text, call_date: callDate, title: title.trim() || null, source_type: sourceType, source_label: sourceLabel.trim() || null });
      setResult(r);
      setReportState('');
      setPicks((r.tasks || []).map(toPick));
      setIntake(Object.fromEntries(Object.keys(NO_INTAKE).map(k => [k, r[k] || []])));
      if (r.tasks?.some(t => t.link_type && t.link_type !== 'metric')) links.load();
    } catch (err) { setError(err.message); }
    setBusy('');
  };
  const create = async () => {
    setBusy('create'); setError('');
    try {
      const out = await goalsApi.createFromCallNotes(businessId, {
        text, title: title.trim() || null, call_date: result.call_date, source_type: sourceType, source_label: sourceLabel.trim() || null,
        tasks: chosen.map(p => ({ text: p.text.trim(), owner_user_id: p.owner_user_id, due_date: p.due_date, link_type: p.link_type, link_id: p.link_id, steps: p.steps })),
        ...body, extract: result.extract ?? null, extract_sig: result.extract_sig ?? null,
      });
      onCreated(out.goals.length, out.note, out);
    } catch (err) { setError(err.message); setBusy(''); }
  };
  // Never automatic - the summary only reaches the report when a member clicks.
  const addToReport = async () => {
    setReportState('busy'); setError('');
    const line = `From call · ${md(result.call_date)}${title.trim() ? ` · ${title.trim()}` : ''}: ${result.summary.join(' ')}`;
    try {
      await goalsApi.appendToSection(businessId, laWeekStart(), 's1', line);
      setReportState('added');
    } catch (err) { setError(err.message); setReportState(''); }
  };
  const setPick = i => patch => setPicks(prev => prev.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const setRow = list => i => patch => setIntake(prev => ({ ...prev, [list]: prev[list].map((r, k) => (k === i ? { ...r, ...patch } : r)) }));

  const reviewing = result && !result.duplicate;
  const switcher = <Segmented label="What to read" items={MODES} value={mode} onChange={m => { setMode(m); setResult(null); }} />;
  if (mode === 'leads') {
    return <LeadListPanel businessId={businessId} members={members} text={text} setText={setText} onClose={onClose} onFiled={onFiled} switcher={switcher} readFile={readLeadFile} />;
  }
  return (
    <section aria-label="Intake" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {!reviewing && switcher}
          <span style={{ ...labelStyle, color: SA.soft, flex: 1 }}>{reviewing ? 'Review · nothing is saved until Accept' : 'Intake · paste any notes'}</span>
          <button type="button" style={linkBtn} onClick={onClose}>Cancel</button>
        </div>
        {!reviewing && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={sourceType} onChange={e => setSourceType(e.target.value)} aria-label="What these notes are" disabled={!!busy}
                style={{ ...inputStyle, flex: '0 0 auto', width: 'auto' }}>
                {SOURCE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input value={sourceLabel} onChange={e => setSourceLabel(e.target.value)} aria-label="Source label" placeholder="Source, e.g. Brad weekly 10/13 (optional)" disabled={!!busy}
                style={{ ...inputStyle, flex: '1 1 160px', minWidth: 0 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={title} onChange={e => setTitle(e.target.value)} aria-label="Call title" placeholder="Title (optional)" disabled={!!busy}
                style={{ ...inputStyle, flex: '1 1 160px', minWidth: 0 }} />
              <input type="date" value={callDate} onChange={e => setCallDate(e.target.value || laDateString())} aria-label="Call date" disabled={!!busy}
                style={{ ...inputStyle, flex: '0 0 auto', colorScheme: 'dark' }} />
            </div>
            <textarea value={text} onChange={e => { setText(e.target.value); setResult(null); }} aria-label="Call notes" disabled={!!busy}
              placeholder="Paste a Zoom AI summary, a transcript, a partner's update, an email thread, or your own notes" rows={12}
              style={{ ...inputStyle, height: 'auto', minHeight: 220, padding: '10px 12px', resize: 'vertical', lineHeight: 1.5, fontSize: 13 }} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: SA.muted }}>
              <input ref={fileRef} type="file" accept=".txt,.md,.vtt,.docx" onChange={upload} hidden aria-label="Upload call notes file" />
              <button type="button" style={{ ...linkBtn, fontSize: 13 }} disabled={!!busy} onClick={() => fileRef.current.click()}>Upload .txt / .docx / .vtt / .md</button>
              <span style={{ marginLeft: 'auto', color: text.length > MAX_CHARS ? SA.bad : SA.muted, fontVariantNumeric: 'tabular-nums' }}>
                {text.length.toLocaleString('en-US')} / {MAX_CHARS.toLocaleString('en-US')}
              </span>
            </div>
            {result?.duplicate && (
              <div role="status" style={{ padding: '10px 12px', borderRadius: SA_SHAPE.radiusInner, border: `1px solid ${SA.warn}`, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>These notes were already pasted{result.duplicate.title ? ` as “${result.duplicate.title}”` : ''} for the call on {md(result.duplicate.call_date)} - {result.duplicate.task_count} task{result.duplicate.task_count === 1 ? '' : 's'} came from them. Nothing new to create.</span>
                <button type="button" style={linkBtn} onClick={onShowCalls}>Show tasks from calls</button>
              </div>
            )}
          </>
        )}
        {reviewing && (
          <>
            {(result.recent_accepts || []).map(r => (
              <span key={`${r.partner_id}:${r.note_id}`} role="note" style={{ fontSize: 13, color: SA.warn }}>
                ⚠ Another note on {r.partner} was accepted {r.minutes_ago} min ago ({r.todos} to-do{r.todos === 1 ? '' : 's'}, {r.events} event{r.events === 1 ? '' : 's'})
              </span>
            ))}
            {result.summary.length > 0 && (
              <div style={{ padding: '10px 12px', borderRadius: SA_SHAPE.radiusInner, background: SA.surface, border: `1px solid ${SA.border}` }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{ ...labelStyle, fontSize: 11, flex: 1 }}>Call summary{title.trim() ? ` · ${title.trim()}` : ''} · {md(result.call_date)}</span>
                  {reportState === 'added'
                    ? <span role="status" style={{ fontSize: 12, color: SA.good }}>Added to this week’s report §1 as a draft line</span>
                    : <button type="button" style={{ ...linkBtn, fontSize: 12 }} disabled={reportState === 'busy' || !!busy} onClick={addToReport}>
                        {reportState === 'busy' ? 'Adding…' : 'Add to report §1'}
                      </button>}
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: SA.soft, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {result.summary.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            <Section title="Companies mentioned" count={intake.companies.length}>
              <CompanyRows rows={intake.companies} categories={result.categories || []} set={setRow('companies')} />
            </Section>
            <Section title="People" count={intake.people.length}>
              <PeopleRows rows={intake.people} companies={intake.companies} set={setRow('people')} />
            </Section>
            <Section title="Touches" count={intake.touches.length}>
              <TouchRows rows={intake.touches} set={setRow('touches')} />
            </Section>
            <Section title="Decisions" count={intake.decisions.length}>
              <DecisionRows rows={intake.decisions} set={setRow('decisions')} />
            </Section>
            <Section title="Waiting on them" count={intake.waiting_on.length}>
              <WaitingRows rows={intake.waiting_on} set={setRow('waiting_on')} />
            </Section>
            <Section title="Terms" count={intake.terms.length}>
              <TermsRows rows={intake.terms} set={setRow('terms')} />
            </Section>
            <Section title="Next meeting" count={intake.next_meeting.length}>
              <MeetingRows rows={intake.next_meeting} set={setRow('next_meeting')} />
            </Section>
            {picks.length ? (
              <Section title="Tasks" count={picks.length}>
                {picks.map((p, i) => <Proposal key={i} p={p} i={i} members={members} lookup={lookup} links={links} set={setPick(i)} />)}
              </Section>
            ) : <p style={{ fontSize: 14, color: SA.muted, margin: 0 }}>No action items found in these notes.</p>}
            <Section title="Ownership & intel" count={intake.ownership.length + intake.facts.length}>
              <IntelRows ownership={intake.ownership} facts={intake.facts} companies={intake.companies} setOwnership={setRow('ownership')} setFact={setRow('facts')} />
            </Section>
            {result.rejected?.length > 0 && <span style={{ fontSize: 12, color: SA.muted }}>Not proposed again (you said never): {result.rejected.join(', ')}</span>}
          </>
        )}
        {error && <ErrorNote message={error} />}
      </div>
      <footer style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 16px', borderTop: `1px solid ${SA.border}` }}>
        {reviewing ? (
          <>
            <button type="button" style={linkBtn} disabled={!!busy} onClick={() => setResult(null)}>← Back to notes</button>
            <Btn primary style={{ marginLeft: 'auto' }} disabled={!total || !!busy} onClick={create}>
              {busy ? 'Saving…' : `Accept ${total}`}
            </Btn>
          </>
        ) : (
          <>
            {busy && <span role="status" style={{ fontSize: 13, color: SA.muted }}>Reading the notes - about 20 seconds…</span>}
            <Btn primary style={{ marginLeft: 'auto' }} disabled={!text.trim() || text.length > MAX_CHARS || !!busy || !!result?.duplicate} onClick={extract}>
              Read notes
            </Btn>
          </>
        )}
      </footer>
    </section>
  );
}
