// hkos-data-foundation-v1 D2 - can_contact: may this sender draft this kind of touch to this brand? Pure; the server
// is the only caller and the browser gets the verdict, never the inputs. A 'warm' verdict carries the other founder
// and the last date ONLY - never a subject, body or address.
export const BLOCKING_RELATIONSHIPS = { sponsor: 'sponsor', founding_partner: 'sponsor', do_not_contact: 'do_not_contact' };
export const EMAIL_KINDS = new Set(['cold', 'bump', 'final']);
export const DEFAULT_MAX_EMAIL_TOUCHES = 3;

// grow-sheet-owner-respect F1 - a sheet owner: no member owner and an owner_hint (the import's founder name, stored
// text) that is not the caller's first name. The brand stays theirs until they claim it or the caller takes it.
const hintKey = v => String(v || '').trim().toLowerCase();
export const sheetOwnerOf = (brand, meFirstName) => (!brand.owner_user_id && hintKey(brand.owner_hint) && hintKey(brand.owner_hint) !== hintKey(meFirstName) ? String(brand.owner_hint).trim() : null);
export const hintName = hint => { const h = String(hint).trim(); return h[0].toUpperCase() + h.slice(1); };
export const sheetQuestion = hint => `The sheet lists this as ${hintName(hint)}'s. Take it anyway?`;

const lastOf = threads => threads.reduce((best, t) => (!best || String(t.last_at) > String(best.last_at) ? t : best), null);

// brand: { status, relationship, owner_user_id, owner_unclear, niche }
// touches: [{ channel, state }] for this brand
// threadsByFounder: [{ founder_user_id, last_at }] - every mail thread with this brand's domain, any founder (step 3 fills it)
// sponsorsNiches: [{ name, niche }] - current sponsors
export function canContact({ brand, touches = [], threadsByFounder = [], senderUserId, kind, sponsorsNiches = [], maxEmailTouches = DEFAULT_MAX_EMAIL_TOUCHES }) {
  const warnings = [];
  if (brand.niche) {
    const niche = String(brand.niche).trim().toLowerCase();
    const hit = sponsorsNiches.find(s => s.niche && String(s.niche).trim().toLowerCase() === niche);
    if (hit) warnings.push({ code: 'niche_overlap', sponsor: hit.name });
  }
  const block = reason => ({ ok: false, reason, warnings });
  const rel = BLOCKING_RELATIONSHIPS[brand.relationship];
  if (rel) return block(rel);
  if (brand.status === 'passed') return block('passed');
  if (brand.owner_user_id && brand.owner_user_id !== senderUserId) return { ok: false, reason: 'owned_by', owner_user_id: brand.owner_user_id, warnings };
  if (brand.owner_unclear) return block('owner_unclear');
  if (kind === 'cold' && threadsByFounder.length) {
    const t = lastOf(threadsByFounder);
    return { ok: false, reason: 'warm', founder_user_id: t.founder_user_id, last_at: t.last_at, warnings };
  }
  if (EMAIL_KINDS.has(kind)) {
    const sent = touches.filter(t => t.channel === 'email' && t.state === 'sent').length;
    if (sent >= maxEmailTouches) return { ok: false, reason: 'max_touches', sent, max: maxEmailTouches, warnings };
  }
  return { ok: true, reason: null, warnings };
}

// grow-ui-refresh-v1 U2 - the one primary action a brand shows, by state, in this order. Replies and drafts first (on a
// brand that is the caller's or nobody's), then another member's brand (no button), then Pitch (researched + an email
// contact + can_contact clear), Research (not researched), Add email (researched, no address). A blocked brand
// (sponsor, do not contact, passed, Unclear, warm, max touches) gets no primary.
// replies: [{ handled }] · touches: [{ state, sender_user_id }] · verdictOk: canContact(... kind 'cold').ok
export function primaryOf({ brand, meId, firstName = () => null, replies = [], touches = [], researched, hasEmail, verdictOk }) {
  const mineOrFree = !brand.owner_user_id || brand.owner_user_id === meId;
  if (mineOrFree && replies.some(r => r.handled === false)) return { kind: 'open_reply', label: 'Open reply' };
  if (touches.some(t => t.state === 'drafted' && t.sender_user_id === meId)) return { kind: 'open_draft', label: 'Open draft in Gmail' };
  if (!mineOrFree) return { kind: 'owned', label: `Owned by ${firstName(brand.owner_user_id) || 'another founder'}` };
  if (!verdictOk) return null;
  if (!researched) return { kind: 'research', label: 'Research' };
  return hasEmail ? { kind: 'pitch', label: 'Pitch' } : { kind: 'add_email', label: 'Add email' };
}
