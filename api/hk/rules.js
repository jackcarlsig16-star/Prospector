// hkos-data-foundation-v1 D2 - can_contact: may this sender draft this kind of touch to this brand? Pure; the server
// is the only caller and the browser gets the verdict, never the inputs. A 'warm' verdict carries the other founder
// and the last date ONLY - never a subject, body or address.
export const BLOCKING_RELATIONSHIPS = { sponsor: 'sponsor', founding_partner: 'sponsor', do_not_contact: 'do_not_contact' };
export const EMAIL_KINDS = new Set(['cold', 'bump', 'final']);
export const DEFAULT_MAX_EMAIL_TOUCHES = 3;

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
