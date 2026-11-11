// person-owner-v1 Stage 1 - READ-ONLY: since the migration ran, has the still-deployed code moved a prospect's text
// enum away from the owner_user_id the backfill gave it, or added prospects with no owner? Declared:
// sales_prospect_state, sales_person_events (count) and business_members, ~4 requests, under 1 MB; cap 30 s. 0 writes.
import { svc, HL, cap, footer } from './homelover-data-model-v1-lib.mjs';
cap(30);
const page = async (table, cols, order) => { const out = []; for (let i = 0; ; i += 1000) { const r = await svc.from(table).select(cols).eq('business_id', HL).order(order).range(i, i + 999); if (r.error) throw new Error(`${table}: ${r.error.message}`); out.push(...r.data); if (r.data.length < 1000) break; } return out; };
const [pros, members, ev] = await Promise.all([page('sales_prospect_state', 'contact_id, owner, owner_user_id, created_at, updated_at', 'contact_id'), page('business_members', 'user_id, name', 'user_id'), svc.from('sales_person_events').select('*', { count: 'exact', head: true }).eq('business_id', HL)]);
const first = id => String(members.find(m => m.user_id === id)?.name || '').split(' ')[0].toLowerCase() || null;
const off = pros.filter(p => (['jack', 'cyrus'].includes(p.owner) ? first(p.owner_user_id) !== p.owner : false));
const nobody = pros.filter(p => !p.owner_user_id);
console.log(`prospects ${pros.length} · the enum names a member who is not the owner: ${off.length}${off.length ? ` (changed ${off.map(p => String(p.updated_at).slice(0, 16)).join(', ')})` : ''} · no owner: ${nobody.length}${nobody.length ? ` (enum ${[...new Set(nobody.map(p => p.owner))].join(', ')}; created ${nobody.map(p => String(p.created_at).slice(0, 10)).sort().pop()} latest)` : ''} · person events ${ev.count}`);
footer();
