import { MEMBER_COOKIE } from '@/lib/member-session';
import { portalConfig } from '@/lib/shopify-portal';

export const dynamic = 'force-dynamic';

export async function POST() {
  return new Response(null, { status: 303, headers: {
    Location: portalConfig().storefront,
    'Set-Cookie': `${MEMBER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  } });
}
