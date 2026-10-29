// hkos-inbox-v1 (I1 prefs, coder's pick: localStorage, no migration). prospector_hk_inbox_images = '1' when remote
// images should load by default; absent or anything else = blocked until Show images is clicked on a thread.
export const IMAGES_KEY = 'prospector_hk_inbox_images';

export function imagesDefault() {
  try { return localStorage.getItem(IMAGES_KEY) === '1'; } catch { return false; }
}
export function setImagesDefault(on) {
  try { localStorage.setItem(IMAGES_KEY, on ? '1' : '0'); } catch {}
}

export const gmailThreadUrl = (email, threadId) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${encodeURIComponent(threadId)}`;

export const CHIP_TONE = { tracked: 'green', matches: 'blue', team: 'lilac', untracked: 'mustard', not_tracked: 'grey', self: 'grey', calendar: 'blue' };
export const STATUS_LABEL = { candidate: 'Candidate', claimed: 'Claimed', drafted: 'Drafted', sent: 'Sent', bumped: 'Bumped', final_sent: 'Final sent', replied: 'Replied', meeting: 'Meeting', signed: 'Signed', passed: 'Passed', skipped: 'Skipped', sponsor: 'Sponsor' };
export const REPLY_LABEL = { interested: 'Interested', pricing: 'Pricing', referral: 'Referral', decline: 'Decline', auto_reply: 'Auto reply', prefers_email: 'Prefers email', new_thread: 'New thread', other: 'Other' };

// hkos-inbox-v2 L4 / L5 - the intel card's words for the Analyze result.
export const KIND_LABEL = { sponsor_interest: 'Sponsor interest', partnership: 'Partnership', vendor_pitch: 'Vendor pitch', press: 'Press', customer: 'Customer', personal: 'Personal', spam_or_marketing: 'Marketing', other: 'Other' };
export const FIT_LABEL = { strong: 'Strong fit', possible: 'Possible fit', weak: 'Weak fit', not_a_fit: 'Not a fit' };
export const FIT_TONE = { strong: 'green', possible: 'blue', weak: 'mustard', not_a_fit: 'grey' };
export const NEXT_LABEL = { track_as_brand: 'Track as brand', reply_in_gmail: 'Reply in Gmail', ignore_sender: 'Ignore sender', no_action: 'No action' };
export const CHICAGO_LABEL = { yes: 'In Chicago', no: 'Not in Chicago', unknown: 'Chicago unknown' };
export const usd = n => (n == null ? '' : `$${Number(n) < 0.01 ? Number(n).toFixed(3) : Number(n).toFixed(2)}`);

export const fmtDate = iso => {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
