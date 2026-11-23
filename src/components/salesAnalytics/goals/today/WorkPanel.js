import { useEffect, useRef, useState } from 'react';
import HeatPill from '../../people/HeatPill';
import { draftCost } from '../../../scout/scoutActions';
import { VERB_LABEL, PANE_TITLE, TAB_LABEL, firstName, readLine } from './todayRows';
import { Icon, SPARK } from './TodayParts';

// actions-v2 Stage 3 - Scout's work panel for ONE row (specs/design/actions-v2/ActionsTodayDo · ...DoPhone). It opens
// when the row's verb is clicked and nothing is generated before that. Three panes: the suggested next steps (each
// with the stored fact it is based on), the verb's own pane (a draft, a call brief, or the stored people not yet on a
// to-do; Next steps has none) and the prompt to take to Claude. Nothing here sends or writes: every button calls back.
//   work: { key, verb, state: 'working' | 'ready' | 'failed', data, error }
const Gen = ({ children }) => <span className="td-gen td-genl"><Icon d={SPARK} size={12} />{children}</span>;
const Bars = () => <><div className="td-sk td-sk--gen" style={{ width: '70%' }} /><div className="td-sk" style={{ width: '90%' }} /><div className="td-sk" style={{ width: '55%' }} /></>;

function Steps({ work, row, canEdit, onUseDraft, onAddTodo }) {
  const d = work.data, steps = d?.steps || [];
  const hasDraft = !!d?.draft && !d.draft.withheld;
  return (
    <section className="td-pane" aria-label="Next steps" data-work-pane="steps">
      <Gen>{work.state === 'working' ? `Reading ${row.company?.name || 'the to-do'}…` : 'Next steps · suggested'}</Gen>
      {work.state === 'working' ? <Bars /> : <>
        {steps.map((s, i) => (
          <div key={s.text} className="td-st" data-work-step={s.source}>
            <span className="n td-num">{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}><b>{s.text}</b><div className="td-note">{s.based_on}</div></div>
            {i === 0 && hasDraft ? <button type="button" className="td-btn" onClick={onUseDraft}>Use draft</button>
              : canEdit ? <button type="button" className="td-btn" onClick={() => onAddTodo(s.text)} aria-label={`Add to-do: ${s.text}`}>Add to-do</button> : null}
          </div>
        ))}
        {!steps.length && <p className="td-note" style={{ margin: 0 }} data-work-nosteps>{work.state === 'failed' ? 'No steps: the call did not finish.' : d?.note || 'Nothing to suggest beyond the draft.'}</p>}
        <p className="td-note" style={{ margin: 0 }}>Each line says what it is based on. A step with nothing behind it is not shown.</p>
      </>}
    </section>
  );
}

function Failed({ work, onRetry }) {
  return <div role="alert" data-work-failed style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}><span className="td-bad" style={{ fontSize: 13 }}>{work.error || 'That did not work.'}</span>{work.data?.failed?.status !== 429 && <button type="button" className="td-btn" onClick={() => onRetry()}>Try again</button>}</div>;
}

function Middle({ work, row, canEdit, phone, bodyRef, copied, onRetry, onCopy, onCompose, onDraftFor, onAddPerson }) {
  const d = work.data, verb = work.verb;
  const head = <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><Gen>{phone && work.state === 'working' ? `Reading ${row.company?.name || 'the to-do'}…` : PANE_TITLE[verb]}</Gen><span className="td-note">{phone ? 'Nothing is sent' : 'Nothing is sent from Prospector'}</span></div>;
  const big = phone ? ' td-big' : '';
  let body;
  if (work.state === 'working') body = <Bars />;
  else if (work.state === 'failed') body = <Failed work={work} onRetry={onRetry} />;
  else if (verb === 'find_people') {
    body = d.people.length ? (
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {d.people.map(p => (
          <li key={p.key} className="td-st" data-work-person={p.key}>
            <div style={{ flex: 1, minWidth: 0 }}><b>{p.name}</b>{p.heat_band && <span style={{ marginLeft: 7, verticalAlign: 'middle', display: 'inline-flex' }}><HeatPill heat={p.heat} band={p.heat_band} size="sm" /></span>}<div className="td-note">{p.title || 'no title stored'}{p.buyer ? ' · a buyer title' : ''}</div></div>
            {canEdit && <button type="button" className="td-btn" onClick={() => onAddPerson(p)} aria-label={`Add a to-do for ${p.name}`}>Add</button>}
            <button type="button" className="td-btn" onClick={() => onDraftFor(p)} aria-label={`Draft an email to ${p.name}`}>Draft</button>
          </li>
        ))}
      </ul>
    ) : <p className="td-note" style={{ margin: 0 }} data-work-nopeople>Everyone stored at {row.company?.name || 'this company'} is already on a to-do, or nobody is stored yet. No search is run from here.</p>;
  } else if (verb === 'prep_call') {
    body = d.brief?.withheld ? <Withheld reason={d.brief.reason} onRetry={onRetry} />
      : <><p className="td-draft" style={{ margin: 0, whiteSpace: 'pre-wrap' }} data-work-brief>{d.brief?.text}</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><button type="button" className={`td-btn td-btn--pri${big}`} onClick={() => onCopy(d.brief.text, 'Brief')}>{copied ? '✓ Copied' : 'Copy'}</button><button type="button" className="td-btn td-btn--ghost" onClick={() => onRetry()}>Try again</button></div></>;
  } else {
    body = d.draft.withheld ? <Withheld reason={d.draft.reason} onRetry={onRetry} /> : <Draft key={`${d.draft.subject}\n${d.draft.body}`} draft={d.draft} phone={phone} bodyRef={bodyRef} copied={copied} onRetry={onRetry} onCopy={onCopy} onCompose={onCompose} />;
  }
  return <section className="td-pane" aria-label={PANE_TITLE[verb]} data-work-pane="middle">{head}{body}</section>;
}
// The draft as written, editable in place: the edits are what Copy and Open in Write email carry. A new draft is a new box.
function Draft({ draft: t, phone, bodyRef, copied, onRetry, onCopy, onCompose }) {
  const [text, setText] = useState(t.body);
  const to = t.to || {}, big = phone ? ' td-big' : '';
  const tone = id => <button type="button" className={phone ? 'td-chip' : 'td-btn td-btn--ghost'} onClick={() => onRetry({ tone: id })} data-work-tone={id}>{id === 'shorter' ? 'Shorter' : 'Warmer'}</button>;
  const again = <button type="button" className={phone ? 'td-chip' : 'td-btn td-btn--ghost'} onClick={() => onRetry()} data-work-again>Try again</button>;
  return (
    <>
      <div className="td-kv"><span className="td-note">To</span><span data-work-to>{[to.name, to.title].filter(Boolean).join(' · ')}{to.name ? ', ' : ''}{to.company}</span><span className="td-note">Subject</span><span style={{ color: 'var(--sa-text)' }} data-work-subject>{t.subject}</span></div>
      <textarea ref={bodyRef} className="td-draft" aria-label="Draft body" value={text} onChange={e => setText(e.target.value)} rows={phone ? 12 : 13} style={phone ? { fontSize: 15 } : undefined} data-work-body />
      {t.lint && !t.lint.ok && <span className="td-note" data-work-lint>{t.lint.issues} rule {t.lint.issues === 1 ? 'issue' : 'issues'} - Open in Write email shows {t.lint.issues === 1 ? 'it' : 'them'}.</span>}
      {phone && <div style={{ display: 'flex', gap: 6 }}>{tone('shorter')}{tone('warmer')}{again}</div>}
      <div style={{ display: 'flex', gap: phone ? 8 : 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className={`td-btn td-btn--pri${big}`} onClick={() => onCopy(`Subject: ${t.subject}\n\n${text}\n`, 'Draft')} data-work-copy>{copied ? '✓ Copied' : 'Copy'}</button>
        <button type="button" className={`td-btn${big}`} onClick={() => onCompose({ subject: t.subject, body: text })} data-work-compose>Open in Write email</button>
        {!phone && <><span className="td-sep" aria-hidden="true" />{tone('shorter')}{tone('warmer')}{again}</>}
      </div>
    </>
  );
}
const Withheld = ({ reason, onRetry }) => <div data-work-withheld style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}><span className="td-note" style={{ color: 'var(--sa-text)' }}>{reason}</span><button type="button" className="td-btn" onClick={() => onRetry()}>Try again</button></div>;

function Claude({ work, row, phone, onCopy, onFull }) {
  const pack = work.data?.prompt_pack;
  const [ask, setAsk] = useState(0);
  const [copied, setCopied] = useState(false);
  const [typed, setTyped] = useState('');
  const [full, setFull] = useState(null); // null | 'busy' | the uncut dossier (ends with "## Ask")
  const picked = pack?.asks?.[ask];
  // P5: the objection chip's blank is what was typed; P2: Full swaps the record for the uncut dossier, same ask
  const filled = picked?.text && picked.blank ? picked.text.replace(picked.blank, typed.trim() || picked.blank) : picked?.text;
  const text = filled && typeof full === 'string' ? `${full}${filled.split('## Ask\n').pop()}` : filled;
  const a = picked && !picked.blocked ? { ...picked, text, chars: text === picked.text ? picked.chars : text.length } : picked;
  useEffect(() => setCopied(false), [ask, work.data, typed, full]);
  useEffect(() => setFull(null), [work.data]);
  const toggleFull = async () => { if (full) { setFull(null); return; } setFull('busy'); setFull(await onFull().catch(() => null)); };
  return (
    <section className="td-pane" aria-label="Take it to Claude" data-work-pane="claude">
      <span className="td-lbl">Take it to Claude</span>
      {work.state === 'working' && !pack ? <Bars />
        : !pack ? <p className="td-note" style={{ margin: 0 }} data-work-nopack>Nothing is stored to pack for this row - link it to a company or a person first.</p>
          : pack.blocked ? <p className="td-note" style={{ margin: 0, color: 'var(--sa-text)' }} data-work-pack-blocked>{pack.reason}</p> : <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="What to ask Claude">{pack.asks.map((x, i) => <button key={x.id} type="button" className="td-chip" aria-pressed={i === ask} onClick={() => setAsk(i)}>{x.label}</button>)}</div>
            {a.blocked ? <p className="td-note" style={{ margin: 0, color: 'var(--sa-text)' }} data-work-pack-blocked>Not copied: the pack still held an address or phone shape.</p> : <>
              {a.blank && <input className="td-in" value={typed} onChange={e => setTyped(e.target.value)} maxLength={300} placeholder="Type the objection, in their words" aria-label="The objection" data-work-objection />}
              <pre className="td-mono" tabIndex={0} aria-label="The prompt" data-work-prompt>{a.text}</pre>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className={`td-btn${phone ? ' td-big' : ''}`} onClick={async () => { if (await onCopy(a.text, 'Prompt')) setCopied(true); }} data-work-copy-prompt>{copied ? '✓ Copied' : 'Copy prompt'}</button>
                {onFull && row.company?.id && (pack.cut > 0 || full) && <button type="button" className="td-chip" aria-pressed={typeof full === 'string'} disabled={full === 'busy'} onClick={toggleFull} data-work-full title="Lift the 12,000-character cap to 40,000">Full</button>}
                <span className="td-note"><span className="td-num" data-work-chars>{a.chars.toLocaleString('en-US')}</span> chars{pack.cut > 0 && typeof full !== 'string' ? ` · ${pack.cut} cut to fit` : ''} · names, titles and LinkedIn links only</span>
              </div>
            </>}
          </>}
      <span className="td-lbl" style={{ marginTop: 4 }}>What Scout read</span>
      <span className="td-note" style={{ color: 'var(--sa-muted)' }} data-work-read>{work.data ? readLine(work.data, row) : 'The to-do'}</span>
    </section>
  );
}

// onRetry({ tone?, person? }) re-calls · onCopy(text, what) -> true when copied · onCompose({ subject, body }) opens the
// Write email panel with THAT draft · onDone / onFinish: the to-do done / done + its person marked contacted (Scout's
// verbs, one Undo) · onAddTodo(text) / onAddPerson(person): Scout's Add task card · notice: the confirm card, when one is up.
export default function WorkPanel({ work, row, canEdit, phone = false, notice = null, onClose, onRetry, onCopy, onFull, onCompose, onDone, onFinish, onAddReply, onAddTodo, onAddPerson, onDraftFor }) {
  const draft = work.data?.draft;
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState('middle');
  const bodyRef = useRef(null), boxRef = useRef(null);
  useEffect(() => { setCopied(false); }, [draft]);
  useEffect(() => { setTab(work.verb === 'next_steps' ? 'steps' : 'middle'); }, [work.key, work.verb]);
  useEffect(() => { boxRef.current?.focus(); }, [work.key]);
  const copy = async (t, what) => { const ok = await onCopy(t, what); if (ok && what !== 'Prompt') setCopied(true); return ok; };
  const esc = e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); onClose(); } };
  const hasMiddle = work.verb !== 'next_steps';
  const who = work.data?.row?.person || row.person;
  const cost = work.data?.usage?.calls ? draftCost({ cost: { usd: work.data.usage.cost_usd }, cap: work.data.usage.cap }) : null;
  const steps = <Steps work={work} row={row} canEdit={canEdit} onUseDraft={() => { setTab('middle'); setTimeout(() => bodyRef.current?.focus(), 0); }} onAddTodo={onAddTodo} />;
  const middle = hasMiddle && <Middle work={work} row={row} canEdit={canEdit} phone={phone} bodyRef={bodyRef} copied={copied} onRetry={onRetry} onCopy={copy} onCompose={onCompose} onDraftFor={onDraftFor} onAddPerson={onAddPerson} />;
  const claude = <Claude work={work} row={row} phone={phone} onCopy={copy} onFull={onFull} />;
  const big = phone ? ' td-big' : '';
  const finish = canEdit && (
    <>
      {row.kind === 'reply' && <button type="button" className={`td-btn${big}`} onClick={onAddReply}>Add to-do</button>}
      {row.kind === 'todo' && <button type="button" className={`td-btn${big}`} onClick={onDone} data-work-done>Done</button>}
      {row.kind === 'todo' && row.person && <button type="button" className={`td-btn td-btn--pri${big}`} onClick={onFinish} data-work-finish>Done and mark {firstName(who.name)} contacted</button>}
    </>
  );
  const label = `${VERB_LABEL[work.verb]}: ${row.text}`;

  if (phone) {
    const tabs = [hasMiddle && ['middle', TAB_LABEL[work.verb]], ['steps', `Next steps${work.data?.steps?.length ? ` · ${work.data.steps.length}` : ''}`], ['claude', 'Claude']].filter(Boolean);
    return (
      <div className="td-sheet" data-work-sheet onKeyDown={esc}>
        <div className="td-sheet__in" role="dialog" aria-modal="true" aria-label={label} ref={boxRef} tabIndex={-1} data-work={work.state} data-work-verb={work.verb}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 16, overflowWrap: 'anywhere' }}>{row.text}</div><div className="td-note">{[row.company?.name, row.person?.name].filter(Boolean).join(' · ') || 'not linked'}</div></div>
            <button type="button" className="td-mb" aria-label="Close" onClick={onClose}>×</button>
          </div>
          <div className="td-tabs" role="tablist" aria-label="Work panel">{tabs.map(([id, t]) => <button key={id} type="button" role="tab" className="td-tab" aria-selected={tab === id} onClick={() => setTab(id)} data-work-tab={id}>{t}</button>)}</div>
          <div role="tabpanel" style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: '1 1 auto', minHeight: 0 }}>{tab === 'steps' ? steps : tab === 'claude' ? claude : middle}</div>
          {notice}
          {cost && <span className="td-note td-num" data-work-cost>{cost}</span>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{finish}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="td-wkin" role="region" aria-label={label} ref={boxRef} tabIndex={-1} onKeyDown={esc} data-work={work.state} data-work-verb={work.verb}>
      <div className={`td-panes${hasMiddle ? '' : ' td-panes--two'}`}>{steps}{middle}{claude}</div>
      {notice}
      <div className="td-wfoot">
        <span className="td-note">{canEdit && row.kind === 'todo' ? 'Sent it yourself?' : 'Nothing is sent from Prospector.'}{cost && <span className="td-num" data-work-cost> · {cost}</span>}</span>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" className="td-btn" onClick={onClose} data-work-close>Close</button>{finish}</span>
      </div>
    </div>
  );
}
