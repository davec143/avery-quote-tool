import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (v) => createHash('sha256').update(String(v)).digest();
/** Constant-time password comparison (hashing first makes the lengths equal). */
export function passwordMatches(input, expected) {
  return !!expected && timingSafeEqual(digest(input), digest(expected));
}

/** In-memory login throttle: after `max` failures in `windowMs`, further attempts are refused until the window passes. */
const failures = new Map();
export function loginBlocked(key, now = Date.now(), { max = 8, windowMs = 15 * 60 * 1000 } = {}) {
  const recent = (failures.get(key) || []).filter((t) => now - t < windowMs);
  failures.set(key, recent);
  return recent.length >= max;
}
export function recordLoginFailure(key, now = Date.now()) {
  failures.set(key, [...(failures.get(key) || []), now]);
}
export function clearLoginFailures(key) {
  failures.delete(key);
}
