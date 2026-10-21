import { MEMBER_COOKIE, MEMBER_MARKER } from '@/lib/member-session';
import { portalConfig } from '@/lib/shopify-portal';

export const dynamic = 'force-dynamic';

export async function POST() {
  const headers = new Headers({ Location: portalConfig().storefront });
  for (const name of [MEMBER_COOKIE, MEMBER_MARKER]) headers.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return new Response(null, { status: 303, headers });
}
