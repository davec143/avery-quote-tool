import './globals.css';
import Link from 'next/link';
import { brand } from '@/lib/settings';
import { getBlob } from '@/lib/db';

export const metadata = { title: 'Avery Quote Tool', description: 'Compare competitor quotes against Avery LED pricing' };
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }) {
  const b = brand();
  const hasLogo = !!getBlob('logo');
  return (
    <html lang="en">
      <body style={{ '--brand': b.brandColor, '--accent': b.accentColor }}>
        <header className="topbar no-print">
          <Link href="/" className="wordmark">
            {hasLogo ? <img src="/api/logo" alt={b.companyName} className="on-white" /> : <img src="/avery-logo-light.png" alt={b.companyName} />}
            <em>Quote Tool</em>
          </Link>
          <nav>
            <Link href="/">Quotes</Link>
            <Link href="/compatibility">Compatibility list</Link>
            <Link href="/catalog">Catalog</Link>
            <Link href="/settings">Settings</Link>
          </nav>
        </header>
        {!process.env.APP_PASSWORD && (
          <div className="banner no-print">No APP_PASSWORD is set, so anyone with the link can open this. Set one before sharing it.</div>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
