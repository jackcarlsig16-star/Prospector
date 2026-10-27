// hkos-gmail-connect-v1 (G6) - who has already talked to this brand. (b) tracked history from BOTH founders: sent
// touches and logged replies in hk_touches / hk_replies - no mailbox call; (a) one narrow search in the CALLER's own
// tethered mailbox when the brand has a domain (2 Gmail calls at most). Result per founder: { founder_user_id,
// last_at } - never a subject, a snippet or a link into anyone's mail.
export async function trackedThreads(supabase, businessId, brandId) {
  const { data: touches, error } = await supabase.from('hk_touches').select('sender_user_id, state, sent_at, drafted_at, gmail_thread_id').eq('business_id', businessId).eq('brand_id', brandId);
  if (error) throw new Error(error.message);
  const by = {};
  for (const t of touches || []) {
    if (t.state !== 'sent') continue;
    const at = t.sent_at || t.drafted_at;
    if (!by[t.sender_user_id] || String(at) > String(by[t.sender_user_id])) by[t.sender_user_id] = at;
  }
  const { data: replies } = await supabase.from('hk_replies').select('received_at, touch_id, hk_touches:touch_id(sender_user_id)').eq('business_id', businessId).eq('brand_id', brandId);
  for (const r of replies || []) {
    const owner = r.hk_touches?.sender_user_id || r.sender_user_id;
    if (owner && (!by[owner] || String(r.received_at) > String(by[owner]))) by[owner] = r.received_at;
  }
  return Object.entries(by).map(([founder_user_id, last_at]) => ({ founder_user_id, last_at }));
}

// The caller's own mailbox: any message from or to the brand's domain. Only the newest message's date is read.
export async function liveThread({ gmail, token, domain, callerUserId }) {
  if (!gmail || !token || !domain) return null;
  const list = await gmail.searchMessages(token, `from:${domain} OR to:${domain}`, 1);
  const id = list?.messages?.[0]?.id;
  if (!id) return null;
  const msg = await gmail.getMessage(token, id);
  const dateHeader = (msg?.payload?.headers || []).find(h => h.name.toLowerCase() === 'date')?.value;
  const parsed = dateHeader ? Date.parse(dateHeader) : NaN;
  const last_at = !Number.isNaN(parsed) ? new Date(parsed).toISOString() : msg?.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString();
  return { founder_user_id: callerUserId, last_at };
}

export async function warmThreads({ supabase, businessId, brandId = null, domain = null, callerUserId, gmail = null, token = null }) {
  const tracked = brandId ? await trackedThreads(supabase, businessId, brandId) : [];
  const live = await liveThread({ gmail, token, domain, callerUserId }).catch(() => null);
  if (!live) return tracked;
  const mine = tracked.find(t => t.founder_user_id === callerUserId);
  if (mine) { if (String(live.last_at) > String(mine.last_at)) mine.last_at = live.last_at; return tracked; }
  return [...tracked, live];
}
