/** Reject known electrical/physical conflicts for every matcher, including saved mappings. */
const volts = (text) => (text.match(/(?:^|[^\d])(12|24|48)\s*V(?:DC)?(?:\b|(?=\d+(?:\.\d+)?W\b))/i) || [])[1] || null;
const width = (text) => (text.match(/\b(\d+(?:\.\d+)?)\s*mm\b/i) || [])[1] || null;
const cct = (text) => (text.match(/\b(\d{4})\s*K\b/i) || text.match(/-(\d{2})K(?:-|$)/i) || [])[1] || null;
export function assessMatch(line, item) {
  const source = `${line.comp_desc || ''} ${line.comp_sku || ''}`;
  const target = `${item.title || ''} ${item.variant || ''} ${item.sku || ''} ${item.specs || ''}`;
  const blockers = [], gaps = [], checks = []; // checks = standard datasheet checks, not specific unknowns
  const sv = volts(source), tv = volts(target);
  if (sv && tv && sv !== tv) blockers.push(`Voltage mismatch: source ${sv}V, Avery ${tv}V.`);
  if ((!sv || !tv) && item.category !== 'connector') gaps.push('Verify operating voltage against the product datasheets.');
  const sourceRgbw = /rgbw/i.test(source), targetRgbw = /rgbw/i.test(target);
  if (item.category === 'tape' && sourceRgbw !== targetRgbw) blockers.push('RGBW and white tape are not interchangeable.');
  if (item.category === 'tape' && /\brgb\b/i.test(source) && !sourceRgbw) blockers.push('RGB and RGBW tape require different controls.');
  if (/wet|outdoor|IP\s*6[5-9]|IP\s*[78]\d/i.test(source)) {
    if (!/IP\s*(?:6[5-9]|[78]\d)/i.test(item.ip_rating || '')) blockers.push('Wet/outdoor requirement is not supported by the Avery IP rating.');
  }
  if (item.category === 'driver') {
    const watts = Number((source.match(/(\d+(?:\.\d+)?)\s*W(?:atts?)?\b/i) || [])[1]);
    if (watts && (!item.watts || item.watts < watts)) blockers.push('The Avery driver is undersized; multiple supplies are not a drop-in substitute.');
    if (/dimm/i.test(source) && !/non[ -]?dimm/i.test(source) && item.dimmable !== 1) blockers.push('The source requires a dimmable driver.');
    if (/0[ -]?10\s*V|dmx|dali|triac|phase/i.test(source)) gaps.push('Confirm the dimming protocol and AC input voltage.');
    if (!watts) gaps.push('Confirm driver wattage and connected load.');
    checks.push('AC input range, dimming compatibility and installation requirements');
  }
  if (item.category === 'tape') {
    const srcLm = Number((source.match(/(\d{2,4})\s*lm\s*\/\s*ft/i) || [])[1]), avLm = Number((item.output_class || '').match(/(\d{2,4})/)?.[1]);
    if (srcLm && avLm && Math.abs(avLm - srcLm) / srcLm > 0.25) gaps.push(`Brightness differs: source ${srcLm} lm/ft, Avery ${avLm} lm/ft.`);
    const sc = cct(source), tc = item.cct;
    const normalized = sc ? (sc.length === 2 ? sc + '00K' : sc + 'K') : null;
    if (!sourceRgbw && (!normalized || !tc || normalized !== tc)) gaps.push(`Verify colour temperature${normalized && tc ? `: source ${normalized}, Avery ${tc}` : ''}.`);
    checks.push('total required length, brightness, wattage per length and cut increments');
  }
  if (item.category === 'connector') {
    const sw = width(source), tw = width(target);
    if (sw && tw && sw !== tw) blockers.push(`Connector width mismatch: ${sw}mm versus ${tw}mm.`);
    checks.push('tape width, pin count, polarity and connector type');
  }
  return { blockers, gaps, checks };
}
