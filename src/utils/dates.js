export function daysSinceIso(isoString) {
  if (!isoString) return null;
  return Math.floor((Date.now() - new Date(isoString).getTime()) / 86400000);
}
