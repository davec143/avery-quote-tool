export const CHARGE_LABELS = { freight:'Freight', tax:'Tax', discount:'Discount', other:'Other source charge' };
export function sourceCharges(value) {
  const rows=typeof value === 'string' ? JSON.parse(value || '[]') : value || [];
  if (!Array.isArray(rows)) throw new Error('Invalid source charges.');
  return rows;
}
export function chargeTotal(value) { return sourceCharges(value).reduce((n,c)=>n+c.amount,0); }
export function chargesFromForm(form, previous) {
  if (!Object.keys(CHARGE_LABELS).some((k)=>form.has(`charge_${k}`))) return previous || '[]';
  const charges=[];
  for (const kind of Object.keys(CHARGE_LABELS)) {
    const raw=String(form.get(`charge_${kind}`) || '').trim().replace(/[$,]/g,'');
    if (!raw) continue;
    const amount=Number(raw);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`${CHARGE_LABELS[kind]} must be a non-negative amount; enter discounts as positive deductions.`);
    if (amount) charges.push({kind,amount:kind==='discount' ? -amount : amount,note:kind==='other' ? String(form.get('charge_note') || '').trim() : ''});
  }
  if (charges.some((c)=>c.kind==='other' && !c.note)) throw new Error('Explain the other source charge.');
  return JSON.stringify(charges);
}
