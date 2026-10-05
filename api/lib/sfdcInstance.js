// The SFDC routes take the instance URL from the browser and send requests
// to it server-side, so an unchecked value turns them into a proxy into
// Render's network. Real org URLs (incl. sandboxes and My Domain) all sit
// under these Salesforce-owned domains.
const SALESFORCE_DOMAINS = ['salesforce.com', 'force.com', 'cloudforce.com'];

export function isSalesforceInstance(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return SALESFORCE_DOMAINS.some(d => host.endsWith(`.${d}`));
}
