// node --test api/sales/partnerPeople.test.mjs
// FIX linkedin-url-normalize - the partner People form and the read-side checks (lead upload, Apollo contact sync)
// use the one LinkedIn rule. Invented names; in-memory Supabase; 0 network, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { addPersonRoute } from './partnerPeople.js';
import { toLeads } from './leadUploadMatch.js';
import { contactRow } from './partnerContactsSync.js';

const B = randomUUID(), P = randomUUID(), U = randomUUID();
const res = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
const req = body => ({ params: { businessId: B, id: P }, body, auth: { user: { id: U } } });

test('partner People: "LinkedIn.com/in/x/" saves as https://www.linkedin.com/in/x; a non-LinkedIn link is 400 in plain words', async () => {
  const sb = fakeSupabase({ sales_goals: [{ id: P, business_id: B, goal_type: 'partnership', name: 'Zz Harbor' }], partner_contacts: [] });
  const r = res();
  await addPersonRoute(req({ name: 'Zz Lin Test', linkedin_url: 'LinkedIn.com/in/zz-lin/' }), r, { supabase: sb });
  assert.equal(r.code, 201, JSON.stringify(r.body));
  assert.equal(sb.db.partner_contacts[0].linkedin_url, 'https://www.linkedin.com/in/zz-lin');
  const bad = res();
  await addPersonRoute(req({ name: 'Zz Bad', linkedin_url: 'example.com/in/x' }), bad, { supabase: sb });
  assert.deepEqual([bad.code, bad.body.error], [400, "That doesn't look like a LinkedIn link — paste it like linkedin.com/in/name."]);
});

test('read side: a lead upload and an Apollo contact keep the same normalized link (no scheme accepted, others dropped)', () => {
  const leads = toLeads({ people: [{ name: 'Zz Ann', company: 'Zz Co', linkedin_url: 'linkedin.com/in/zz-ann' }, { name: 'Zz Bo', company: 'Zz Co', linkedin_url: 'https://example.com/bo' }] });
  const people = leads.companies.flatMap(c => c.people);
  assert.deepEqual(people.map(p => [p.name, p.linkedin_url]), [['Zz Ann', 'https://www.linkedin.com/in/zz-ann'], ['Zz Bo', null]]);
  assert.equal(contactRow(B, P, { id: 'c1', name: 'Zz Cy', linkedin_url: 'http://www.linkedin.com/in/zz-cy/' }).linkedin_url, 'https://www.linkedin.com/in/zz-cy');
});
