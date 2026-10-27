// hkos-gmail-connect-v1 (G5.5 / G5.6) - the sync pill's state and the page-load guard, pure and Jest-tested.
export const PAGELOAD_GUARD_MS = 60 * 60e3;
export const syncKey = (businessId, userId) => `prospector_hk_sync_${businessId}_${userId}`;

export const relative = (iso, now = Date.now()) => {
  if (!iso) return null;
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60e3));
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};

// gmail = GET /gmail/status payload; syncing = a request in flight. -> { tone, text, action: 'sync' | 'connections' | null }
export function syncPillState(gmail, syncing = false, now = Date.now()) {
  if (!gmail) return null;
  if (!gmail.mailbox?.linked) return { tone: 'grey', text: 'Link your Gmail', action: 'connections' };
  if (gmail.mailbox.state === 'needs_reconnect') return { tone: 'amber', text: 'Gmail needs reconnect', action: 'connections' };
  if (syncing) return { tone: 'grey', text: 'Syncing', action: null };
  const last = gmail.sync_state?.last_synced_at || (gmail.last_run?.status === 'ok' ? gmail.last_run.finished_at : null);
  if (gmail.last_run?.status === 'error' && !last) return { tone: 'amber', text: 'Gmail sync failed', action: 'sync' };
  if (!last) return { tone: 'grey', text: 'Gmail linked, not synced yet', action: 'sync' };
  if (gmail.badges?.tracked === 0) return { tone: 'green', text: 'Gmail synced · nothing tracked yet', action: 'sync' };
  return { tone: 'green', text: `Gmail synced ${relative(last, now)}`, action: 'sync' };
}

// The browser mirrors the server's 60-min guard so a tab reload never fires a second page-load sync.
export const pageloadDue = (lastTs, now = Date.now()) => !lastTs || now - Number(lastTs) > PAGELOAD_GUARD_MS;
