// Phone numbers never leave the model's reply into a saved row. A
// YYYY-MM-DD date also matches the phone shape, and task text / reasons
// must keep the dates they cite.
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const ISO_DATE = /^\s*\d{4}-\d{2}-\d{2}\s*$/;

export const scrubPhones = s => s.replace(PHONE, m => (ISO_DATE.test(m) ? m : '[number removed]'));
