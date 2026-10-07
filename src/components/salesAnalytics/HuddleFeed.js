import { useState, useEffect, useCallback } from 'react';
import { SA, SA_TYPE, SA_SHAPE, saSans } from './theme';
import { fetchHuddleFeed } from './huddleApi';
import { OWNER_LABELS, feedText, groupFeed, filterFeed, timeAgo } from './huddleView';
import { ShowingChip } from './goals/goalsUi';

// sales-huddle-v2 Stage 2 - Recent activity: opens, clicks and replies from
// the last 7 days, as fresh as the last sync. Bot opens / link scanners are
// hidden unless the rail's toggle shows them (greyed, "likely automated").
const ICON = { open: '👁', click: '🔗', reply: '↩' };
const FEED_DAYS = 7; // REVISABLE (spec)
const KIND_LABEL = { open: 'Real opens', click: 'Real clicks', reply: 'Replies' };

export default function HuddleFeed({ businessId, reloadKey, today, lastHuddleAt, filters, bandById, staleById, ownerColor, onOpen, onFlag, onClearKind }) {
  const [items, setItems] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let live = true;
    setError('');
    fetchHuddleFeed(businessId, { days: FEED_DAYS })
      .then(d => { if (live) { setItems(d.items); setNextBefore(d.next_before); } })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [businessId, reloadKey]);

  const more = useCallback(async () => {
    setLoadingMore(true);
    try { const d = await fetchHuddleFeed(businessId, { days: FEED_DAYS, before: nextBefore }); setItems(x => [...x, ...d.items]); setNextBefore(d.next_before); }
    catch (e) { setError(e.message); }
    setLoadingMore(false);
  }, [businessId, nextBefore]);

  const shown = items ? filterFeed(items, filters, bandById, staleById) : [];
  const { days, dividerAt } = groupFeed(shown, today, lastHuddleAt);

  return (
    <section id="huddle-feed-section" aria-labelledby="huddle-feed" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <h2 id="huddle-feed" style={{ ...SA_TYPE.cardTitle, fontSize: 17, color: SA.text, margin: 0 }}>Recent activity</h2>
        <span style={{ ...SA_TYPE.label, color: SA.faint }}>{filters.hideBots ? 'people only' : 'incl. likely automated'} · last {FEED_DAYS} days</span>
      </div>
      {filters.kind && items && <div style={{ marginBottom: 10 }}><ShowingChip label={KIND_LABEL[filters.kind]} count={shown.length} onClear={onClearKind} /></div>}
      {error ? <p style={{ fontSize: 13, color: SA.warn, margin: 0 }}>⚠ {error}</p>
        : items === null ? <p style={{ fontSize: 13, color: SA.faint, margin: 0 }}>Loading activity…</p>
        : !shown.length ? <p style={{ fontSize: 13, color: SA.faint, margin: 0 }}>No activity for these filters in the last {FEED_DAYS} days.</p>
        : (
          <div className="sa-scroll" style={{ background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, padding: '6px 12px', maxHeight: 640, overflowY: 'auto' }}>
            {days.map(d => (
              <div key={d.day}>
                <div style={{ ...SA_TYPE.label, color: SA.muted, padding: '10px 0 4px' }}>{d.day}</div>
                {d.items.map(i => (
                  <div key={i.key}>
                    {i.key === dividerAt && (
                      <div role="separator" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0', color: SA.accent, fontSize: 11 }}>
                        <span style={{ flex: 1, height: 1, background: 'color-mix(in srgb, var(--sa-accent) 40%, transparent)' }} />new since last huddle<span style={{ flex: 1, height: 1, background: 'color-mix(in srgb, var(--sa-accent) 40%, transparent)' }} />
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: `1px solid ${SA.track}`, fontSize: 13, opacity: i.automated ? 0.55 : 1 }}>
                      <span aria-hidden="true" style={{ width: 18, textAlign: 'center' }}>{ICON[i.kind]}</span>
                      <span style={{ flex: 1, minWidth: 0, color: SA.soft }}>
                        <span style={{ color: SA.text, fontWeight: 600 }}>{i.name || 'Unknown contact'}</span>
                        {i.company && <span style={{ color: SA.muted }}> · {i.company}</span>} {feedText(i)}
                        {i.automated && <span style={{ color: SA.faint }}> · likely automated</span>}
                        <span style={{ color: SA.faint }}> · {timeAgo(i.at)}</span>
                      </span>
                      <span title={OWNER_LABELS[i.owner]} style={{ width: 8, height: 8, borderRadius: 999, background: ownerColor(i.owner), flex: 'none' }} />
                      {onFlag && !i.automated && (
                        <button type="button" onClick={() => onFlag(i.contact_id)} aria-label={`Flag ${i.name || 'prospect'}`} title="Flag for a teammate"
                          style={{ ...saSans, height: 28, padding: '0 8px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: `1px solid ${SA.border}`, background: 'transparent', flex: 'none' }}>🚩</button>
                      )}
                      <button type="button" onClick={() => onOpen(i.contact_id)} aria-label={`Open ${i.name || 'prospect'}`}
                        style={{ ...saSans, height: 28, padding: '0 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer', color: SA.link, border: `1px solid ${SA.border}`, background: 'transparent', flex: 'none' }}>Open</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {nextBefore && <button type="button" onClick={more} disabled={loadingMore} style={{ ...saSans, margin: '8px 0', height: 32, padding: '0 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: SA.link, border: `1px solid ${SA.border}`, background: 'transparent' }}>{loadingMore ? 'Loading…' : 'Load more'}</button>}
          </div>
        )}
    </section>
  );
}
