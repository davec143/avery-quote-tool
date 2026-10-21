// Member portal data: every read is scoped to the verified Shopify customer ID.
import { db } from './db.js';
import { createQuoteFromSource, getQuote, summaryDocument } from './quotes.js';
import { recordEvent } from './history.js';
import { todayEastern } from './readiness.js';

export const MEMBER_DAILY_LIMIT = 10;
export const MEMBER_DAILY_AI_RUNS = 40;

export const MEMBER_MAX_LINES = 300;
const usageCount = (customerId, kind) => db().prepare("SELECT COUNT(*) AS n FROM member_usage WHERE customer_id=? AND kind=? AND created_at>=datetime('now','-1 day')").get(String(customerId), kind).n;
/** Atomically reserves `count` uses of `kind` if that stays within `limit` for the last 24 hours. */
export function reserveMemberUsage(customerId, kind, count, limit) {
  const d = db();
  return d.transaction(() => {
    if (usageCount(customerId, kind) + count > limit) return false;
    const ins = d.prepare('INSERT INTO member_usage (customer_id, kind) VALUES (?, ?)');
    for (let i = 0; i < count; i++) ins.run(String(customerId), kind);
    return true;
  }).immediate();
}
/** Re-reads and re-matches by a member in the last 24 hours (each one calls the AI provider). */
export const memberAiRunsToday = (customerId) => usageCount(customerId, 'ai');
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

/** Uploads and copies by a member in the last 24 hours, including quotes they later deleted. */
export const memberSubmissionsToday = (customerId) => usageCount(customerId, 'upload');

/** Creates one reviewed-by-team quote per file, attributed to the member. Matching runs exactly as for staff uploads. */
export async function createMemberQuotes(member, files, { project = '', note = '' } = {}) {
  const ids = [];
  for (const { name, buffer } of files) {
    // Owner is stamped at insert, so the quote is never briefly ownerless while the AI reads it.
    const id = await createQuoteFromSource(name, buffer, { owner: member.id });
    const d = db();
    d.transaction(() => {
      const fallbackCustomer = clip(member.company || member.name, 200);
      d.prepare(`UPDATE quotes SET shopify_customer_id=?, portal_status='submitted', portal_customer_name=?, portal_customer_email=?,
        portal_company=?, portal_project=?, portal_note=?,
        customer=CASE WHEN COALESCE(customer,'')='' THEN ? ELSE customer END,
        job_name=CASE WHEN ?<>'' THEN ? ELSE job_name END WHERE id=?`)
        .run(String(member.id), clip(member.name, 200), clip(member.email, 200), clip(member.company, 200), clip(project, 200), clip(note, 2000),
          fallbackCustomer, clip(project, 200), clip(project, 200), id);
      const q = d.prepare('SELECT revision FROM quotes WHERE id=?').get(id);
      recordEvent(d, id, q?.revision ?? 0, 'member_submitted', member.name || member.email || `Shopify customer ${member.id}`,
        { shopify_customer_id: String(member.id), project: clip(project, 200), note: clip(note, 2000) });
    })();
    ids.push(id);
  }
  return ids;
}

/** Member-facing status. A member reviews and confirms their own quotes; only confirmed, unexpired proposals can be ordered. */
export function memberState(q, today = todayEastern()) {
  if (q.status === 'error') return { key: 'attention', label: "Couldn't read the file", orderable: false };
  if (q.status === 'processing') return { key: 'processing', label: 'Reading…', orderable: false };
  if (q.status === 'done' && q.summary_snapshot) {
    const validUntil = JSON.parse(q.summary_snapshot).quote?.valid_until || q.valid_until;
    return validUntil && validUntil < today ? { key: 'expired', label: 'Expired', orderable: false } : { key: 'ready', label: 'Confirmed', orderable: true };
  }
  return { key: 'draft', label: 'Draft — review and confirm', orderable: false };
}

export function listMemberQuotes(customerId) {
  return db().prepare(`SELECT q.id, q.created_at, q.filename, q.status, q.summary_snapshot, q.valid_until, q.portal_project, q.job_name, q.quote_number, q.competitor,
    (SELECT COUNT(*) FROM quote_lines l WHERE l.quote_id=q.id) AS line_count
    FROM quotes q WHERE q.shopify_customer_id=? ORDER BY q.id DESC LIMIT 200`).all(String(customerId))
    .map((q) => ({ ...q, state: memberState(q), summary_snapshot: undefined }));
}

/** For ordering on averyled.com: null unless this exact customer owns the quote; document only once confirmed. */
export function memberProposal(customerId, id) {
  if (!customerId || !Number.isSafeInteger(Number(id))) return null;
  const q = getQuote(Number(id));
  if (!q || q.shopify_customer_id !== String(customerId)) return null;
  const state = memberState(q);
  return { quote: q, state, document: q.status === 'done' && q.summary_snapshot ? summaryDocument(q) : null };
}

/** Team view: recent member quotes that are not yet confirmed. */
export function listMemberSubmissions() {
  return db().prepare(`SELECT id, created_at, filename, status, summary_snapshot, portal_customer_name, portal_customer_email, portal_company, portal_project, customer, job_name
    FROM quotes WHERE shopify_customer_id IS NOT NULL AND shopify_customer_id<>'' AND NOT (status='done' AND summary_snapshot IS NOT NULL) ORDER BY id DESC LIMIT 25`).all()
    .map((q) => ({ ...q, state: memberState(q), summary_snapshot: undefined }));
}
