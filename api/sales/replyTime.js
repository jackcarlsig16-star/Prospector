// microsoft-connect-v1 Stage 4a - one place every reader resolves "when did
// the reply arrive": the exact Outlook time (replied_at) when a synced reply
// matched, else when the Apollo sync first saw it (replied_seen_at).
export const replyAt = m => m.replied_at || m.replied_seen_at || null;
export const replyExact = m => !!m.replied_at;
export const REPLY_COLUMNS = 'replied_seen_at,replied_at';

// PostgREST can't COALESCE in a filter, so the window is spelled out twice.
export function replyWindow(query, fromIso, toIso = null) {
  return query.or(toIso
    ? `and(replied_at.gte.${fromIso},replied_at.lt.${toIso}),and(replied_at.is.null,replied_seen_at.gte.${fromIso},replied_seen_at.lt.${toIso})`
    : `replied_at.gte.${fromIso},and(replied_at.is.null,replied_seen_at.gte.${fromIso})`);
}
