import { useState, useEffect } from 'react';
import { SA, saSans } from './theme';
import { goalsApi } from './goals/goalsApi';

// call-notes-targets-v1 Stage 2 - one button on a partner card, an
// opportunity panel and a target row: the record as markdown, on the
// clipboard, for pasting into Claude. The server scrubs it (no emails, no
// phones) and refuses to answer if anything slipped. Viewers may copy too.
const SHOWN_MS = 1800;
// ui-clarity-v1 R6 secondary at 28 px (callers spread it, so it stays a style object).
export const copyBtnStyle = { ...saSans, height: 28, padding: '0 10px', borderRadius: 6, border: `1px solid ${SA.border}`, background: SA.surface2, color: SA.text, fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };

export default function CopyForClaude({ businessId, type, id, label, style }) {
  const [state, setState] = useState(null); // 'busy' | 'copied' | { error }
  useEffect(() => {
    if (state !== 'copied' && !state?.error) return;
    const t = setTimeout(() => setState(null), state === 'copied' ? SHOWN_MS : 4000);
    return () => clearTimeout(t);
  }, [state]);
  const copy = async () => {
    setState('busy');
    try {
      const markdown = await goalsApi.copyBundle(businessId, type, id);
      await navigator.clipboard.writeText(markdown);
      setState('copied');
    } catch (e) { setState({ error: e.message || 'Copy failed' }); }
  };
  const name = label || 'Copy for Claude';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...style }}>
      <button type="button" onClick={copy} disabled={state === 'busy'} aria-label={name} title="Copies this record as text for Claude - no emails or phone numbers"
        style={{ ...copyBtnStyle, borderColor: state === 'copied' ? SA.accent : SA.border }}>
        {state === 'copied' ? 'Copied for Claude ✓' : state === 'busy' ? 'Copying…' : name}
      </button>
      <span role="status" style={{ fontSize: 12, color: SA.bad }}>{state?.error || ''}</span>
    </span>
  );
}
