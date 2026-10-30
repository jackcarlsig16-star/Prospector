import React, { useCallback, useState } from 'react';
import Button from '../../ui/Button';

// grow-sheet-owner-respect F3 - the server answers a claim on a brand the sheet lists as someone else's with 409
// { confirm_sheet_owner: true } and the question; this asks it ("Take it" / "Leave it") and runs again with the flag.
export const needsSheetConfirm = e => e?.status === 409 && e.body?.confirm_sheet_owner === true;

export function useSheetConfirm() {
  const [ask, setAsk] = useState(null);
  const confirm = useCallback(question => new Promise(resolve => setAsk({ question, resolve })), []);
  const answer = yes => { ask.resolve(yes); setAsk(null); };
  const node = ask && (
    <div className="hk-bulk" role="alertdialog" aria-label="Take it anyway?" data-hk-sheet-confirm>
      <span>{ask.question}</span>
      <Button size="sm" variant="primary" autoFocus onClick={() => answer(true)} data-hk-sheet-take>Take it</Button>
      <Button size="sm" variant="tertiary" onClick={() => answer(false)} data-hk-sheet-leave>Leave it</Button>
    </div>
  );
  return { confirm, node };
}

// run(extraBody) -> its result, or null when the answer was Leave it.
export async function claimAsking(confirm, run) {
  try { return await run({}); } catch (e) {
    if (!needsSheetConfirm(e)) throw e;
    return (await confirm(e.message)) ? run({ confirm_sheet_owner: true }) : null;
  }
}

// Bulk: one pass as usual; the brands that need the question are asked about once, together, then retried with the flag.
export async function bulkAsking(confirm, ids, run) {
  const ask = [], refused = [];
  for (const id of ids) { try { await run(id, {}); } catch (e) { if (needsSheetConfirm(e)) ask.push([id, e.body.sheet_owner]); else refused.push(e.message); } }
  if (ask.length) {
    const names = [...new Set(ask.map(([, h]) => h))];
    const yes = await confirm(`The sheet lists ${ask.length === 1 ? 'one of these' : `${ask.length} of these`} as ${names.map(n => `${n}'s`).join(' or ')}. Take ${ask.length === 1 ? 'it' : 'them'} anyway?`);
    if (yes) for (const [id] of ask) { try { await run(id, { confirm_sheet_owner: true }); } catch (e) { refused.push(e.message); } }
  }
  return refused;
}
