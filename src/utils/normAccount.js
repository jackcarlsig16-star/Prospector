// Account normalization + dedup helpers, shared by DedupeModal (manual
// merge UI) and the Supabase load merge in App.js (silent in-memory pass).

// Strip corporate suffixes and non-alphanumerics so "Acme Inc." and
// "acme" collapse to the same key.
export const normName = (n) => {
  if (!n || typeof n !== 'string') return '';
  return n.toLowerCase()
    .replace(/[,.\s]*(inc|llc|corp|ltd|co|company|technologies|technology|solutions|group|platform|platforms|services|software|labs|ai|io)\.?$/i, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
};

// Resolve a URL string to its bare hostname (no www).
export const normDomain = (w) => {
  if (!w || typeof w !== 'string') return null;
  try {
    const u = w.startsWith('http') ? w : `https://${w}`;
    return new URL(u).hostname.replace(/^www\./, '');
  } catch { return null; }
};

// Heuristic: how much real context does this account carry?
// Used to pick the winner when two accounts dedupe to the same business.
export const contextScore = (acc) => {
  if (!acc) return 0;
  let s = 0;
  if (acc.analyzed)                  s += 20;
  if (acc.tier && acc.tier !== 'Slag') s += 15;
  if (acc.score === 1)               s += 10;
  else if (acc.score === 2)          s += 5;
  if (acc.pf?.length > 20)           s += 10;
  if (acc.bm?.length > 20)           s += 8;
  if (acc.sigs?.length)              s += acc.sigs.length * 2;
  if (acc.prods?.length)             s += acc.prods.length * 2;
  if (acc.handoffNotes?.length > 10) s += 12;
  if (acc.sfdc)                      s += 6;
  if (acc.web)                       s += 4;
  if (acc.vert)                      s += 3;
  if (acc.linkedin)                  s += 2;
  return s;
};

// In-memory dedup pass. Same-business heuristic, priority order:
//   sfdcOppId → sfdcAccountId → normalized name → normalized domain.
// When two accounts collapse, keep the one with the higher contextScore.
// Returns a new array; does NOT mutate.
export const dedupeAccounts = (accounts) => {
  if (!Array.isArray(accounts) || accounts.length < 2) return accounts || [];
  const result = [];
  for (const acc of accounts) {
    const naAcc = normName(acc.name);
    const daAcc = normDomain(acc.web);
    const existingIdx = result.findIndex(existing => {
      if (acc.sfdcOppId && existing.sfdcOppId && acc.sfdcOppId === existing.sfdcOppId) return true;
      if (acc.sfdcAccountId && existing.sfdcAccountId && acc.sfdcAccountId === existing.sfdcAccountId) return true;
      const ne = normName(existing.name);
      if (naAcc && ne && naAcc === ne) return true;
      const de = normDomain(existing.web);
      if (daAcc && de && daAcc === de) return true;
      return false;
    });
    if (existingIdx === -1) {
      result.push(acc);
    } else if (contextScore(acc) > contextScore(result[existingIdx])) {
      result[existingIdx] = acc;
    }
  }
  return result;
};
