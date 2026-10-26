// Phone numbers never leave the model's reply into a saved row. A
// YYYY-MM-DD date also matches the phone shape, and task text / reasons
// must keep the dates they cite.
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const ISO_DATE = /^\s*\d{4}-\d{2}-\d{2}\s*$/;

export const scrubPhones = s => s.replace(PHONE, m => (ISO_DATE.test(m) ? m : '[number removed]'));
// Anything that still looks like an address or a phone (a YYYY-MM-DD date is neither).
export const hasPii = s => /@/.test(s) || (s.match(PHONE) || []).some(m => !ISO_DATE.test(m));

// Saved model text: no email addresses, no phone numbers, one line, capped.
const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi;
export const cleanText = (v, max) => (typeof v === 'string' ? scrubPhones(v.replace(EMAIL, '[email removed]'))
  .replace(/\s+/g, ' ').trim().slice(0, max) : '');
// Pasted text before a model sees it: addresses and phones replaced, line breaks kept. A bare "@" stays
// (Apollo writes "VP HR @Acme"), so this is not hasPii.
export const scrubAddresses = s => scrubPhones(String(s).replace(EMAIL, '[email removed]'));
export const hasAddress = s => new RegExp(EMAIL.source, 'i').test(String(s));
