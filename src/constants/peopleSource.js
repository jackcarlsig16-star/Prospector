// heat-v2 R5 - the People table's source enum: the row keys (api/sales/peopleRows), their words and glyphs, in the
// table's source order (a merged row shows the first). Read by the server (peopleMerge, Scout) and the table alike.
export const SOURCE_ORDER = ['prospect', 'visitor', 'contact', 'hand', 'upload'];
export const SOURCE_WORD = { prospect: 'Apollo', visitor: 'Website', contact: 'Partner', hand: 'Typed', upload: 'Upload' };
export const SOURCE_GLYPH = { prospect: '➤', visitor: '🌐', contact: '⇄', hand: '✎', upload: '⇡' };
export const SOURCE_GLYPH_BY_WORD = Object.fromEntries(SOURCE_ORDER.map(k => [SOURCE_WORD[k], SOURCE_GLYPH[k]]));
