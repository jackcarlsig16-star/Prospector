// assay-citation-leak-and-raw-edit-dual-write-v1 Fix 1 - a leaf file
// deliberately (zero imports), so it's safely importable from both browser
// code (via src/utils/assay.js) and server routes (api/email.js) without
// hitting the extension-less-relative-import resolution issue found earlier
// today in constants/industries.js - only leaf files (no further imports,
// like config/models.js) resolve under api/email.js's plain-Node ESM
// runtime.

// Strips Claude's own web_search citation markup (<cite index="X-Y">...</cite>
// and variants) that occasionally leaks into model output despite an
// explicit prompt instruction not to include it. Removes only the tags,
// keeps the real wrapped content - the text inside <cite> tags is genuine,
// grounded content, not junk to discard.
export function stripCitationMarkup(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/<\/?cite[^>]*>/gi, '').replace(/ {2,}/g, ' ').trim();
}
