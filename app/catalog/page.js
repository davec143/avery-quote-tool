import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { listCatalog, parseShopifyCsv, replaceCatalog, syncFromShopify } from '@/lib/catalog';
import { getSetting } from '@/lib/db';
import { fmt } from '@/lib/quotes';
import SubmitButton from '../submit-button';
import Link from 'next/link';

async function uploadCsv(formData) {
  'use server';
  const f = formData.get('csv');
  if (!f || !f.size) redirect('/catalog?error=Choose a CSV file first');
  const items = parseShopifyCsv(await f.text());
  if (!items.length) redirect('/catalog?error=No priced, active products found in that file. Is it a Shopify product export?');
  replaceCatalog(items, 'csv');
  revalidatePath('/catalog');
  redirect(`/catalog?loaded=${items.length}`);
}

async function sync() {
  'use server';
  let n;
  try {
    n = await syncFromShopify();
  } catch (e) {
    redirect(`/catalog?error=${encodeURIComponent(String(e.message || e))}`);
  }
  revalidatePath('/catalog');
  redirect(`/catalog?loaded=${n}`);
}

export default async function CatalogPage({ searchParams }) {
  const sp = await searchParams;
  const items = listCatalog();
  const hasShopify = !!(getSetting('shopify_domain') && getSetting('shopify_token'));
  const updated = items[0]?.updated_at;

  return (
    <>
      <h1>Avery catalog</h1>
      <p className="muted">
        The products and prices the tool compares against. &ldquo;Price each&rdquo; is the pack price divided by the pieces in the pack (e.g. a $176 case of
        10 = $17.60 each). Change this on the <Link href="/settings">Settings</Link> page.
      </p>
      {sp?.error && <p className="error">{sp.error}</p>}
      {sp?.loaded && <p className="ok">Loaded {sp.loaded} products.</p>}

      <div className="grid2" style={{ marginTop: 16 }}>
        <form action={sync} className="card">
          <h3>Sync from the Avery Shopify store</h3>
          <p className="small muted">
            Pulls active products, variants, prices and specs straight from Shopify.
            {!hasShopify && (
              <>
                {' '}
                Add the store domain and an Admin API token in <Link href="/settings">Settings</Link> first.
              </>
            )}
          </p>
          <SubmitButton label="Sync now" pending="Syncing…" />
        </form>
        <form action={uploadCsv} className="card">
          <h3>Or upload a Shopify product export</h3>
          <p className="small muted">Shopify admin → Products → Export → CSV. Replaces the current catalog. $0, test and sample items are skipped.</p>
          <input type="file" name="csv" accept=".csv,text/csv" required />
          <div style={{ marginTop: 12 }}>
            <SubmitButton label="Upload" pending="Loading…" />
          </div>
        </form>
      </div>

      <h2>
        {items.length} products {updated && <span className="muted small">· last loaded {updated} ({items[0]?.source})</span>}
      </h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product</th>
              <th>Type</th>
              <th>Specs</th>
              <th className="num">Pack price</th>
              <th className="num">Price each</th>
              <th className="num">Stock</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.sku}>
                <td className="small">
                  <b>{i.sku}</b>
                </td>
                <td>
                  {i.title}
                  <div className="small muted">{i.variant}</div>
                </td>
                <td className="small">{i.category}</td>
                <td className="small muted">{[i.cct, i.output_class, i.watts && `${i.watts}W`, i.dimmable === 1 ? 'dimmable' : i.dimmable === 0 ? 'non-dimmable' : null, i.ip_rating].filter(Boolean).join(' · ')}</td>
                <td className="num">
                  {fmt(i.pack_price)}
                  <div className="small muted">{i.pack_qty} pcs</div>
                </td>
                <td className="num">{fmt(i.unit_price)}</td>
                <td className="num">{i.inventory ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
