// hkos-inbox-v2 Q4 - when each user last listed their Inbox (this process only; server.js is one persistent process).
// The page-load Gmail sync reads it so it never spends the same user's per-minute Gmail quota in the same minute.
export const INBOX_QUIET_MS = 60_000; // REVISABLE (spec Q4)
const lastList = new Map();
export const noteInboxList = (businessId, userId, at) => { lastList.set(`${businessId}:${userId}`, at); };
export const inboxListedAt = (businessId, userId) => lastList.get(`${businessId}:${userId}`) ?? null;
export const clearInboxActivity = () => lastList.clear();
