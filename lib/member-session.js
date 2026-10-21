// Member sign-in for quote.averyled.com, derived from the member's Shopify login.
// averyled.com/apps/quote (Shopify-signed) issues a 5-minute hand-off token; /member/enter exchanges it for
// a 12-hour signed cookie. Web Crypto only, so middleware (edge) and server code share the same checks.
const enc = new TextEncoder();
export const MEMBER_COOKIE = 'aq_member';
export const MEMBER_SESSION_SECONDS = 12 * 60 * 60;
export const HANDOFF_SECONDS = 5 * 60;

const secret = () => (process.env.MEMBER_SESSION_SECRET || process.env.SHOPIFY_API_SECRET || '').trim();
const keyCache = new Map();
async function key(purpose) {
  const s = secret();
  if (!s) return null;
  const id = `${purpose}:${s}`;
  if (!keyCache.has(id)) keyCache.set(id, await crypto.subtle.importKey('raw', enc.encode(`avery-member-${purpose}-v1:${s}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
  return keyCache.get(id);
}
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/../g).map((x) => parseInt(x, 16)));

async function sign(purpose, customerId, ttlSeconds, now) {
  const k = await key(purpose);
  if (!k || !/^\d{1,20}$/.test(String(customerId))) return null;
  const payload = `${customerId}.${Math.floor(now / 1000) + ttlSeconds}.${crypto.randomUUID()}`;
  return `${payload}.${hex(await crypto.subtle.sign('HMAC', k, enc.encode(payload)))}`;
}
async function verify(purpose, token, maxTtl, now) {
  const k = await key(purpose);
  if (!k || typeof token !== 'string') return null;
  const [customerId, expiry, nonce, signature, ...extra] = token.split('.');
  if (extra.length || !/^\d{1,20}$/.test(customerId || '') || !/^\d+$/.test(expiry || '') || !/^[a-f0-9-]{36}$/.test(nonce || '') || !/^[a-f0-9]{64}$/.test(signature || '')) return null;
  const seconds = Number(expiry) - now / 1000;
  if (seconds <= 0 || seconds > maxTtl + 5) return null;
  return (await crypto.subtle.verify('HMAC', k, unhex(signature), enc.encode(`${customerId}.${expiry}.${nonce}`))) ? customerId : null;
}

export const memberHandoffToken = (customerId, now = Date.now()) => sign('handoff', customerId, HANDOFF_SECONDS, now);
export const verifyMemberHandoff = (token, now = Date.now()) => verify('handoff', token, HANDOFF_SECONDS, now);
export const memberSessionToken = (customerId, now = Date.now()) => sign('session', customerId, MEMBER_SESSION_SECONDS, now);
export const verifyMemberSession = (token, now = Date.now()) => verify('session', token, MEMBER_SESSION_SECONDS, now);

/** Paths a signed-in member may request. Everything else (catalog, settings, team pages) stays team-only. */
export function memberPathAllowed(pathname) {
  return /^\/m(\/.*)?$/.test(pathname)
    || /^\/quotes\/\d+(\/summary)?$/.test(pathname)
    || /^\/api\/quotes\/\d+\/(pdf|bom)$/.test(pathname)
    || pathname === '/api/logo'
    || pathname === '/member/signout';
}
/** Where /member/enter may send a member after sign-in. */
export function safeMemberNext(value) {
  return typeof value === 'string' && (/^\/m(\/[a-z0-9-]*)?$/.test(value) || /^\/quotes\/\d+(\/summary)?$/.test(value)) ? value : '/m';
}
