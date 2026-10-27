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

export const CHIP_TONE = { tracked: 'green', matches: 'blue', team: 'lilac', untracked: 'mustard', not_tracked: 'grey' };
export const STATUS_LABEL = { candidate: 'Candidate', claimed: 'Claimed', drafted: 'Drafted', sent: 'Sent', bumped: 'Bumped', final_sent: 'Final sent', replied: 'Replied', meeting: 'Meeting', signed: 'Signed', passed: 'Passed', skipped: 'Skipped', sponsor: 'Sponsor' };
export const REPLY_LABEL = { interested: 'Interested', pricing: 'Pricing', referral: 'Referral', decline: 'Decline', auto_reply: 'Auto reply', prefers_email: 'Prefers email', new_thread: 'New thread', other: 'Other' };

export const fmtDate = iso => {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
