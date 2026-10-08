import { useEffect } from 'react';
import { SA, SA_SHAPE, saSans } from './theme';
import { SEMANTIC } from './palette';

// huddle-live-feed-v1 - one person on the Live tab: who, what they did (real
// opens only), when, a plain-words insight and the suggested next step. No
// heat or score here - those stay on Priorities. Phone numbers never shown.
const LA = 'America/Los_Angeles';
const laDate = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: LA });
const clock = iso => new Date(iso).toLocaleTimeString('en-US', { timeZone: LA, hour: 'numeric', minute: '2-digit' }).toLowerCase();
export function whenText(iso, now = Date.now()) {
  if (!iso) return '—';
  if (laDate(iso) === laDate(now)) return clock(iso);
  const days = Math.max(1, Math.round((Date.parse(`${laDate(now)}T12:00:00Z`) - Date.parse(`${laDate(iso)}T12:00:00Z`)) / 864e5));
  return days < 7 ? `${days} d ago` : new Date(iso).toLocaleDateString('en-US', { timeZone: LA, month: 'short', day: 'numeric' });
}
const fullWhen = iso => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: LA, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'time unknown');

const badge = (color, strong) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 8px', borderRadius: 999, fontSize: 12, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
  color: strong ? color : SA.soft, border: `1px solid ${strong ? `color-mix(in srgb, ${color} 50%, transparent)` : SA.border}`, background: strong ? `color-mix(in srgb, ${color} 12%, transparent)` : 'transparent' });
const btn = { ...saSans, height: 32, padding: '0 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: SA.text, border: `1px solid ${SA.border}`, background: SA.surface2, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' };
const KIND_LABEL = { sent: '✉ Sent', open: '👁 Opened', click: '🖱 Clicked', reply: '↩ Replied' };

export default function HuddleLiveRow({ r, ownerColor, ownerLabel, canEdit, expanded, onToggle, onFlag, onContacted, stacked, now }) {
  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = e => { if (e.key === 'Escape') onToggle(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded, onToggle]);

  const seq = r.sequence ? [r.sequence.name || 'Sequence', r.step != null ? `Step ${r.step}` : null].filter(Boolean).join(' · ') : null;
  const contactedLabel = r.last_contacted_at ? (r.contacted_today ? '✓ Contacted today' : `✓ Contacted ${whenText(r.last_contacted_at, now)}`) : null;
  const flagFirst = r.flag?.owner_name?.split(' ')[0];
  const alreadyContacted = r.status === 'contacted';
  const expandBtn = <button type="button" style={btn} aria-expanded={expanded} aria-label={expanded ? 'Collapse' : 'Expand timeline'} onClick={onToggle}>{expanded ? '▾' : '▸'}</button>;

  return (
    <div id={`live-row-${r.contact_id}`} style={{ padding: '10px 12px', borderRadius: SA_SHAPE.radiusInner, background: SA.surface, border: `1px solid ${expanded ? SA.borderStrong : SA.border}`, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px', minWidth: 0 }}>
        <span title={ownerLabel} aria-label={`Owner ${ownerLabel}`} style={{ width: 8, height: 8, borderRadius: 999, background: ownerColor, flex: 'none' }} />
        <span style={{ fontSize: 15, fontWeight: 600, color: SA.text }}>{r.name || 'Unknown contact'}</span>
        {stacked && <span style={{ marginLeft: 'auto', order: 1 }}>{expandBtn}</span>}
        <span style={{ fontSize: 13, color: SA.muted, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: stacked ? 'normal' : 'nowrap' }}>{[r.company, r.title].filter(Boolean).join(' · ')}</span>
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {r.replied && <span style={badge(SEMANTIC.healthy, true)}>↩ Replied</span>}
          {r.human_clicks > 0 && <span style={badge(SEMANTIC.warning, !r.replied)}>🖱 Clicked{r.human_clicks > 1 ? ` ×${r.human_clicks}` : ''}</span>}
          {r.real_opens > 0 && <span style={badge(SA.link, !r.replied && !r.human_clicks)}>👁 ×{r.real_opens}</span>}
          {r.bot_only && <span style={badge(SA.faint)} title="Only automated opens/clicks">🤖 bot ×{r.bot_opens + r.scanner_clicks}</span>}
          <span style={badge(SA.soft)} title={`${r.sent} delivered`}>✉ {r.sent}</span>
          <span style={{ fontSize: 12, color: SA.muted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }} title={fullWhen(r.last_activity_at)}>last: {whenText(r.last_activity_at, now)}</span>
        </span>
      </div>
      <div style={{ fontSize: 13, color: SA.soft }}>{r.insight}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', fontSize: 12 }}>
        <span style={{ color: SA.accent, fontWeight: 600 }} title={r.next_step.reason || ''}>→ {r.next_step.label}</span>
        {seq && <span style={{ color: SA.muted }}>{seq}</span>}
        {r.flag && <span style={badge(SA.accent, true)}>⚑ Flagged to {flagFirst || 'teammate'}</span>}
        {contactedLabel && <span style={badge(SEMANTIC.healthy, r.contacted_today)}>{contactedLabel}</span>}
        {r.closed && <span style={badge(SA.faint)}>{r.unsubscribed ? 'Unsubscribed' : 'Not interested'}</span>}
        <span style={{ flex: 1 }} />
        <span role="group" aria-label={`Actions for ${r.name || 'contact'}`} style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
          {canEdit && <button type="button" style={btn} onClick={() => onFlag(r)}>Flag →</button>}
          {canEdit && <button type="button" style={{ ...btn, opacity: alreadyContacted ? 0.5 : 1, cursor: alreadyContacted ? 'default' : 'pointer' }} disabled={alreadyContacted}
            title={alreadyContacted ? 'Already marked contacted' : 'Mark contacted (undo for 5 s)'} onClick={() => onContacted(r)}>{stacked ? '✓ Contacted' : 'Mark contacted'}</button>}
          <a href={r.linkedin_url || r.linkedin_search_url} target="_blank" rel="noreferrer" style={btn} title={r.linkedin_url ? 'LinkedIn profile' : 'LinkedIn people search for name + company'}>LinkedIn ↗</a>
          <a href={r.apollo_url} target="_blank" rel="noreferrer" style={btn}>Apollo ↗</a>
          {!stacked && expandBtn}
        </span>
      </div>
      {expanded && (
        <div style={{ borderTop: `1px solid ${SA.track}`, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          {r.timeline.map((t, i) => (
            <div key={`${t.kind}:${t.message_id}:${t.at}:${i}`} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', color: t.automated ? SA.faint : SA.soft }}>
              <span style={{ minWidth: 92, color: t.automated ? SA.faint : SA.text }}>{KIND_LABEL[t.kind]}</span>
              <span style={{ minWidth: 52 }}>{t.step != null ? `step ${t.step}` : ''}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t.kind === 'reply' ? (t.at ? `seen at sync ${fullWhen(t.at)}` : 'seen at sync (time not recorded)') : fullWhen(t.at)}</span>
              {t.automated && <span>· bot / scanner</span>}
              {t.reply_class && <span>· {t.reply_class.replace(/_/g, ' ')}</span>}
            </div>
          ))}
          {r.flag && <div style={{ color: SA.muted, marginTop: 4 }}>To-do: flagged to {r.flag.owner_name || 'a teammate'} (Goals → This week)</div>}
          {r.in_pipeline && <div style={{ color: SA.muted }}>In pipeline{r.in_pipeline_meeting_plus ? ' · meeting or later' : ''}</div>}
        </div>
      )}
    </div>
  );
}
