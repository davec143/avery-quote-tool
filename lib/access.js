// Who is making this request: the team (shared password) or an approved Avery member (Shopify login).
// Every member read or write of a quote goes through requireQuoteAccess, which checks ownership.
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { validSession } from './session.js';
import { MEMBER_COOKIE, verifyMemberSession } from './member-session.js';
import { memberAccess, portalConfig } from './shopify-portal.js';
import { db } from './db.js';

export async function currentActor() {
  const jar = await cookies();
  const password = process.env.APP_PASSWORD;
  if (!password && process.env.NODE_ENV !== 'production') return { type: 'staff' };
  if (password && await validSession(jar.get('aq_session')?.value, password)) return { type: 'staff' };
  const customerId = await verifyMemberSession(jar.get(MEMBER_COOKIE)?.value);
  if (!customerId) return null;
  // Removing the approve tag in Shopify ends access within a minute, even inside an existing session.
  const access = await memberAccess(customerId);
  if (access.state !== 'approved') return null;
  return { type: 'member', customerId, member: access.member };
}

const storefrontLogin = () => `${portalConfig().storefront}${portalConfig().proxyPath}`;

/** Members only (for /m pages). Team members are sent to the team home page. */
export async function requireMember() {
  const actor = await currentActor();
  if (actor?.type === 'member') return actor;
  if (actor?.type === 'staff') redirect('/');
  redirect(storefrontLogin());
}

/** Staff, or the member who owns this quote. Anyone else gets "not found", never another member's data. */
export async function requireQuoteAccess(id) {
  const actor = await currentActor();
  if (!actor) redirect(storefrontLogin());
  if (actor.type === 'staff') return actor;
  const owner = db().prepare('SELECT shopify_customer_id FROM quotes WHERE id=?').get(Number(id))?.shopify_customer_id;
  if (!owner || owner !== actor.customerId) notFound();
  return actor;
}

/** Same check for route handlers, which answer with status codes instead of redirects. */
export async function quoteAccessForRoute(id) {
  const actor = await currentActor();
  if (!actor) return null;
  if (actor.type === 'staff') return actor;
  const owner = db().prepare('SELECT shopify_customer_id FROM quotes WHERE id=?').get(Number(id))?.shopify_customer_id;
  return owner && owner === actor.customerId ? actor : null;
}
