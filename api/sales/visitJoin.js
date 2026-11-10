import { normName } from './intakeMatch.js';

// heat-size-v1 Stage 1 - the company -> latest web_visits row join that Pipeline › People (peopleActivityRoutes) and
// the heat writer (personActivity) share, so a person's "Company visits" column and their visit points read the same
// row: the latest pull per company_key, matched by record (matched_type / matched_id) first, else by the company's
// normalised name. company: { type: 'employer' | 'target' | 'partner' | ..., id, name } | null.
export const VISIT_TYPE = { employer: 'opportunity', target: 'target', partner: 'partner' };

export function visitIndex(visits) {
  const byKey = new Map();
  for (const v of visits) { const cur = byKey.get(v.company_key); if (!cur || v.pulled_on > cur.pulled_on) byKey.set(v.company_key, v); }
  const byMatch = new Map([...byKey.values()].filter(v => v.matched_type && v.matched_id).map(v => [`${v.matched_type}:${v.matched_id}`, v]));
  return company => (company ? (company.id && byMatch.get(`${VISIT_TYPE[company.type]}:${company.id}`)) || byKey.get(normName(company.name)) || null : null);
}
