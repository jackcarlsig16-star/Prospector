import { cleanText } from '../sales/scrubText.js';

// scout-v2 REV2 Stage 1 - what this module registers with Scout (api/scout/registry.js), from its own folder: brands and
// their contacts, names and titles only (never an address), opening on this module's own hash routes. appliesTo: the
// workspace's hk_sales feature (the same flag as its gate).
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const pat = q => `%${String(q || '').replace(/[%_,()"'\\]/g, ' ').replace(/\s+/g, ' ').trim()}%`;
const day = v => (v ? String(v).slice(0, 10) : null);
const brandOpen = id => ({ page: 'hk', hash: `#hk/brands/${id}` });

export const ENTITIES = [
  { entity: 'brands', label: 'Brands', open: brandOpen,
    async search(sb, { businessId, q, limit }) {
      const rows = must(await sb.from('hk_brands').select('id, name, domain, category, segment, status, relationship, last_touch_at, updated_at').eq('business_id', businessId).is('archived_at', null).or(`name.ilike.${pat(q)},domain.ilike.${pat(q)},category.ilike.${pat(q)}`).order('updated_at', { ascending: false }).limit(limit));
      return rows.map(r => ({ id: r.id, title: r.name, subtitle: [r.status, r.category].filter(Boolean).join(' · '), date: day(r.last_touch_at || r.updated_at), text: [r.name, 'brand', r.status, r.relationship, r.category, r.segment, r.domain, r.last_touch_at ? `last touch ${day(r.last_touch_at)}` : null].filter(Boolean).join(' · ') }));
    } },
  { entity: 'brand_contacts', label: 'Brand contacts', open: (id, row) => brandOpen(row?.brand_id || id),
    async search(sb, { businessId, q, limit }) {
      const rows = must(await sb.from('hk_contacts').select('id, brand_id, name, title').eq('business_id', businessId).or(`name.ilike.${pat(q)},title.ilike.${pat(q)}`).limit(limit));
      return rows.map(r => ({ id: r.id, brand_id: r.brand_id, title: cleanText(r.name, 120), subtitle: r.title ? cleanText(r.title, 120) : null, text: [cleanText(r.name, 120), r.title ? cleanText(r.title, 120) : null, 'brand contact'].filter(Boolean).join(' · ') }));
    } },
];

export const VOCABULARY = { entities: { brands: ['brand', 'brands', 'sponsor', 'sponsors'], brand_contacts: ['brand contact', 'brand contacts'] } };

export async function register(registry) {
  registry.register('hk', { appliesTo: b => !!b.features?.hk_sales, entities: ENTITIES, vocabulary: VOCABULARY });
}
