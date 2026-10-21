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
  const member = actor?.type === 'member';
  const hasLogo = !!getBlob('logo');
  return (
    <html lang="en">
      <body style={{ '--brand': b.brandColor, '--accent': b.accentColor }}>
        <header className="topbar no-print">
          <Link href={member ? '/m' : '/'} className="wordmark">
            {hasLogo ? <img src="/api/logo" alt={b.companyName} className="on-white" /> : <img src="/avery-logo-light.png" alt={b.companyName} />}
            <em>Quote Tool</em>
          </Link>
          {member ? <nav>
            <Link href="/m">My quotes</Link>
            <a href={portalConfig().storefront}>averyled.com</a>
            <form action="/member/signout" method="post" style={{ display: 'inline' }}><button type="submit" className="linklike">Sign out</button></form>
          </nav> : <nav>
            <Link href="/">Quotes</Link>
            <Link href="/compatibility">Compatibility list</Link>
            <Link href="/catalog">Catalog</Link>
            <Link href="/settings">Settings</Link>
            <Link href="/insights">Team learning</Link>
          </nav>}
        </header>
        {!member && !process.env.APP_PASSWORD && (
          <div className="banner no-print">No APP_PASSWORD is set, so anyone with the link can open this. Set one before sharing it.</div>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
