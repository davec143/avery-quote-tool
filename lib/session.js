const bytes = new TextEncoder();
async function key(password) {
  // An optional SESSION_SECRET keeps the signing key independent of the (guessable) team password.
  const secret = process.env.SESSION_SECRET;
  return crypto.subtle.importKey('raw', bytes.encode(secret ? `avery-session-v2:${secret}:${password}` : `avery-session-v2:${password}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sessionToken(password, now = Date.now()) {
  const payload = `${now + 1000 * 60 * 60 * 24 * 7}.${crypto.randomUUID()}`;
  return `${payload}.${hex(await crypto.subtle.sign('HMAC', await key(password), bytes.encode(payload)))}`;
}
export async function validSession(token, password, now = Date.now()) {
  if (!token || !password) return false;
  const [expiry, nonce, signature, ...extra] = token.split('.');
  if (extra.length || !/^\d+$/.test(expiry || '') || !/^[a-f0-9-]{36}$/.test(nonce || '') || !/^[a-f0-9]{64}$/.test(signature || '')) return false;
  if (Number(expiry) <= now || Number(expiry) > now + 1000 * 60 * 60 * 24 * 7) return false;
  return crypto.subtle.verify('HMAC', await key(password), new Uint8Array(signature.match(/../g).map((s) => parseInt(s, 16))), bytes.encode(`${expiry}.${nonce}`));
}
export function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value) ? value : '/';
}
