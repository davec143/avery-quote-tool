// Member portal data: every read is scoped to the verified Shopify customer ID.
import { db } from './db.js';
import { createQuoteFromSource, getQuote, summaryDocument } from './quotes.js';
import { recordEvent } from './history.js';
import { todayEastern } from './readiness.js';

export const MEMBER_DAILY_LIMIT = 10;
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

export function memberSubmissionsToday(customerId) {
  return db().prepare("SELECT COUNT(*) AS n FROM quotes WHERE shopify_customer_id=? AND created_at>=datetime('now','-1 day')").get(String(customerId)).n;
}

/** Creates one reviewed-by-team quote per file, attributed to the member. Matching runs exactly as for staff uploads. */
export async function createMemberQuotes(member, files, { project = '', note = '' } = {}) {
  const ids = [];
  for (const { name, buffer } of files) {
    const id = await createQuoteFromSource(name, buffer);
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

/** What the member may see. A proposal is visible only after the team publishes a confirmed, frozen summary. */
export function memberState(q, today = todayEastern()) {
  const published = q.portal_status === 'published' && q.status === 'done' && !!q.summary_snapshot;
  if (published) {
    const validUntil = JSON.parse(q.summary_snapshot).quote?.valid_until || q.valid_until;
    return validUntil && validUntil < today ? { key: 'expired', label: 'Expired', viewable: true } : { key: 'ready', label: 'Proposal ready', viewable: true };
  }
  if (q.portal_status === 'published') return { key: 'updating', label: 'Being updated', viewable: false };
  if (q.portal_status === 'withdrawn') return { key: 'withdrawn', label: 'Closed', viewable: false };
  if (q.status === 'error') return { key: 'attention', label: 'Our team will follow up', viewable: false };
  return { key: 'review', label: 'In review', viewable: false };
}

export function listMemberQuotes(customerId) {
  return db().prepare(`SELECT id, created_at, filename, status, summary_snapshot, valid_until, portal_status, portal_project, job_name, portal_published_at
    FROM quotes WHERE shopify_customer_id=? ORDER BY id DESC LIMIT 100`).all(String(customerId))
    .map((q) => ({ ...q, state: memberState(q), summary_snapshot: undefined }));
}

/** Null unless this exact customer owns the quote and it is published. */
export function memberProposal(customerId, id) {
  if (!customerId || !Number.isSafeInteger(Number(id))) return null;
  const q = getQuote(Number(id));
  if (!q || q.shopify_customer_id !== String(customerId)) return null;
  const state = memberState(q);
  if (!state.viewable) return { quote: q, state, document: null };
  return { quote: q, state, document: summaryDocument(q) };
}

export function listMemberSubmissions() {
  return db().prepare(`SELECT id, created_at, filename, status, summary_snapshot, portal_status, portal_customer_name, portal_customer_email, portal_company, portal_project, customer, job_name
    FROM quotes WHERE shopify_customer_id IS NOT NULL AND portal_status IN ('submitted','published') ORDER BY id DESC LIMIT 50`).all()
    .filter((q) => memberState(q).key !== 'ready' && memberState(q).key !== 'expired')
    .map((q) => ({ ...q, state: memberState(q), summary_snapshot: undefined }));
}

export function publishToMember(id, revision, actor) {
  const d = db(), q = d.prepare('SELECT * FROM quotes WHERE id=?').get(id);
  if (!q || Number(revision) !== q.revision) throw new Error('This quote changed. Reload before publishing.');
  if (!q.shopify_customer_id) throw new Error('This quote was not submitted by a member.');
  if (q.status !== 'done' || !q.summary_snapshot) throw new Error('Confirm the comparison before publishing it to the member.');
  if (!String(actor || '').trim()) throw new Error('Enter your name to publish.');
  d.transaction(() => {
    const r = d.prepare("UPDATE quotes SET portal_status='published', portal_published_at=datetime('now'), revision=revision+1 WHERE id=? AND revision=?").run(id, q.revision);
    if (!r.changes) throw new Error('This quote changed. Reload before publishing.');
    recordEvent(d, id, q.revision + 1, 'member_published', actor, { shopify_customer_id: q.shopify_customer_id });
  })();
}

export function unpublishFromMember(id, revision, actor) {
  const d = db(), q = d.prepare('SELECT * FROM quotes WHERE id=?').get(id);
  if (!q || Number(revision) !== q.revision) throw new Error('This quote changed. Reload before unpublishing.');
  if (q.portal_status !== 'published') throw new Error('This proposal is not published.');
  if (!String(actor || '').trim()) throw new Error('Enter your name to unpublish.');
  d.transaction(() => {
    d.prepare("UPDATE quotes SET portal_status='submitted', revision=revision+1 WHERE id=? AND revision=?").run(id, q.revision);
    recordEvent(d, id, q.revision + 1, 'member_unpublished', actor, { shopify_customer_id: q.shopify_customer_id });
  })();
}
