import { useCallback, useEffect, useRef, useState } from 'react';
import { scoutApi } from './scoutApi';
import { goalsApi } from '../salesAnalytics/goals/goalsApi';
import { playbookPrompt } from '../salesAnalytics/goals/companyPanelModel';
import { SCOUT_CAPTURE, UNDO_SECONDS, planRows, keyOf, dateIn, cardTitle, withResults, withoutResults, withAction, undoneAction, copiedLine } from './scoutActions';

// scout-v3 Stage 2 - one action at a time, for the answer on screen:
//   planning -> card (Confirm / Cancel) -> working (names tick) -> done (Undo for 10 s, Retry on a failed row)
//   or: cant (the verb pills + one nearest action) · opened / copied / note (one line).
// Every write is the server's (/plan writes nothing, /act runs it, /undo reverses it). The rows update in place from
// /act's reply and the done line becomes a sub-line of the answer (D11).
const copy = async text => { await navigator.clipboard.writeText(text); };

export function useScoutActions({ scope, current, onTurn, onOpenItem, onCompose }) {
  const [act, setAct] = useState(null);
  const turnRef = useRef(current);
  turnRef.current = current;
  const note = (kind, text) => setAct({ kind, text });

  useEffect(() => {
    if (act?.kind !== 'working') return undefined;
    const t = setInterval(() => setAct(a => (a?.kind === 'working' ? { ...a, ticked: Math.min(a.ticked + 1, Math.max(0, a.card.summary.will - 1)) } : a)), 350);
    return () => clearInterval(t);
  }, [act?.kind]);
  useEffect(() => {
    if (act?.kind !== 'done' || act.undone || act.left <= 0) return undefined;
    const t = setTimeout(() => setAct(a => (a?.kind === 'done' ? { ...a, left: a.left - 1 } : a)), 1000);
    return () => clearTimeout(t);
  }, [act]);

  const packCopy = useCallback(async (records, q) => {
    try {
      const r = await scoutApi.pack({ scope, q: q || turnRef.current?.q || '', records: records.map(x => ({ entity: x.entity, id: x.id })) });
      await copy(r.text);
      note('copied', copiedLine(r));
    } catch (e) { note('note', e.status === 422 ? 'Not copied: the pack still held an address or phone shape.' : e.message === 'offline' ? "Scout can't reach the server · try again." : `Not copied: ${e.message}`); }
  }, [scope]);

  const opened = useCallback(async r => {
    const o = r.open;
    try {
      if (o.quick_capture) window.dispatchEvent(new CustomEvent(SCOUT_CAPTURE, { detail: { businessId: scope, ...o.quick_capture } }));
      else if (o.panel === 'compose') onCompose({ type: o.type, id: o.id, name: o.name, key: `${o.type}-${o.id}` });
      else if (o.copy === 'bundle') await copy(`${await goalsApi.copyBundle(scope, o.type, o.id)}${playbookPrompt({ type: o.type, name: o.person })}\n`);
      else if (o.pack) return packCopy(o.pack.records);
      note('opened', r.line);
    } catch (e) { note('note', e.message); }
    return undefined;
  }, [scope, onCompose, packCopy]);

  // -> 'ask' when the server says the text is not a command.
  const run = useCallback(async body => {
    setAct({ kind: 'planning', text: body.text || '' });
    let r;
    try { r = await scoutApi.plan({ scope, rows: planRows(turnRef.current), ...body }); }
    catch (e) { if (e.status === 403 && e.body?.cant) r = e.body; else { note('note', e.offline ? "Scout can't reach the server · try again." : e.message); return 'done'; } }
    if (r.command === false) { setAct(null); return 'ask'; }
    if (r.cant) setAct({ kind: 'cant', cant: r.cant, text: body.text || '' });
    else if (r.open) await opened(r);
    else setAct({ kind: 'card', card: r });
    return 'done';
  }, [scope, opened]);

  const settle = (r, card) => {
    const turn = turnRef.current;
    if (turn) onTurn(withAction(withResults(turn, r.rows), r.line));
    setAct({ kind: 'done', result: r, card, left: r.can_undo ? UNDO_SECONDS : 0, undone: null });
  };
  const confirm = useCallback(async () => {
    if (act?.kind !== 'card') return;
    const card = act.card;
    setAct({ kind: 'working', card, ticked: 0 });
    try { settle(await scoutApi.act({ plan_id: card.plan_id }), card); }
    catch (e) { note('note', e.status === 410 ? 'Plan expired · ask again' : e.message); }
  }, [act]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = useCallback(async key => {
    if (act?.kind !== 'done') return;
    try { settle(await scoutApi.act({ plan_id: act.card.plan_id, keys: [key] }), act.card); }
    catch (e) { note('note', e.message); }
  }, [act]); // eslint-disable-line react-hooks/exhaustive-deps
  const undo = useCallback(async () => {
    if (act?.kind !== 'done') return;
    try {
      const r = await scoutApi.undo({ plan_id: act.card.plan_id });
      const turn = turnRef.current;
      if (turn) onTurn(undoneAction(withoutResults(turn)));
      setAct(a => ({ ...a, undone: r.line === 'undone' ? 'Undone' : r.line }));
    } catch (e) { if (e.body?.expired) setAct(a => ({ ...a, left: 0 })); else note('note', e.message); }
  }, [act, onTurn]);

  const pick = useCallback((item, id, args) => {
    if (id === 'open' || id.startsWith('task:')) { onOpenItem(item); if (id !== 'open') note('opened', 'Opened in Actions - finish it there'); return undefined; }
    if (id === 'copy') return packCopy([item]);
    return run({ verb: id, keys: [keyOf(item)], args: id === 'snooze' ? { date: dateIn(args.days) } : args || {}, text: '' });
  }, [onOpenItem, packCopy, run]);

  return {
    act, confirm, retry, undo, pick, copy: packCopy,
    command: text => run({ text }),
    nearest: () => (act?.kind === 'cant' && act.cant.nearest?.id ? run({ verb: act.cant.nearest.id, text: act.text }) : undefined),
    cancel: () => setAct(null),
    clear: () => setAct(null),
    // S1: a new ask cancels an open card.
    onNewAsk: () => setAct(a => (a?.kind === 'card' ? { kind: 'note', text: `Cancelled: ${cardTitle(a.card)}` } : null)),
  };
}
