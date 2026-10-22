import './globals.css';
import Link from 'next/link';
import { brand } from '@/lib/settings';
import { getBlob } from '@/lib/db';
import { currentActor } from '@/lib/access';
import { portalConfig } from '@/lib/shopify-portal';

export const metadata = { title: 'Avery Quote Tool', description: 'Compare competitor quotes against Avery LED pricing' };
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }) {
  const b = brand();
  const actor = await currentActor().catch(() => null);
  const hasLogo = !!getBlob('logo');
  return (
    <html lang="en">
      <body style={{ '--brand': b.brandColor, '--accent': b.accentColor }}>
        <header className="topbar no-print">
          <Link href={actor?.type === 'admin' ? '/' : '/m'} className="wordmark">
            {hasLogo ? <img src="/api/logo" alt={b.companyName} className="on-white" /> : <img src="/avery-logo-light.png" alt={b.companyName} />}
            <em>Quote Tool</em>
          </Link>
          {actor && <nav>
            {actor.type === 'admin' && <Link href="/">All quotes</Link>}
            <Link href="/m">My quotes</Link>
            {actor.type === 'admin' && <>
              <Link href="/compatibility">Compatibility list</Link>
              <Link href="/catalog">Catalog</Link>
              <Link href="/settings">Settings</Link>
              <Link href="/insights">Team learning</Link>
            </>}
            <a href={portalConfig().storefront}>averyled.com</a>
            <form action="/member/signout" method="post" style={{ display: 'inline' }}><button type="submit" className="linklike">Sign out</button></form>
          </nav>}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
