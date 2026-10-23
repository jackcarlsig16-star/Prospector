import { SA, saSans } from '../theme';
import { labelStyle } from '../goals/goalsUi';
import { stageName } from '../goals/partners/activityTimeline';
import { TEAM_LABEL } from '../../../constants/ownership';
import { chipStyle } from './LinkPicker';
import { Box, md } from './TaskRow';
import { isSkipped, orphaned } from './intakeBody';

// call-notes-targets-v1 - the Intake review sections other than Tasks.
// Every row: a checkbox, what Accept would do, and the sentence it came
// from. Rows that can't be written anywhere stay visible, greyed, with why.

const ROLE = { champion: 'champion', blocker: 'blocker', referrer: 'referrer', counterpart: 'counterpart', other: 'contact' };
const TOUCH = { email: 'Email', call: 'Call', linkedin: 'LinkedIn', meeting: 'Meeting', event: 'Event', other: 'Touch' };
const COLUMN = { champion: 'Champion', angle: 'Angle', watch_outs: 'Watch-outs', next_step: 'Next step', do_not_say: 'Do not say', target_titles: 'Target titles', objections: 'Objections', next_action: 'Next action', research_notes: 'Research notes' };
const SOURCE = { outlook: ' via Outlook', apollo: ' via Apollo', manual: '' };
const matchLabel = m => ({ partner: 'Partner', opportunity: 'Employer', account: 'In Apollo, not in pipeline', target: 'Target' }[m.type]);
const selectStyle = { ...saSans, fontSize: 12, color: SA.text, background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 8, height: 28, padding: '0 6px', maxWidth: '100%' };
const small = color => ({ fontSize: 12, color: color || SA.muted, overflowWrap: 'anywhere' });

export function Section({ title, count, children }) {
  if (!count) return null;
  return (
    <section aria-label={title} style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ ...labelStyle, color: SA.soft, paddingTop: 6 }}>{title} <span style={{ color: SA.faint }}>· {count}</span></span>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{children}</ul>
    </section>
  );
}

function Row({ on, disabled, label, onToggle, children }) {
  return (
    <li style={{ borderTop: `1px solid ${SA.track}`, padding: '10px 0', display: 'flex', gap: 10, alignItems: 'flex-start', opacity: on && !disabled ? 1 : 0.55 }}>
      <div style={{ paddingTop: 1 }}><Box checked={on && !disabled} disabled={disabled} label={label} onClick={onToggle} /></div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>{children}</div>
    </li>
  );
}
const Evidence = ({ text }) => (text ? <span style={{ ...small(), fontStyle: 'italic' }}>“{text}”</span> : null);

const companyActions = c => (c.match
  ? c.match.type === 'account' ? [['pipeline', `Add ${c.match.name} to pipeline`], ['none', 'Leave as is']] : [['note', `Add this note to ${c.match.name}`], ['skip', 'Skip']]
  : [['target_partner', 'Partner target'], ['target_employer', 'Employer target'], ['skip', 'Skip'], ['never', 'Skip + never again']]);
const defaultAction = c => (c.match ? (c.match.type === 'account' ? 'pipeline' : 'note') : c.kind === 'employer' ? 'target_employer' : 'target_partner');

// lead-source-v1 - who brought it, as the notes say; kept only on a record Accept creates (a target or Add to pipeline).
const REF_FIELDS = [['partner', 'Partner', 160], ['person', 'Person', 120], ['office', 'Office', 120]];
const createsRecord = c => c.action.startsWith('target_') || c.action === 'pipeline';
function ReferredBy({ c, onChange }) {
  const ref = c.referred_by;
  if (!ref) return <button type="button" className="ui-btn ui-btn--tertiary" style={{ height: 24, fontSize: 12, alignSelf: 'flex-start' }} onClick={() => onChange({ partner: '', person: '', office: '' })}>+ Referred by</button>;
  return (
    <div role="group" aria-label={`Referred by for ${c.name}`} data-referred-by style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={small(SA.soft)}>Referred by</span>
      {REF_FIELDS.map(([k, label, max]) => (
        <input key={k} aria-label={`${label} who referred ${c.name}`} placeholder={label} maxLength={max} value={ref[k] || ''} style={{ ...selectStyle, width: 130 }}
          onChange={e => onChange({ ...ref, [k]: e.target.value, ...(k === 'partner' ? { partner_id: null } : {}) })} />
      ))}
      {ref.partner_id ? <span style={small(SA.good)}>✓ in Pipeline</span> : ref.partner ? <span style={small()}>not in Pipeline yet</span> : null}
      <button type="button" className="ui-btn ui-btn--tertiary" style={{ height: 24, fontSize: 12 }} aria-label={`Clear referred by for ${c.name}`} onClick={() => onChange(null)}>✕</button>
    </div>
  );
}

export function CompanyRows({ rows, categories, set }) {
  return rows.map((c, i) => {
    const toggle = () => set(i)(isSkipped(c) ? { on: true, action: ['skip', 'none'].includes(c.action) ? defaultAction(c) : c.action } : { on: false });
    return (
      <Row key={c.key} on={!isSkipped(c)} label={`Keep company: ${c.name}`} onToggle={toggle}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>{c.name}</span>
          <span style={chipStyle}>{c.match ? `${matchLabel(c.match)} · ${c.match.name}${c.match.partial ? ' (part of the name)' : ''}` : c.kind === 'not_target' ? 'Not a target' : c.kind === 'unclear' ? 'Unclear' : 'New'}</span>
          <select aria-label={`What to do with ${c.name}`} value={c.action} style={selectStyle}
            onChange={e => set(i)({ action: e.target.value, on: !['skip', 'none'].includes(e.target.value) })}>
            {companyActions(c).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {c.action === 'target_partner' && categories.length > 0 && (
            <select aria-label={`Category for ${c.name}`} value={c.category || ''} style={selectStyle} onChange={e => set(i)({ category: e.target.value || null })}>
              <option value="">No category yet</option>
              {categories.map(k => <option key={k} value={k}>{k.replace(/^\d+\.\s*/, '')}</option>)}
            </select>
          )}
        </div>
        {c.action.startsWith('target_') && <span style={small()}>Becomes a target at Researching, with a research to-do due in 3 days</span>}
        {c.action === 'never' && <span style={small()}>Won't be proposed from notes again</span>}
        {createsRecord(c) && <ReferredBy c={c} onChange={referred_by => set(i)({ referred_by })} />}
        <Evidence text={c.evidence} />
      </Row>
    );
  });
}

export function PeopleRows({ rows, companies, set }) {
  return rows.map((p, i) => {
    const lost = orphaned(p, companies);
    const where = !p.dest ? 'Not stored - its company isn’t a partner, employer or target'
      : lost ? `Tick ${p.company} as a target to keep this`
      : p.dest === 'partner_contacts' ? (p.existing ? `Update ${p.match.name}'s ${p.name}${p.existing.title && p.title && p.existing.title !== p.title ? ` (${p.existing.title} → ${p.title})` : ''}` : `Add to ${p.match.name}'s people`)
      : p.dest === 'decision_makers' ? `${p.creates_opportunity ? `Adds ${p.match.name} to pipeline · ` : ''}→ ${p.match.name} decision makers`
      : `→ ${p.company} research notes`;
    return (
      <Row key={p.key} on={p.on} disabled={!p.dest || lost} label={`Keep person: ${p.name}`} onToggle={() => set(i)({ on: !p.on })}>
        <span><strong>{p.name}</strong>{p.title ? ` · ${p.title}` : ''} · {ROLE[p.role]} · {p.company}</span>
        {p.moved_from && <span style={small()}>Moved from {p.moved_from}{p.moved_from_match ? ' - a note goes on that partner' : ''}</span>}
        <span style={small(p.dest && !lost ? SA.soft : SA.muted)}>{where}</span>
        <Evidence text={p.evidence} />
      </Row>
    );
  });
}

export function TouchRows({ rows, set }) {
  return rows.map((t, i) => (
    <Row key={t.key} on={t.on} disabled={t.kept_with_note} label={`Log touch: ${TOUCH[t.touch_type]} ${t.company}`} onToggle={() => set(i)({ on: !t.on })}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>{TOUCH[t.touch_type]} · {md(t.date)} · {t.people.join(', ') || 'no one named'} {t.direction === 'in' ? '←' : '→'} <strong>{t.company}</strong></span>
        {t.stage && !t.kept_with_note && (
          <button type="button" aria-pressed={t.stage_on} aria-label={`Move ${t.company} to ${stageName(t.stage)}`} onClick={() => set(i)({ stage_on: !t.stage_on })}
            style={{ ...chipStyle, borderColor: t.stage_on ? SA.accent : SA.border, color: t.stage_on ? SA.text : SA.muted, textDecoration: t.stage_on ? 'none' : 'line-through' }}>
            → {stageName(t.stage)}
          </button>
        )}
      </div>
      {t.duplicate && <span style={small(SA.warn)}>Already recorded {md(t.duplicate.date)}{SOURCE[t.duplicate.source] ?? ''} - left unticked</span>}
      {t.kept_with_note && <span style={small()}>{t.match ? 'Kept with the note - employer timelines aren’t built yet' : 'Kept with the note - company not matched'}</span>}
      {t.warning && <span role="note" style={small(SA.warn)}>⚠ {t.warning}</span>}
      <Evidence text={t.evidence} />
    </Row>
  ));
}

const teamText = o => [
  o.owner_team && `owner ${TEAM_LABEL[o.owner_team]}${o.old ? ` (was ${o.old.owner_team ? TEAM_LABEL[o.old.owner_team] : 'unset'})` : ''}`,
  o.co_owner_name && `co-owner ${o.co_owner_name}`,
  o.no_double_touch === true && "don't double-touch", o.no_double_touch === false && 'double-touch OK',
].filter(Boolean).join(' · ');

export function IntelRows({ ownership, facts, companies, setOwnership, setFact }) {
  return (
    <>
      {ownership.map((o, i) => {
        const lost = !o.dest || orphaned(o, companies);
        return (
          <Row key={o.key} on={o.on} disabled={lost} label={`Set ownership: ${o.company}`} onToggle={() => setOwnership(i)({ on: !o.on })}>
            <span><strong>{o.company}</strong>: {teamText(o) || 'no change'}</span>
            {o.creates_opportunity && <span style={small(SA.soft)}>Will add {o.match.name} to pipeline</span>}
            {lost && <span style={small()}>{o.dest ? `Tick ${o.company} as a target to keep this` : 'Not stored - company not matched'}</span>}
            <Evidence text={o.evidence} />
          </Row>
        );
      })}
      {facts.map((f, i) => {
        const lost = !f.column || orphaned(f, companies);
        return (
          <Row key={f.key} on={f.on} disabled={lost} label={`Keep fact: ${f.company} ${f.field}`} onToggle={() => setFact(i)({ on: !f.on })}>
            <span><strong>{f.company}</strong> · {f.column ? COLUMN[f.column] : f.field.replace(/_/g, ' ')}</span>
            <span style={small(SA.soft)}>{f.single ? `${f.old || '—'} → ${f.text}${f.due_date ? ` (by ${md(f.due_date)})` : ''}` : `+ ${f.text}`}</span>
            {f.creates_opportunity && !lost && <span style={small()}>Will add {f.match.name} to pipeline</span>}
            {lost && <span style={small()}>{f.column ? `Tick ${f.company} as a target to keep this` : f.match ? 'Not stored - employers keep champion, watch-outs and next step only' : 'Not stored - company not matched'}</span>}
            <Evidence text={f.evidence} />
          </Row>
        );
      })}
    </>
  );
}

// call-notes-targets-v1 REV5 - the deal side. Only a partner keeps these, so
// a row whose company isn't a partner stays greyed with why.
const NOT_PARTNER = 'Not stored - only a partner keeps it';
function dealRow(x, set, i, label, children) {
  return (
    <Row key={x.key} on={x.on} disabled={!x.match} label={label} onToggle={() => set(i)({ on: !x.on })}>
      {children}
      {!x.match && <span style={small()}>{NOT_PARTNER}</span>}
      <Evidence text={x.evidence} />
    </Row>
  );
}

export const DecisionRows = ({ rows, set }) => rows.map((d, i) => dealRow(d, set, i, `Keep decision: ${d.company}`,
  <span><strong>{d.company}</strong> · {d.text}</span>));

export const WaitingRows = ({ rows, set }) => rows.map((w, i) => dealRow(w, set, i, `Keep waiting-on: ${w.who}`, (
  <>
    <span><strong>{w.who}</strong> · {w.company} · {w.due_date ? `due ${md(w.due_date)}` : 'no date'}</span>
    <span style={small(SA.soft)}>{w.text}</span>
  </>
)));

export const TermsRows = ({ rows, set }) => rows.map((t, i) => dealRow(t, set, i, `Keep terms: ${t.company}`, (
  <>
    <span><strong>{t.company}</strong> · Notes</span>
    <span style={small(SA.soft)}>+ {t.line}</span>
  </>
)));

export const MeetingRows = ({ rows, set }) => rows.map((n, i) => dealRow(n, set, i, `Set next meeting: ${n.company}`, (
  <>
    <span><strong>{n.company}</strong> · Next meeting</span>
    <span style={small(SA.soft)}>{n.old ? md(n.old) : '—'} → {md(n.date)}{n.text ? ` · ${n.text}` : ''}</span>
  </>
)));
