// Shared helpers for the CallPrepModal call-prep surface.
// Pure functions, no React, no side effects, no localStorage.

// Five-category regex risk detection from MEDPICC + notes + task text.
// Returns [] when acc is null. Each entry: { label, color }.
// Colors are caller-determined — accept a palette to keep this file
// independent of the colors module.
export function inferRisks(acc, tasks = [], palette = {}) {
  if (!acc) return [];
  const red    = palette.red    || '#FF3D60';
  const orange = palette.orange || '#FF9800';
  const gold   = palette.gold   || '#F5B830';

  const m = acc.medpicc || {};
  const accTasks = tasks.filter(t => t.account === acc.name || t.accountId === acc.id);
  const blob = [
    m.decision_process || '', m.metrics || '', m.identify_pain || '',
    m.economic_buyer || '', m.decision_criteria || '', m.champion || '', m.competition || '',
    acc.stage || '', acc.notes || '',
    ...accTasks.map(t => t.text || t.title || ''),
  ].join(' ').toLowerCase();

  const risks = [];
  if (/legal|counsel|redline|nda|procurement|contract.*review|sow|terms.*condition/.test(blob))
    risks.push({ label: 'Legal', color: red });
  if (/budget.*freeze|no budget|financial.*constraint|spend.*hold|budget.*cut|no.*budget|cost.*approval/.test(blob))
    risks.push({ label: 'Financial', color: orange });
  if (/compliance|regulatory|gdpr|ccpa|soc\s*2|audit|data.*residency|regulation/.test(blob))
    risks.push({ label: 'Regulatory', color: orange });
  if (/deadline|end.of.quarter|eoq|launch.*delay|time.*constraint|urgent|timeline.*tight/.test(blob))
    risks.push({ label: 'Timeline', color: gold });
  if (/champion.*left|champion.*depart|no champion|lost.*sponsor|reorg|change.*leadership|new.*vp|new.*cto/.test(blob))
    risks.push({ label: 'Health', color: red });
  return risks;
}

// Split a bullet-formatted string ("• foo\n• bar" or "foo\nbar") into an
// array of cleaned lines. Strips leading bullet glyphs and markdown bold.
export function parseBullets(str) {
  if (!str || typeof str !== 'string') return [];
  return str.split('\n')
    .map(l => l.replace(/^[•\-*]\s*/, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*/g, '').trim())
    .filter(Boolean);
}
