// Member access for the customer portal served through a Shopify App Proxy (averyled.com/apps/quote).
// Shopify signs every proxied request and adds logged_in_customer_id. The app then checks the customer's
// tags with the Admin API, so access is enforced here, not only by hidden theme elements.
import crypto from 'node:crypto';

const env = (name, fallback = '') => (process.env[name] ?? '').trim() || fallback;
export const portalConfig = () => ({
  secret: env('SHOPIFY_API_SECRET'),
  clientId: env('SHOPIFY_CLIENT_ID'),
  adminToken: env('SHOPIFY_ADMIN_TOKEN'),
  store: env('SHOPIFY_STORE_DOMAIN').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
  apiVersion: env('SHOPIFY_API_VERSION', '2026-07'),
  approvedTag: env('PORTAL_APPROVED_TAG', 'approve').toLowerCase(),
  adminTag: env('PORTAL_ADMIN_TAG', 'quote-admin').toLowerCase(),
  storefront: env('PORTAL_STOREFRONT_URL', 'https://averyled.com').replace(/\/+$/, ''),
  proxyPath: env('PORTAL_PROXY_PATH', '/apps/quote').replace(/\/+$/, ''),
  appOrigin: env('PORTAL_APP_ORIGIN', 'https://quote.averyled.com').replace(/\/+$/, ''),
  maxAgeSeconds: Number(env('PORTAL_SIGNATURE_MAX_AGE', '600')) || 600,
});
export const portalConfigured = (c = portalConfig()) => !!(c.secret && c.store && (c.adminToken || c.clientId));

const safeEqualHex = (a, b) => typeof a === 'string' && typeof b === 'string' && /^[a-f0-9]{64}$/i.test(a) && a.length === b.length
  && crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const hmac = (secret, message) => crypto.createHmac('sha256', secret).update(message).digest('hex');

/** Shopify app proxy signature: sorted key=value pairs (repeated values joined by commas), no separators. */
export function proxySignature(searchParams, secret) {
  const grouped = new Map();
  for (const [key, value] of searchParams) if (key !== 'signature') grouped.set(key, [...(grouped.get(key) || []), value]);
  const message = [...grouped.keys()].sort().map((k) => `${k}=${grouped.get(k).join(',')}`).join('');
  return hmac(secret, message);
}

/** Returns the verified proxy context, or null. Never trust logged_in_customer_id without this. */
export function verifyProxyRequest(searchParams, { config = portalConfig(), now = Date.now() } = {}) {
  if (!config.secret) return null;
  const signature = searchParams.get('signature');
  if (!safeEqualHex(signature, proxySignature(searchParams, config.secret))) return null;
  const timestamp = Number(searchParams.get('timestamp'));
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > config.maxAgeSeconds) return null;
  const shop = searchParams.get('shop') || '';
  if (config.store && shop !== config.store) return null;
  const customerId = searchParams.get('logged_in_customer_id') || '';
  if (customerId && !/^\d{1,20}$/.test(customerId)) return null;
  const prefix = searchParams.get('path_prefix') || '/apps/quote';
  return { shop, customerId, prefix: /^\/apps\/[a-z0-9_-]+(\/[a-z0-9_-]+)?$/i.test(prefix) ? prefix : '/apps/quote' };
}

let tokenCache = null;
async function adminAccessToken(config, fetcher) {
  if (config.adminToken) return config.adminToken;
  if (tokenCache && tokenCache.store === config.store && tokenCache.expires > Date.now()) return tokenCache.token;
  const response = await fetcher(`https://${config.store}/admin/oauth/access_token`, {
    // Client credentials grant: Dev Dashboard app installed on a store in the same Shopify organization.
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.secret }).toString(),
    signal: AbortSignal.timeout(10000), cache: 'no-store',
  });
  const body = response.ok ? await response.json() : null;
  if (!body?.access_token) throw new Error('Shopify access token unavailable');
  const seconds = Number(body.expires_in) || 3600;
  tokenCache = { store: config.store, token: body.access_token, expires: Date.now() + Math.max(60, seconds - 300) * 1000 };
  return tokenCache.token;
}

async function adminQuery(query, variables, config, fetcher) {
  const token = await adminAccessToken(config, fetcher);
  const response = await fetcher(`https://${config.store}/admin/api/${config.apiVersion}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10000), cache: 'no-store',
  });
  if (response.status === 401) tokenCache = null;
  if (!response.ok) throw new Error(`Shopify Admin API ${response.status}`);
  return response.json();
}

const memberCache = new Map();
/**
 * guest: not signed in · pending: signed in without the approved tag · approved · unavailable: could not verify (fail closed).
 * Profile fields are optional: they need Shopify protected customer data access; tags alone decide access.
 */
export async function memberAccess(customerId, { config = portalConfig(), fetcher = fetch, fresh = false, ttlMs = 60000 } = {}) {
  if (!customerId) return { state: 'guest' };
  const cached = memberCache.get(customerId);
  if (!fresh && cached && cached.expires > Date.now()) return cached.value;
  let value;
  try {
    const gid = `gid://shopify/Customer/${customerId}`;
    const tags = await adminQuery('query MemberTags($id: ID!) { customer(id: $id) { id tags } }', { id: gid }, config, fetcher);
    const customer = tags?.data?.customer;
    if (!customer || !Array.isArray(customer.tags)) throw new Error('Customer not found');
    const tagList = customer.tags.map((t) => String(t).trim().toLowerCase());
    const approved = tagList.includes(config.approvedTag);
    // Admins see every quote and the team pages. The admin tag only counts on an approved account.
    const member = { id: customerId, name: '', email: '', company: '', admin: approved && tagList.includes(config.adminTag) };
    if (approved) {
      try {
        const profile = await adminQuery('query MemberProfile($id: ID!) { customer(id: $id) { displayName defaultEmailAddress { emailAddress } defaultAddress { company } } }', { id: gid }, config, fetcher);
        const p = profile?.data?.customer;
        if (p) Object.assign(member, { name: p.displayName || '', email: p.defaultEmailAddress?.emailAddress || '', company: p.defaultAddress?.company || '' });
      } catch { /* Name and email are conveniences for the team; access is already decided by tags. */ }
    }
    value = { state: approved ? 'approved' : 'pending', member };
  } catch {
    // Brief negative cache: during a Shopify outage, don't hit the Admin API on every page and asset request.
    const value = { state: 'unavailable' };
    if (memberCache.size >= 5000) memberCache.delete(memberCache.keys().next().value);
    memberCache.set(customerId, { value, expires: Date.now() + Math.min(ttlMs, 10000) });
    return value;
  }
  if (memberCache.size >= 5000) memberCache.delete(memberCache.keys().next().value);
  memberCache.set(customerId, { value, expires: Date.now() + ttlMs });
  return value;
}
export function clearMemberCache() { memberCache.clear(); tokenCache = null; }

/** Startup diagnostic: token grant, shop identity, and whether customer tags are readable. No personal data is returned. */
export async function portalCheck({ config = portalConfig(), fetcher = fetch } = {}) {
  if (!portalConfigured(config)) return 'skipped: portal not configured';
  const body = await adminQuery(`query PortalCheck($q: String!) { shop { myshopifyDomain }
    sample: customers(first: 1, query: $q) { nodes { tags } } }`, { q: `tag:${config.approvedTag}` }, config, fetcher);
  if (body?.errors?.length) return `error: ${body.errors.map((e) => e.message).join('; ').slice(0, 300)}`;
  const d = body?.data || {};
  const nodes = d.sample?.nodes;
  const found = Array.isArray(nodes) && nodes.length > 0;
  const tagged = found && nodes[0].tags.some((t) => String(t).trim().toLowerCase() === config.approvedTag);
  return `ok: shop=${d.shop?.myshopifyDomain} approvedCustomerFound=${found} tagMatches=${tagged} apiVersion=${config.apiVersion}`;
}
