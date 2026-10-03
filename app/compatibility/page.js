import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { listCompat, parseCompatCsv, addCompatRows } from '@/lib/compat';
import { catalogBySku } from '@/lib/catalog';
import SubmitButton from '../submit-button';

async function upload(formData) {
  'use server';
  const f = formData.get('csv');
  if (!f || !f.size) redirect('/compatibility?error=Choose a CSV file first');
  const rows = parseCompatCsv(await f.text());
  if (!rows.length) redirect('/compatibility?error=No rows found. Check the file has competitor_sku and avery_sku columns.');
  addCompatRows(rows, String(formData.get('who') || 'upload'), { replace: formData.get('mode') === 'replace' });
  revalidatePath('/compatibility');
  redirect(`/compatibility?added=${rows.length}`);
}

async function addOne(formData) {
  'use server';
  const row = {
    competitor_brand: String(formData.get('competitor_brand') || ''),
    competitor_sku: String(formData.get('competitor_sku') || '').trim(),
    competitor_description: String(formData.get('competitor_description') || ''),
    avery_sku: String(formData.get('avery_sku') || '').trim(),
    notes: String(formData.get('notes') || ''),
  };
  if (!row.competitor_sku || !row.avery_sku) redirect('/compatibility?error=Competitor SKU and Avery SKU are both needed');
  addCompatRows([row], 'manual');
  revalidatePath('/compatibility');
  redirect('/compatibility?added=1');
}

async function remove(formData) {
  'use server';
  const id = formData.get('id');
  if (id === 'all') db().prepare('DELETE FROM compat_rows').run();
  else db().prepare('DELETE FROM compat_rows WHERE id = ?').run(Number(id));
  revalidatePath('/compatibility');
  redirect('/compatibility');
}

export default async function CompatPage({ searchParams }) {
  const sp = await searchParams;
  const rows = listCompat();
  const cat = catalogBySku();
  const skus = Object.values(cat);
  const unknown = rows.filter((r) => !cat[r.avery_sku] && !/^n\/?a$/i.test(r.avery_sku)).length;

  return (
    <>
      <h1>Compatibility list</h1>
      <p className="muted">
        Tells the tool which Avery product replaces a competitor part. These matches are used first. Anything not on the list, the tool searches for a
        substitute. Use <code>*</code> as a wildcard (e.g. <code>DI-24V-VL8MN3-30K-*</code> covers every length), and <code>N/A</code> as the Avery SKU for
        parts we don&apos;t carry.
      </p>
      {sp?.error && <p className="error">{sp.error}</p>}
      {sp?.added && <p className="ok">Added {sp.added} row(s).</p>}
      {unknown > 0 && <p className="banner">{unknown} row(s) point to an Avery SKU that isn&apos;t in the current catalog. Those rows are skipped until the SKU exists.</p>}

      <div className="grid2" style={{ marginTop: 16 }}>
        <form action={upload} className="card">
          <h3>Upload a CSV</h3>
          <p className="small muted">
            Columns: competitor_brand, competitor_sku, competitor_description, avery_sku, notes. <a href="/api/compat-template">Download the template</a>.
          </p>
          <input type="file" name="csv" accept=".csv,text/csv" required />
          <label style={{ marginTop: 12 }}>
            Your name
            <input name="who" placeholder="e.g. Dave" />
          </label>
          <label>
            <span>
              <input type="radio" name="mode" value="add" defaultChecked /> Add to the list (same competitor SKU = replaced)
            </span>
            <span>
              <input type="radio" name="mode" value="replace" /> Replace the whole list
            </span>
          </label>
          <SubmitButton label="Upload" pending="Uploading…" />
        </form>

        <form action={addOne} className="card">
          <h3>Add one match</h3>
          <div className="grid2" style={{ gap: 8 }}>
            <label>
              Competitor SKU
              <input name="competitor_sku" required />
            </label>
            <label>
              Avery SKU
              <input name="avery_sku" list="avery-skus" required placeholder="or N/A" />
            </label>
          </div>
          <datalist id="avery-skus">
            <option value="N/A" />
            {skus.map((s) => (
              <option key={s.sku} value={s.sku}>
                {s.title} — {s.variant}
              </option>
            ))}
          </datalist>
          <label>
            Competitor brand
            <input name="competitor_brand" />
          </label>
          <label>
            Description / notes
            <input name="notes" />
          </label>
          <SubmitButton label="Add" />
        </form>
      </div>

      <div className="spread" style={{ marginTop: 24 }}>
        <h2 style={{ margin: 0 }}>{rows.length} matches</h2>
        <div className="row">
          <a className="btn" href="/api/compat-export">
            Download as CSV
          </a>
          {rows.length > 0 && (
            <form action={remove}>
              <input type="hidden" name="id" value="all" />
              <SubmitButton label="Clear list" className="danger" />
            </form>
          )}
        </div>
      </div>
      <div className="tablewrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Competitor SKU</th>
              <th>Brand / description</th>
              <th>Avery product</th>
              <th>Notes</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <b className="small">{r.competitor_sku}</b>
                </td>
                <td className="small">
                  {r.competitor_brand}
                  <div className="muted">{r.competitor_description}</div>
                </td>
                <td className="small">
                  {r.avery_sku}
                  <div className={cat[r.avery_sku] ? 'muted' : 'error'}>
                    {cat[r.avery_sku] ? `${cat[r.avery_sku].title} — ${cat[r.avery_sku].variant}` : /^n\/?a$/i.test(r.avery_sku) ? 'Not carried' : 'Not in catalog'}
                  </div>
                </td>
                <td className="small">{r.notes}</td>
                <td className="small muted">
                  {r.added_by}
                  <div>{r.created_at?.slice(0, 10)}</div>
                </td>
                <td>
                  <form action={remove}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="danger">Remove</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
