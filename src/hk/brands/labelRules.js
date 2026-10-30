// grow-ui-refresh-v1 U1 - the one label set, as words, from a brand row: every chip is "Label value" so nothing is a
// mystery tag, and every color has its word. Pure; BrandLabels draws them.
export const FIT_WORDS = { strong: 'Strong fit', possible: 'Possible fit', weak: 'Weak fit', not_a_fit: 'Not a fit' };
export const FIT_TONE = { strong: 'green', possible: 'mustard', weak: 'grey', not_a_fit: 'block' };

// Chicago when the brand is local, its category is Chicago, or research says it has a Chicago presence; else National
// (an Illinois brand folds to National - Stage 0 ruling 1).
export const marketOf = b => (b.is_local || String(b.category || '').trim().toLowerCase() === 'chicago' || b.research?.chicago_presence === 'yes' ? 'Chicago' : 'National');

// J6: Industry from research when it has one, else the sheet's Category under its own name.
export const industryOf = b => (b.research?.industry ? { key: 'Industry', value: b.research.industry } : b.category ? { key: 'Category', value: b.category } : null);

export const fitOf = b => (b.research ? { words: FIT_WORDS[b.research.fit] || 'Fit unknown', tone: FIT_TONE[b.research.fit] || 'grey' } : { words: 'Not researched', tone: 'grey' });

// "Contact: Marketing lead" (or "on file") when an address is on file; "No email yet" in the block tint otherwise.
export const contactOf = b => (b.contact?.has_email ? { words: b.contact.title || 'on file', ok: true } : { words: 'No email yet', ok: false });

// The website state beside the name: saved domain · "suggested" · "no website yet".
export const siteOf = b => (b.domain ? { domain: b.domain, state: 'saved' } : b.suggestion?.domain ? { domain: b.suggestion.domain, state: 'suggested' } : { domain: null, state: 'none' });

// The "Why now" line: the scorer's top reasons, then why research says it fits.
export const whyNowOf = b => [...(b.why || []), b.research?.why].filter(Boolean).join(' · ') || 'Nothing stands out yet';
