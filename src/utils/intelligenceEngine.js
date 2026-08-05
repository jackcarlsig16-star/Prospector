// Extracts what should propagate from a debrief result to the account object.
// Isolated here so the extraction logic is swappable without touching AccountCard.

export function extractIntelligenceFromCall(callResult, account) {
  const products = (callResult.productsDiscussed || [])
    .filter(p => p.interestLevel !== "None")
    .map(p => p.product)
    .filter(Boolean);

  const useCases = (callResult.useCases || []).filter(Boolean);
  const signals  = (callResult.keySignals || []).filter(Boolean);

  const mergedProds = products.length
    ? [...new Set([...(account.prods || []), ...products])]
    : null;

  const mergedUcs = useCases.length
    ? [...new Set([...(account.ucs || []), ...useCases])]
    : null;

  const mergedSigs = signals.length
    ? [...new Set([...(account.sigs || []), ...signals])]
    : null;

  const newlyDetectedProds = products.filter(p => !(account.prods || []).includes(p));

  // Persona auto-extract: upsert prospect-company contacts only
  const existingPersonas = account.personas || [];
  const existingByName = new Map(
    existingPersonas.map((p, i) => [String(p?.name || '').toLowerCase(), i])
  );
  const mergedPersonas = [...existingPersonas];
  let personasChanged = false;
  (callResult.contacts || []).forEach(c => {
    if (!c || c.company !== 'prospect') return;
    const name = String(c.name || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    const idx = existingByName.get(key);
    if (idx == null) {
      mergedPersonas.push({ name, title: c.title || '' });
      existingByName.set(key, mergedPersonas.length - 1);
      personasChanged = true;
    } else {
      const existing = mergedPersonas[idx];
      if ((!existing.title || !String(existing.title).trim()) && c.title) {
        mergedPersonas[idx] = { ...existing, title: c.title };
        personasChanged = true;
      }
    }
  });

  return {
    mergedProds,
    mergedUcs,
    mergedSigs,
    mergedPersonas: personasChanged ? mergedPersonas : null,
    newlyDetectedProds,
    medpiccUpdates: callResult.medpiccUpdates || {},
  };
}
