// hkos-daily-check-v1 J3 - the no-Claude follow-up texts: the bump (the carried "single polite nudge referencing the
// prior email and repeating the 15-minute ask", with one rotating angle from the skill's E4), the final off-ramp (the
// skill's E5: warm, a genuine out, the ask stays clear) and the Instagram DM (stats from hk_settings only). Pure; every
// output passes lintDraft with the seeded settings (followupText.test.mjs proves it). Plain hyphens only; first-name
// sign-off; no stats unless hk_settings carries them; the one "member feedback" insight needs a confirmed proof point,
// which hk_settings does not hold, so the insight angle is the verification differentiator instead.
import { replySubject } from './gmailMime.js';

export const ANGLES = ['insight', 'question', 'lighter'];
const hash = s => { let h = 0; for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
export const angleFor = brandId => ANGLES[hash(brandId) % ANGLES.length];
const fmt = n => Number(n).toLocaleString('en-US');
export const greeting = (firstName, brandName) => (firstName ? `Hi ${firstName},` : `Hi ${brandName} team,`);
const CTA = { bump: ['Would you be open to a quick 15-minute call to see if it makes sense?', 'Worth 15 minutes to see what this could look like for [Brand]?', 'Would you be open to 15 minutes next week to see if this could make sense?'], final: ["If any of this sounds interesting, 15 minutes is all I'd need to walk you through it.", 'Worth 15 minutes to see what this could look like for [Brand]?'] };
const cta = (kind, brandName, brandId) => CTA[kind][hash(brandId) % CTA[kind].length].replace('[Brand]', brandName);
const conceptLine = concept => (concept ? `the "${String(concept).replace(/"/g, '').trim()}" idea` : 'the challenge idea');

// Stats sentence only when hk_settings holds both numbers; the lint compares any number in the text to them.
export const statsLine = settings => (settings?.members_stat != null && settings?.completions_stat != null ? `${fmt(settings.members_stat)}+ members and ${fmt(settings.completions_stat)}+ verified challenge completions` : null);

// { brandName, brandId, firstName, concept, ownerFirstName, settings, angle? } -> { subject: null (in-thread), body }
export function bumpText({ brandName, brandId, firstName = null, concept = null, ownerFirstName = 'Jack', angle = null } = {}) {
  const a = angle || angleFor(brandId);
  const value = a === 'insight'
    ? `One thing I did not say last time: every completion is verified with a photo, receipt or check-in, so you would know exactly how many people acted because ${brandName} asked.`
    : a === 'question'
      ? `Quick question: would ${conceptLine(concept)} land better as a sponsored challenge, or as a reward or raffle listing to start?`
      : `If a full challenge is a lot right now, a reward or raffle listing is the lighter way in - members redeem it only after they have earned the points.`;
  const body = [greeting(firstName, brandName), `Bumping this up in case it got buried. I shared ${conceptLine(concept)} for ${brandName} last week and would still love your take.`, value, cta('bump', brandName, brandId), ownerFirstName].join('\n\n');
  return { subject: null, body, angle: a };
}

// The off-ramp: shortest, warm, a genuine out, the ask stays clear.
export function finalText({ brandName, brandId, firstName = null, concept = null, ownerFirstName = 'Jack' } = {}) {
  const body = [greeting(firstName, brandName), `Last note from me on this, and no worries at all if it is not a fit right now. If ${conceptLine(concept)} ever makes sense for ${brandName}, the door stays open.`, cta('final', brandName, brandId), ownerFirstName].join('\n\n');
  return { subject: null, body };
}

// Instagram DM text to copy (no Gmail). Short, direct; stats only from hk_settings.
export function dmText({ brandName, ownerFirstName = 'Jack', settings = {} } = {}) {
  const stats = statsLine(settings);
  const intro = `Hi ${brandName} team! I'm ${ownerFirstName} from HumanKind, a free community wellness app live in Chicago${stats ? ` with ${stats}` : ''}.`;
  const body = [intro, `Members complete weekly real-world challenges and earn rewards from local partners. We would love to have ${brandName} present a challenge, with something of yours as the reward members earn.`, `Would a quick chat make sense? Happy to send details by email too.`].join('\n\n');
  return { subject: null, body };
}

export const followupSubject = priorSubject => replySubject(priorSubject || 'HumanKind');
