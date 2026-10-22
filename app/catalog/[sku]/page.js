import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/access';
import { catalogBySku } from '@/lib/catalog';
import { saveProductSpecs } from '@/lib/catalog-spec-review';
import { productSpecs, SPEC_FIELDS } from '@/lib/product-specs';
import { parseRollLength } from '@/lib/requirements';
import SubmitButton from '../../submit-button';

async function save(form) {
  'use server';await requireAdmin();
  const sku=String(form.get('sku')), url=`/catalog/${encodeURIComponent(sku)}`;
  try {saveProductSpecs(sku,form);} catch(e){redirect(`${url}?error=${encodeURIComponent(e.message)}`);}
  revalidatePath('/catalog');revalidatePath(url);redirect(`${url}?saved=1`);
}
export default async function ProductSpecsPage({params,searchParams}) {
  await requireAdmin();
  const {sku}=await params,sp=await searchParams,item=catalogBySku()[sku];if(!item) notFound();
  const specs=productSpecs(item);if(!Object.hasOwn(item.specification_values || {},'length_ft')) specs.length_ft=parseRollLength(item);
  const fields=['voltage_v','pack_qty',...(item.category==='tape' ? ['width_mm','lumens_ft','watts_ft','length_ft','max_run_ft','connector_pins'] : item.category==='channel' ? ['length_ft','channel_inner_mm'] : item.category==='driver' ? ['driver_watts'] : item.category==='connector' ? ['width_mm','connector_pins'] : [])];
  return <><p><Link href="/catalog">← Catalog</Link></p><h1>{item.title}</h1><p>{sku} · {item.variant}</p>
    {sp.error && <p className="error" role="alert">{sp.error}</p>}{sp.saved && <p className="ok">Verified specifications saved.</p>}
    {item.specification_stale && <p className="banner">Catalog metadata changed since verification. Previous verified values are not being applied; recheck the current product reference.</p>}
    <div className="grid2"><form action={save} className="card">
      <input type="hidden" name="sku" value={sku} /><input type="hidden" name="spec_revision" value={item.specification_date || ''} /><input type="hidden" name="catalog_revision" value={item.catalog_revision} />
      <h3>Verified product specifications</h3><p className="small muted">Check values against the product datasheet. Blank fields remain unknown. Verification covers the entered fields; it does not establish complete system suitability. Lengths and output use feet consistently.</p>
      <div className="grid2">{fields.map((field)=><label key={field}>{SPEC_FIELDS[field]}<input name={field} type="number" min={['pack_qty','connector_pins'].includes(field) ? '1' : '0.0001'} step={['pack_qty','connector_pins'].includes(field) ? '1' : 'any'} defaultValue={specs[field] ?? ''} /></label>)}</div>
      {item.category==='channel' && <label>Channel profile<select name="profile" defaultValue={specs.profile || ''}><option value="">Unknown</option><option value="surface">Surface / U-channel</option><option value="corner">Corner</option><option value="recessed">Recessed</option></select></label>}
      {item.category==='tape' && <label>Colour temperature<input name="cct" defaultValue={specs.cct || ''} placeholder="3000K or RGBW" /></label>}
      {['tape','driver'].includes(item.category) && <label>IP rating<input name="ip_rating" defaultValue={specs.ip_rating || ''} placeholder="IP20" /></label>}
      {item.category==='driver' && <label>Dimmable<select name="dimmable" defaultValue={specs.dimmable===1 ? 'yes' : specs.dimmable===0 ? 'no' : ''}><option value="">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>}
      <label>Product reference / datasheet<input name="reference" defaultValue={item.specification_reference || ''} required /></label>
      <label>Verified by<input name="verified_by" defaultValue={item.specification_reviewer || ''} required /></label>
      <label className="row"><input type="checkbox" name="specs_verified" required /> I checked these values against the product reference.</label><SubmitButton label="Save verified specifications" />
    </form><section className="card"><h3>Imported product description</h3><p className="preserve">{item.specs || 'No imported specifications.'}</p><p className="small muted">{item.specification_date ? `Last verified ${item.specification_date} by ${item.specification_reviewer}.` : 'Values are currently inferred from imported descriptions and require product verification.'}</p></section></div>
  </>;
}
