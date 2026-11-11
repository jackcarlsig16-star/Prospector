import { LockGlyph, StarGlyph } from './ScoutParts';
import { cardTitle, cardFoot, rowKindWord } from './scoutActions';

// scout-v3 Stage 2 (specs/design/scout-v3/Scout3Actions) - what an action looks like, one block under the answer it
// acts on: the periwinkle CONFIRM card (nothing is written before Confirm; rows that would not change are listed
// dimmed and skipped), the working sweep with the names ticking, the green done line with a 10 s Undo and Retry on a
// failed row, the can't-do state (what Scout won't do · the verbs it has · one nearest action), and the one-line
// states: opened, copied, cancelled by a new ask, plan expired, Undo expired.
export function ConfirmCard({ card, busy, onConfirm, onCancel }) {
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

export function CantDo({ cant, onNearest }) {
  return (
    <div className="scout-cant" data-scout-cant role="status">
      <div className="scout-edge-line"><LockGlyph /><span>{cant.reason}</span></div>
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

export const ActNote = ({ kind, children }) => <div className="scout-act" data-scout-note={kind} role="status"><span className={kind === 'opened' || kind === 'copied' ? 'scout-done-line' : 'scout-note'}>{kind === 'planning' && <span className="scout-neon" style={{ display: 'inline-flex', marginRight: 6 }}><StarGlyph size={12} /></span>}{children}</span></div>;
