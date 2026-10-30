// FIX hk-imported-drafts-noise F2 / F3 - the one data correction behind scripts/hk-imported-drafts.mjs. F2: a 'drafted'
// touch with no Gmail draft (the sheet import's "Email drafted" / "IG DM ready" rows) -> 'imported'; a DM text the daily
// check wrote (it logged draft_created for it) is a real one and stays. F3: a live brand at status 'drafted' with no open
// draft left -> 'claimed' when it has a member owner, else 'candidate', one Activity row each. Rows change state; nothing
// is deleted.
import { isOpenDraft } from './rules.js';
import { logEvent } from './hkShared.js';

export const F3_REASON = 'sheet said drafted; no draft in Gmail';
const CHUNK = 100;

// draftEvents: hk_events rows with action draft_created (detail.touch_id). -> { touches, brands }
export function planImportedDrafts({ brands, touches, draftEvents }) {
  const madeHere = new Set(draftEvents.map(e => e.detail?.touch_id).filter(Boolean));
  const toImported = touches.filter(t => t.state === 'drafted' && !t.gmail_draft_id && !madeHere.has(t.id));
  const moving = new Set(toImported.map(t => t.id));
  const withDraft = new Set(touches.filter(t => !moving.has(t.id) && isOpenDraft(t)).map(t => t.brand_id));
  return {
    touches: toImported.map(t => ({ id: t.id, brand_id: t.brand_id, channel: t.channel, kind: t.kind, sender_user_id: t.sender_user_id, created_by: t.created_by })),
    brands: brands.filter(b => !b.archived_at && b.status === 'drafted' && !withDraft.has(b.id))
      .map(b => ({ id: b.id, name: b.name, owner_user_id: b.owner_user_id || null, owner_hint: b.owner_hint || null, to: b.owner_user_id ? 'claimed' : 'candidate' })),
  };
}

// Each write re-checks the state it expects (drafted), so a row someone changed since the plan is left alone.
export async function applyImportedDrafts(supabase, { businessId, plan, now }) {
  const at = now.toISOString();
  let touches = 0, brands = 0;
  const ids = plan.touches.map(t => t.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.from('hk_touches').update({ state: 'imported' }).eq('business_id', businessId).eq('state', 'drafted').is('gmail_draft_id', null).in('id', ids.slice(i, i + CHUNK)).select('id');
    if (error) throw new Error(error.message);
    touches += (data || []).length;
  }
  for (const b of plan.brands) {
    const { data, error } = await supabase.from('hk_brands').update({ status: b.to, updated_at: at }).eq('business_id', businessId).eq('id', b.id).eq('status', 'drafted').select('id');
    if (error) throw new Error(error.message);
    if (!(data || []).length) continue;
    brands += 1;
    await logEvent(supabase, { businessId, actorKind: 'system', entityType: 'brand', entityId: b.id, action: 'brand.status', detail: { changed: ['status'], prev: { status: 'drafted' }, reason: `${F3_REASON} -> ${b.to}` } });
  }
  return { touches, brands };
}
