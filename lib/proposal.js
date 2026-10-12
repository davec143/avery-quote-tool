import { productSpecs } from './product-specs.js';
import { sourceText,tapeWidth,brightness } from './specs.js';
import { parseRollLength,parseSourceLength } from './requirements.js';
export function briefConditions(row) {
  const item=row.our;if(!item) return '';
  const s=productSpecs(item),parts=[];
  if(item.category==='driver' && row.match_kind!=='exact') parts.push('Driver consolidation/splitting requires a reviewed circuit plan: connected loads, headroom, AC input and dimming.');
  if(item.category==='channel') parts.push(`${parseRollLength(item) ? `${parseRollLength(item).toFixed(2)}ft Avery sections` : Object.hasOwn(item.specification_values || {},'length_ft') ? 'Avery sections (length to verify)' : 'One-metre Avery sections'} replace the quoted section format; longer runs need joints. Confirm profile, fit and cutting waste.`);
  if(item.category==='connector') parts.push(row.difference_notes || 'Confirm tape width, pin count and polarity.');
  if(item.category==='tape') {
    const sw=tapeWidth(sourceText(row)),src=brightness(sourceText(row));
    if(sw && s.width_mm && sw!==s.width_mm) parts.push(`${s.width_mm}mm Avery tape replaces ${sw}mm; confirm channel fit.`);
    if(src.value && s.lumens_ft && Math.abs(src.value-s.lumens_ft)>0.5) parts.push(`${s.lumens_ft} versus ${Math.round(src.value*100)/100} lm/ft (${Math.round(Math.abs(src.value-s.lumens_ft)*100)/100} ${s.lumens_ft>src.value ? 'higher; dimming requires compatible drivers/controls' : 'lower; confirm required brightness'}).`);
    const roll=parseRollLength(item),length=parseSourceLength(sourceText(row));
    if(roll && !length.problem && length.feet>roll*1.005 && !length.perFoot) parts.push('Source runs exceed an Avery roll; review joins and feeds.');
    else if((row.difference_notes || '').includes('Avery supplies')) parts.push('Fixed-length Avery rolls require cutting; allow for offcuts.');
  }
  if(row.match_kind==='review' && !parts.length) parts.push('Specifications or quantities require review; see the recorded conditions in the appendix.');
  if(row.customer_note) parts.push(row.customer_note);
  return [...new Set(parts)].join(' ');
}
