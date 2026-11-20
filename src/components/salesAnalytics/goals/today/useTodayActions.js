import { useCallback, useEffect, useRef, useState } from 'react';
import { scoutApi } from '../../../scout/scoutApi';
import { UNDO_SECONDS } from '../../../scout/scoutActions';
import { scoutKey, doneWords } from './todayRows';

// actions-v2 Stage 2 - every write Today makes is one of Scout's verbs: POST /api/scout/plan (nothing written) ->
// /act -> /undo. A pick made in place on ONE row (the check circle, a ⋯ menu choice) is planned and acted in one go
// and shows the done line with Undo; a batch shows Scout's confirm card first. Nothing is written by this file.
//   state: null | { kind: 'busy' } | { kind: 'card', card, say } | { kind: 'done', line, planId, left, undone } | { kind: 'note', text }
export function useTodayActions({ businessId, onChanged }) {
  const [state, setState] = useState(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => {
    if (state?.kind !== 'done' || state.undone || state.left <= 0) return undefined;
    const t = setTimeout(() => setState(s => (s?.kind === 'done' ? { ...s, left: s.left - 1 } : s)), 1000);
    return () => clearTimeout(t);
  }, [state]);

  const settle = (card, say, result) => {
    setState({ kind: 'done', line: say ? doneWords(card.verb, result, say) : result.line, planId: card.plan_id, left: result.can_undo ? UNDO_SECONDS : 0, undone: false });
    changed.current();
  };
  const act = useCallback(async (card, say) => {
    setState({ kind: 'busy' });
    try { settle(card, say, await scoutApi.act({ plan_id: card.plan_id })); }
    catch (e) { setState({ kind: 'note', text: e.status === 410 ? 'That took too long - try again.' : e.message }); }
  }, []);

  // rows: [{ entity, id, title, company? }] · instant: act without the card (one row picked in place)
  const run = useCallback(async ({ verb, rows, args = {}, instant = false, say = {} }) => {
    setState({ kind: 'busy' });
    let card;
    try { card = await scoutApi.plan({ scope: businessId, verb, rows, keys: rows.map(scoutKey), args, text: '' }); }
    catch (e) { setState({ kind: 'note', text: e.body?.cant?.reason || e.message }); return; }
    if (card.cant) { setState({ kind: 'note', text: card.cant.reason }); return; }
    if (!card.plan_id) { setState(null); return; }
    if (instant && card.summary.will > 0) await act(card, say);
    else setState({ kind: 'card', card, say });
  }, [businessId, act]);

  const undo = useCallback(async () => {
    if (state?.kind !== 'done') return;
    try { const r = await scoutApi.undo({ plan_id: state.planId }); setState(s => ({ ...s, undone: true, line: r.line === 'undone' ? 'Undone.' : r.line })); changed.current(); }
    catch (e) { setState(s => ({ ...s, left: 0, line: e.body?.expired ? 'Undo expired · open the to-do to change it.' : e.message })); }
  }, [state]);

  return { state, run, undo, confirm: () => (state?.kind === 'card' ? act(state.card, state.say) : undefined), dismiss: () => setState(null) };
}
