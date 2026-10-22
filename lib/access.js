// Who is making this request. Everyone signs in with their averyled.com (Shopify) account:
//   member — an approved partner (customer tag `approve`); sees and edits only their own quotes
//   admin  — a member who also carries the admin tag (`quote-admin`); sees every quote and the team pages
// Access is re-checked against Shopify tags every minute, so removing a tag ends access within a minute.
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { MEMBER_COOKIE, verifyMemberSession } from './member-session.js';
import { memberAccess, portalConfig } from './shopify-portal.js';
import { db } from './db.js';

export async function currentActor() {
  const jar = await cookies();
  const customerId = await verifyMemberSession(jar.get(MEMBER_COOKIE)?.value);
  if (!customerId) return null;
  const access = await memberAccess(customerId);
  if (access.state !== 'approved') return null;
  return { type: access.member.admin ? 'admin' : 'member', customerId, member: access.member };
}

export const actorName = (actor) => actor?.member?.name || actor?.member?.email || `Shopify customer ${actor?.customerId}`;
const storefrontLogin = () => `${portalConfig().storefront}${portalConfig().proxyPath}`;

/** Any signed-in, approved member (admins included). */
export async function requireMember() {
  const actor = await currentActor();
  if (!actor) redirect(storefrontLogin());
  return actor;
}

/** Admin pages and actions (all quotes, catalog, compatibility list, settings). Members are sent to their own quotes. */
export async function requireAdmin() {
  const actor = await currentActor();
  if (!actor) redirect(storefrontLogin());
  if (actor.type !== 'admin') redirect('/m');
  return actor;
}

/** An admin, or the member who owns this quote. Anyone else gets "not found", never another member's data. */
export async function requireQuoteAccess(id) {
  const actor = await currentActor();
  if (!actor) redirect(storefrontLogin());
  if (actor.type === 'admin') return actor;
  if (!ownsQuote(actor, id)) notFound();
  return actor;
}

/** Same check for route handlers, which answer with status codes instead of redirects. */
export async function quoteAccessForRoute(id) {
  const actor = await currentActor();
  if (!actor) return null;
  return actor.type === 'admin' || ownsQuote(actor, id) ? actor : null;
}

function ownsQuote(actor, id) {
  const owner = db().prepare('SELECT shopify_customer_id FROM quotes WHERE id=?').get(Number(id))?.shopify_customer_id;
  return !!owner && owner === actor.customerId;
}
