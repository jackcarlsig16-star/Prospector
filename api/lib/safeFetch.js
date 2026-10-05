import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';

// Server-side fetch for URLs that come from users or third parties (a
// business's website, a link in a creator's bio). Plain fetch() would follow
// a redirect or a DNS answer into Render's private network and hand back
// whatever answered. The address check runs inside the socket's own lookup,
// so the IP that was checked is the IP that gets connected to (no DNS
// rebinding window), and every redirect hop goes through it again.

const MAX_REDIRECTS = 3;

const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 3],
];
const v4ToInt = ip => ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;

// Eight 16-bit groups. A trailing dotted IPv4 becomes the last two groups, so
// ::ffff:127.0.0.1 and ::ffff:7f00:1 (how URL() rewrites it) compare equal.
function expandV6(ip) {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = v4ToInt(dotted[1]);
    s = `${s.slice(0, -dotted[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? null : tail ? tail.split(':') : [];
  const groups = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return groups.map(g => parseInt(g, 16));
}

export function isBlockedAddress(ip) {
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => (n >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits)));
  }
  if (!net.isIPv6(ip)) return true;
  const g = expandV6(ip);
  const embeddedV4 = () => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  // IPv4-compatible (::a.b.c.d, also covers :: and ::1), IPv4-mapped
  // (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) all reach an IPv4 host.
  if (g.slice(0, 5).every(x => x === 0) && (g[5] === 0 || g[5] === 0xffff)) return isBlockedAddress(embeddedV4());
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return isBlockedAddress(embeddedV4());
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00;
}

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const blocked = addresses.find(a => isBlockedAddress(a.address));
    if (blocked) return callback(new Error(`Refusing to fetch a private address (${blocked.address})`));
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

function checkUrl(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Refusing to fetch a ${url.protocol} URL`);
  if (url.username || url.password) throw new Error('Refusing to fetch a URL with credentials');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedAddress(host)) throw new Error(`Refusing to fetch a private address (${host})`);
}

function requestOnce(url, headers, signal, maxBytes) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, { headers, lookup: guardedLookup, signal }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve({ status: res.statusCode, location: res.headers.location });
      }
      const chunks = [];
      let size = 0;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') });
      };
      // Past the cap, keep what arrived and drop the connection - callers
      // only ever use the first few KB.
      res.on('data', chunk => {
        if (size >= maxBytes) return;
        chunks.push(chunk.subarray(0, maxBytes - size));
        size += chunk.length;
        if (size >= maxBytes) { finish(); res.destroy(); }
      });
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', err => { if (!settled) reject(err); });
    });
    req.on('error', reject);
    req.end();
  });
}

// Resolves to { ok, status, text, url } (url = final URL after redirects).
// Throws on a refused address/scheme, too many redirects, network error or timeout.
export async function safeFetchText(input, { headers = {}, timeoutMs = 10000, maxBytes = 1_000_000 } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = new URL(input);
  for (let hop = 0; ; hop++) {
    checkUrl(url);
    const r = await requestOnce(url, headers, signal, maxBytes);
    if (!r.location) return { ok: r.status >= 200 && r.status < 300, status: r.status, text: r.text, url: url.href };
    if (hop >= MAX_REDIRECTS) throw new Error('Too many redirects');
    url = new URL(r.location, url);
  }
}
