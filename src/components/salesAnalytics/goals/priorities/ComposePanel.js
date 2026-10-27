import { useState, useEffect } from 'react';
import { SA } from '../../theme';
import SidePanel from '../../SidePanel';
import { goalsApi } from '../goalsApi';
import { inputStyle, numStyle, ErrorNote } from '../goalsUi';

// intent-score-v1 S7 - the Write email side panel: subject + body + the "why this company" line from ONE Claude call
// (POST goals/compose/:type/:id), the hard-rule lint result, [Copy] [Open in Outlook as draft] (mailto, no address,
// never sends) [Regenerate] [Lint again] (POST goals/compose/lint on the edited text). Edits stay in the panel.
const ISSUE_LABEL = { claim_unmatched: 'Claim not in the Brief', number_unverified: 'Number not in the Brief', banned_claim: 'Banned phrase', pricing: 'Pricing', dash: 'Dashes', sign_off: 'Sign-off', length: 'Too long', address: 'Address in the draft', subject_missing: 'No subject', body_missing: 'No body' };

export default function ComposePanel({ businessId, row, onClose, onToast }) {
  const [state, setState] = useState({ loading: true, error: '', draft: null, lint: null, cost: null, cap: null, claims: [] });
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [linting, setLinting] = useState(false);
  const generate = async () => {
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const r = await goalsApi.compose(businessId, row.type, row.id);
      setSubject(r.draft.subject); setBody(r.draft.body);
      setState({ loading: false, error: '', draft: r.draft, lint: r.lint, cost: r.cost_usd, cap: r.cap, claims: r.claims || [] });
    } catch (e) { setState(s => ({ ...s, loading: false, error: e.message })); }
  };
  useEffect(() => { generate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [businessId, row.type, row.id]);
  const lintAgain = async () => {
    setLinting(true);
    try { const r = await goalsApi.composeLint(businessId, { type: row.type, id: row.id, subject, body, claims: state.claims }); setState(s => ({ ...s, lint: r.lint })); }
    catch (e) { onToast({ text: e.message }); }
    finally { setLinting(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}\n`); onToast({ text: 'Draft copied' }); } catch { onToast({ text: 'Clipboard blocked - select and copy' }); } };
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const lint = state.lint;
  return (
    <SidePanel label={`Write email · ${row.name}`} width={600} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: SA.text }}>Write email · {row.name}</h2>
        <span style={{ flex: 1 }} />
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: SA.muted }}>One Claude call from the Brief only. Nothing is sent from here{state.cost != null ? ` · this draft cost $${state.cost.toFixed(4)}` : ''}{state.cap ? ` · ${state.cap.used}/${state.cap.max} today` : ''}.</p>
      {state.error && <ErrorNote message={state.error} />}
      {state.loading && <span style={{ fontSize: 13, color: SA.muted }}>Writing…</span>}
      {state.draft && (
        <>
          {state.draft.why && <div data-compose-why style={{ fontSize: 13, color: SA.text, padding: '8px 10px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 8 }}><span className="ui-group-label">Why this company</span><div>{state.draft.why}</div></div>}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="ui-group-label">Subject</span>
            <input className="ui-input" value={subject} onChange={e => setSubject(e.target.value)} style={{ ...inputStyle, height: 36 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="ui-group-label">Body</span>
            <textarea className="ui-input" value={body} onChange={e => setBody(e.target.value)} rows={14} style={{ ...inputStyle, height: 'auto', padding: 10, lineHeight: 1.45, resize: 'vertical' }} />
          </label>
          {lint && (
            <div data-compose-lint role="status" style={{ fontSize: 13, padding: '8px 10px', borderRadius: 8, background: lint.ok ? `color-mix(in srgb, ${SA.good} 10%, transparent)` : `color-mix(in srgb, ${SA.bad} 10%, transparent)`, border: `1px solid ${lint.ok ? SA.good : SA.bad}` }}>
              <b style={{ color: lint.ok ? SA.good : SA.bad }}>{lint.ok ? 'Passes every hard rule' : `${lint.issues.length} rule${lint.issues.length === 1 ? '' : 's'} to fix`}</b>
              <span style={{ ...numStyle, color: SA.muted }}> · {lint.words} words</span>
              {!lint.ok && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{lint.issues.map((i, k) => <li key={k} style={{ color: SA.text }}><b>{ISSUE_LABEL[i.rule] || i.rule}:</b> {i.detail}</li>)}</ul>}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={copy}>Copy</button>
            <a className="ui-btn ui-btn--secondary ui-btn--sm" href={mailto} title="Opens your mail app with the draft - you add the recipient, nothing is sent">Open in Outlook as draft</a>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={state.loading} onClick={generate}>Regenerate</button>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={linting} onClick={lintAgain}>{linting ? 'Linting…' : 'Lint again'}</button>
          </div>
        </>
      )}
    </SidePanel>
  );
}
