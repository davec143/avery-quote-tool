import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (v) => createHash('sha256').update(String(v)).digest();
/** Constant-time password comparison (hashing first makes the lengths equal). */
export function passwordMatches(input, expected) {
  return !!expected && timingSafeEqual(digest(input), digest(expected));
}

/** The client address as seen by Railway's edge: the right-most X-Forwarded-For entry can't be forged by the client. */
export function clientAddress(headers) {
  const forwarded = (headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return (headers.get('x-real-ip') || forwarded.at(-1) || 'unknown').slice(0, 64);
}

/**
 * In-memory login throttle: after `max` failures in `windowMs` from one address, further attempts are refused until
 * the window passes. A global ceiling also stops a guessing run spread across many addresses.
 */
const failures = new Map();
const GLOBAL = '*';
const recent = (key, now, windowMs) => (failures.get(key) || []).filter((t) => now - t < windowMs);
export function loginBlocked(key, now = Date.now(), { max = 8, globalMax = 300, windowMs = 15 * 60 * 1000 } = {}) {
  const mine = recent(key, now, windowMs), all = recent(GLOBAL, now, windowMs);
  if (mine.length) failures.set(key, mine); else failures.delete(key);
  failures.set(GLOBAL, all);
  return mine.length >= max || all.length >= globalMax;
}
export function recordLoginFailure(key, now = Date.now(), { windowMs = 15 * 60 * 1000 } = {}) {
  if (failures.size > 10000) for (const [k, times] of failures) if (k !== GLOBAL && !times.some((t) => now - t < windowMs)) failures.delete(k);
  if (failures.size > 10000) for (const k of [...failures.keys()].slice(0, 1000)) if (k !== GLOBAL) failures.delete(k);
  failures.set(key, [...recent(key, now, windowMs), now].slice(-50));
  failures.set(GLOBAL, [...recent(GLOBAL, now, windowMs), now].slice(-1000));
}
export function clearLoginFailures(key) {
  failures.delete(key);
}
