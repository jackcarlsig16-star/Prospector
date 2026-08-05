// Parses 6sense "Daily Top Accounts" alert emails into structured account objects.
// Update splitIntoSections() or parseSection() if the actual email format differs —
// this is written against the common 6sense HTML alert template but hasn't been
// validated against a live sample yet.

import { COMPANY_EMAIL_DOMAIN } from '../constants/appConfig';

const BUYING_STAGES = new Set(['Purchase', 'Decision', 'Consideration', 'Target', 'Awareness']);
const SKIP_DOMAINS  = new Set([
  '6sense.com',COMPANY_EMAIL_DOMAIN,'gmail.com','google.com','apple.com','microsoft.com',
  'cloudfront.net','amazonaws.com','mailchimp.com','sendgrid.net','sparkpost.com',
  'images.com','tracking.com','pixel.com',
]);

export function intentWeightForUrl(url = '') {
  const u = url.toLowerCase();
  if (u.includes('/pricing') || u.includes('/demo')) return 3;
  if (u.includes('/products') || u.includes('/solutions')) return 2;
  return 1;
}

export function labelForUrl(url = '') {
  const u = url.toLowerCase();
  if (u.includes('pricing'))  return 'pricing page';
  if (u.includes('demo'))     return 'demo page';
  if (u.includes('products')) return 'products page';
  if (u.includes('solutions')) return 'solutions page';
  try {
    const p = new URL(url).pathname;
    return p === '/' ? 'homepage' : p.split('/').filter(Boolean).pop() || 'page';
  } catch { return 'page'; }
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ').trim();
}

function extractDomain(str) {
  const m = str.match(/\b([a-z0-9][a-z0-9\-]{0,61}\.[a-z]{2,6})\b/i);
  return m ? m[1].toLowerCase() : null;
}

function parseSection(section, date) {
  const text = stripHtml(section);
  if (text.length < 30) return null;

  const domain = extractDomain(text);
  if (!domain || SKIP_DOMAINS.has(domain)) return null;
  if (domain.includes('pixel') || domain.includes('track') || domain.includes('click')) return null;

  // Name: largest capitalized phrase before the domain
  const domainIdx = text.indexOf(domain);
  const beforeDomain = text.slice(0, domainIdx);
  const nameMatch = beforeDomain.match(/([A-Z][A-Za-z0-9\s&,\.]{1,40})\s*$/);
  const name = nameMatch ? nameMatch[1].trim() : domain.split('.')[0];

  const stageMatch = text.match(/\b(Purchase|Decision|Consideration|Target|Awareness)\b/i);
  const buyingStage = stageMatch ? stageMatch[1] : 'Target';

  const fitMatch = text.match(/\b(Very Strong|Strong|Moderate|Weak)\b(?:\s+Fit)?/i);
  const profileFit = fitMatch ? fitMatch[1] : 'Moderate';

  const contactMatch = text.match(/(\d+)\s*Known\s*Contact/i);
  const knownContacts = contactMatch ? parseInt(contactMatch[1], 10) : 0;

  const activities = [];

  // Web visits: own-domain URLs from raw HTML (before stripping)
  const urlRe = new RegExp(`href=["'](https?://${COMPANY_EMAIL_DOMAIN.replace(/\./g,'\\.')}[^"'\\s>]*)`, 'gi');
  let um;
  while ((um = urlRe.exec(section)) !== null) {
    activities.push({
      type: 'webVisit',
      url: um[1],
      label: labelForUrl(um[1]),
      intentWeight: intentWeightForUrl(um[1]),
    });
  }

  // Intent keywords: "keyword · N searches" or "keyword | N activities"
  const kwRe = /([A-Za-z][A-Za-z0-9\s\-]{1,25}?)\s*[·•|]\s*(\d+)\s*(?:searches?|activities?|intent\s*signals?)/gi;
  let km;
  while ((km = kwRe.exec(text)) !== null) {
    const keyword = km[1].trim();
    if (keyword.length >= 2 && !BUYING_STAGES.has(keyword)) {
      activities.push({ type: 'intentActivity', keyword, count: parseInt(km[2], 10), intentWeight: 2 });
    }
  }

  // Contact engagement
  if (/contact\s+(?:engaged?|clicked?|visited?)/i.test(text)) {
    activities.push({ type: 'contactEngagement', intentWeight: 2 });
  }

  return { name, domain, buyingStage, profileFit, activities, knownContacts, date };
}

export function parse6senseEmail(rawBody, date = new Date().toISOString().slice(0, 10)) {
  // Split on likely account-section dividers in 6sense's table-based HTML
  const sections = rawBody.includes('<')
    ? rawBody.split(/<(?:tr|table)[^>]*>/i)
    : rawBody.split(/\n{3,}/);

  const seen    = new Set();
  const results = [];
  for (const section of sections) {
    const acc = parseSection(section, date);
    if (acc && !seen.has(acc.domain)) {
      seen.add(acc.domain);
      results.push(acc);
    }
  }
  return results;
}
