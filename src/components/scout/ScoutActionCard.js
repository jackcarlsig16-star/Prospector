import { LockGlyph, StarGlyph } from './ScoutParts';
import { cardTitle, cardFoot, rowKindWord, dayWords, draftCost } from './scoutActions';

// scout-v3 Stage 2 (specs/design/scout-v3/Scout3Actions) - what an action looks like, one block under the answer it
// acts on: the periwinkle CONFIRM card (nothing is written before Confirm; rows that would not change are listed
// dimmed and skipped), the working sweep with the names ticking, the green done line with a 10 s Undo and Retry on a
// failed row, the can't-do state (what Scout won't do · the verbs it has · one nearest action), and the one-line
// states: opened, copied, cancelled by a new ask, plan expired, Undo expired.
// scout-v3.1 C4 - the task variant (handoff §3): how Scout read "add a task to call MetLife Thursday" as four
// fields - Task · Linked to · Owner · Due - with the note on how the day was read. Edit opens quick capture prefilled.
function TaskCard({ card, busy, onConfirm, onCancel, onEdit }) {
  const f = card.fields;
  return (
    <div className="scout-confirm" role="group" aria-label={cardTitle(card)} data-scout-card={card.verb} data-scout-taskcard>
      <b className="scout-confirm__title">{cardTitle(card)}</b>
      <dl className="scout-kv" data-scout-fields>
        <dt>Task</dt><dd>{f.task}</dd>
        <dt>Linked to</dt><dd>{f.linked_to ? <>{f.linked_to}{f.linked_detail && <small> · {f.linked_detail}</small>}</> : <span className="scout-dim">no record</span>}</dd>
        <dt>Owner</dt><dd>{f.owner} <small>(you)</small></dd>
        <dt>Due</dt><dd>{dayWords(f.due)}</dd>
      </dl>
      <div className="scout-confirm__foot">
        <button type="button" className="scout-btn scout-btn--accent" onClick={onConfirm} disabled={busy} data-scout-confirm>Confirm <kbd>↵</kbd></button>
        {onEdit && <button type="button" className="scout-btn scout-btn--plain" onClick={onEdit} disabled={busy} data-scout-edit>Edit</button>}
        <button type="button" className="scout-btn scout-btn--plain" onClick={onCancel} disabled={busy}>Cancel <kbd>esc</kbd></button>
        {f.due_note && <span className={card.when?.past ? 'scout-warn' : 'scout-note'} data-scout-due-note>{f.due_note.replace(/^"([a-z])/, (m, c) => `“${c.toUpperCase()}`).replace(/" read/, '” read')}.</span>}
      </div>
    </div>
  );
}

// scout-v3.1 C2 - the inline draft: who it is to, subject, body, then Copy · Open in Write email (prefilled) ·
// Regenerate (one more call) and what the call cost. Never a send. A draft that held an address or phone shape is
// withheld: the reason, Regenerate and the panel remain.
export function DraftBlock({ draft, copied, busy, onCopy, onOpen, onRegenerate }) {
  const to = draft.to ? `${draft.to.name}${draft.to.title ? ` · ${draft.to.title}` : ''} · ${draft.company.name}` : draft.company.name;
  const cost = draftCost(draft);
  return (
    <div className="scout-draft" role="group" aria-label={`Draft email to ${draft.to?.name || draft.company.name}`} data-scout-draft={draft.withheld ? 'withheld' : 'ready'}>
      <div className="scout-draft__head"><span className="scout-lbl">Draft · not sent</span><span data-scout-draft-to>To <b>{to}</b></span></div>
      {draft.withheld
        ? <div className="scout-edge-line" data-scout-draft-withheld><LockGlyph /><span>{draft.reason}</span></div>
        : <>
          <b className="scout-draft__subject" data-scout-draft-subject>{draft.subject}</b>
          <p className="scout-draft__body" data-scout-draft-body>{draft.body}</p>
        </>}
      <div className="scout-confirm__foot">
        {!draft.withheld && <button type="button" className="scout-btn scout-btn--accent" onClick={onCopy} disabled={busy} data-scout-draft-copy>{copied ? '✓ Copied' : 'Copy'}</button>}
        <button type="button" className="scout-btn scout-btn--plain" onClick={onOpen} disabled={busy} data-scout-draft-open>Open in Write email</button>
        <button type="button" className="scout-btn scout-btn--plain" onClick={onRegenerate} disabled={busy} data-scout-draft-again>Regenerate</button>
        {cost && <span className="scout-note scout-num" data-scout-draft-cost>{cost}</span>}
        <span className="scout-note">Nothing was sent.</span>
      </div>
      {!draft.withheld && draft.lint && !draft.lint.ok && <span className="scout-warn" data-scout-draft-lint>{draft.lint.issues} rule {draft.lint.issues === 1 ? 'issue' : 'issues'} - open Write email to see {draft.lint.issues === 1 ? 'it' : 'them'}.</span>}
    </div>
  );
}

export function ConfirmCard({ card, busy, onConfirm, onCancel, onEdit }) {
  if (card.fields) return <TaskCard card={card} busy={busy} onConfirm={onConfirm} onCancel={onCancel} onEdit={onEdit} />;
  return (
    <div className="scout-confirm" role="group" aria-label={cardTitle(card)} data-scout-card={card.verb}>
      <b className="scout-confirm__title">{cardTitle(card)}</b>
      <ul>
        {card.rows.map(r => (
          <li key={r.key} className={r.skipped ? 'is-skipped' : undefined} data-scout-card-row={r.skipped ? 'skipped' : 'will'}>
            <span>{r.title}{rowKindWord(r) && <small> · {rowKindWord(r)}</small>}</span>
            <span>{r.skipped ? `${r.skipped} · skipped` : <>{r.from != null && <>{r.from} → </>}<b>{r.to}</b></>}</span>
            {r.note && !r.skipped && <small className="scout-confirm__note">{r.note}</small>}
          </li>
        ))}
      </ul>
      {card.when?.past && <span className="scout-warn" data-scout-past>That date is in the past - confirm or edit.</span>}
      <div className="scout-confirm__foot">
        <button type="button" className="scout-btn scout-btn--accent" onClick={onConfirm} disabled={busy || !card.summary.will} data-scout-confirm>Confirm <kbd>↵</kbd></button>
        <button type="button" className="scout-btn scout-btn--plain" onClick={onCancel} disabled={busy}>Cancel <kbd>esc</kbd></button>
        <span className="scout-note" data-scout-card-foot>{cardFoot(card)}</span>
      </div>
    </div>
  );
}

export function ActWorking({ card, ticked }) {
  const todo = card.rows.filter(r => !r.skipped);
  return (
    <div className="scout-act" data-scout-acting aria-live="polite">
      <span className="scout-neon">{cardTitle(card).replace(/^(\w+)/, m => `${m.replace(/e$/, '')}ing`)}…</span>
      <div className="scout-sweep" aria-hidden="true" />
      <span className="scout-note">{todo.map((r, i) => `${i < ticked ? '✓ ' : ''}${r.title}${i >= ticked ? '…' : ''}`).join(' · ')}</span>
    </div>
  );
}

export function DoneLine({ result, secondsLeft, undone, onUndo, onRetry, busy }) {
  const failed = result.rows.filter(r => r.error);
  return (
    <div className="scout-act" data-scout-done>
      <div className="scout-done-line" role="status">
        <span data-scout-done-line>{undone || `✓ ${result.line}`}</span>
        {!undone && result.can_undo && (secondsLeft > 0
          ? <button type="button" className="scout-btn scout-btn--plain scout-undo" onClick={onUndo} disabled={busy} data-scout-undo>Undo <span className="scout-num">{secondsLeft} s</span></button>
          : <span className="scout-note" data-scout-undo-expired>Undo expired · open the record to change it</span>)}
      </div>
      {!undone && failed.map(r => (
        <div key={r.key} className="scout-fail" data-scout-failed={r.key}>
          <span><b>{r.title}</b> failed: {r.error}</span>
          <button type="button" className="scout-btn scout-btn--plain" onClick={() => onRetry(r.key)} disabled={busy}>Retry</button>
        </div>
      ))}
    </div>
  );
}

// onChoose: "Which one?" - several rows fit a pronoun, so Scout asks instead of guessing; each candidate is a button.
// FIX scout-company-lookup S4: a name with no record keeps its reason on screen - the near records are offered under
// "Did you mean", and a company the site has seen offers its Add as target (onAdd; Members only).
export function CantDo({ cant, onNearest, onChoose, onAdd }) {
  const picks = onChoose ? cant.candidates || [] : [];
  const mean = !!cant.did_you_mean;
  const which = picks.length > 0 && !mean;
  return (
    <div className="scout-cant" data-scout-cant={which ? 'which' : ''} role="status">
      <div className="scout-edge-line">{which ? <StarGlyph size={14} /> : <LockGlyph />}<span>{which ? 'Which one?' : cant.reason}</span></div>
      {picks.length > 0 && (
        <div className="scout-pills" role="group" aria-label={mean ? 'Did you mean?' : 'Which one?'} data-scout-which={mean ? 'mean' : ''}>
          {mean && <span className="scout-lbl">Did you mean</span>}
          {picks.map(c => <button key={c.key} type="button" className="scout-btn scout-btn--plain" data-scout-candidate={c.key} onClick={() => onChoose(c)}>{c.title}{c.sub && <small className="scout-dim"> · {c.sub}</small>}</button>)}
          {!mean && <span className="scout-note">or say it like “the second one”, or use a name.</span>}
        </div>
      )}
      {cant.add && onAdd && <div><button type="button" className="scout-btn scout-btn--accent" onClick={onAdd} data-scout-add-target>{cant.add.label}</button></div>}
      {cant.pills?.length > 0 && (
        <div className="scout-pills">
          <span className="scout-lbl">What I can do</span>
          {cant.pills.map(p => <span key={p.id} className="scout-pill" data-scout-pill={p.id}>{p.label}</span>)}
        </div>
      )}
      {cant.nearest && onNearest && <div><button type="button" className="scout-btn scout-btn--accent" onClick={onNearest} data-scout-nearest>{cant.nearest.label} instead</button></div>}
    </div>
  );
}

export const ActNote = ({ kind, children }) => <div className="scout-act" data-scout-note={kind} role="status"><span className={kind === 'opened' || kind === 'copied' ? 'scout-done-line' : 'scout-note'}>{kind === 'planning' && <span className="scout-neon" style={{ display: 'inline-flex', marginRight: 6 }}><StarGlyph size={12} /></span>}{children}</span>{kind === 'planning' && <div className="scout-sweep" aria-hidden="true" />}</div>;
