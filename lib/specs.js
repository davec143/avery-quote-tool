// Shared source/catalog readers. Missing metadata stays unknown instead of proving equivalence.
export const itemText = (item) => `${item.title || ''} ${item.variant || ''} ${item.sku || ''} ${item.specs || ''}`;
export const sourceText = (line) => `${line.comp_desc || ''} ${line.comp_sku || ''}`;
export const voltage = (text) => Number((text.match(/(?:^|[^\d])(12|24|48)\s*V(?:DC)?(?:\b|(?=\d+(?:\.\d+)?W\b))/i) || [])[1]) || null;
export const tapeWidth = (text) => Number((text.match(/\b(\d+(?:\.\d+)?)\s*mm\b/i) || [])[1]) || null;
export const sourceWatts = (line) => Number((sourceText(line).match(/(\d+(?:\.\d+)?)\s*W(?:atts?)?\b/i) || [])[1]) || null;
export const colourTemperature = (text) => {
  const n = (text.match(/\b(\d{4})\s*K\b/i) || text.match(/-(\d{2})K(?:-|$)/i) || [])[1];
  return n ? `${n.length === 2 ? n + '00' : n}K` : null;
};
export function kindFromText(desc = '', sku = '') {
  const t = `${desc} ${sku}`.toLowerCase();
  if (/end cap|mounting clip|channel lens|channel diffuser/.test(t)) return 'channel_accessory';
  if (/channel|extrusion|profile/.test(t)) return 'channel';
  if (/fixture/.test(t)) return 'fixture';
  if (/driver|power supply|transformer|omnidrive|-odx-|vlm\d+w/.test(t)) return 'driver';
  if (/casambi|controller|dmx|remote|wall control|dimmer switch|pwm/.test(t)) return 'control';
  if (/connector|terminal block|splice|jumper/.test(t)) return 'connector';
  if (/tape|strip|streamlite|valent|blaze|celeste|ribbon|\b\d{4}k\b|rgbw?|-(12|24)v-(stmlt|vl|bl|cel)/.test(t)) return 'tape';
  return 'unknown';
}
export function channelProfile(text) {
  if (/corner|angled|45\s*(?:°|degree)/i.test(text)) return 'corner';
  if (/recessed|recess|flush/i.test(text)) return 'recessed';
  if (/surface|\bu[ -]?(?:channel|profile|shape)/i.test(text)) return 'surface';
  return null;
}
export function brightness(text) {
  const explicit = text.match(/(\d+(?:\.\d+)?)\s*(?:lm|lumens?)\s*(?:\/|per\s+)(ft|foot|feet|m|met(?:er|re)s?)\b/i);
  if (explicit) return { value: Number(explicit[1]) / (/^(m|met)/i.test(explicit[2]) ? 3.28084 : 1), inferred: false };
  const series = (text.match(/(?:streamlite|valent mini|blaze|celeste)\s*(?:tape light\s*)?(\d{3,4})/i) || text.match(/(?:STMLT|MN)(\d)/i) || [])[1];
  if (/VL8MN1|MINI 150/i.test(text)) return { value: 150, inferred: true };
  if (series) return { value: Number(series) < 10 ? Number(series) * 100 : Number(series), inferred: true };
  return { value: null, inferred: false };
}
export const catalogBrightness = (item) => Object.hasOwn(item.specification_values || {},'lumens_ft') ? item.specification_values.lumens_ft : Number(item.output_class?.match(/(\d+(?:\.\d+)?)/)?.[1]) || brightness(itemText(item)).value;
export function outputTarget(value) {
  if (value >= 700) return null;
  return value <= 200 ? 200 : value <= 300 ? 300 : 500;
}
export function driverPoolKey(line, item) {
  const text = sourceText(line);
  const protocol = text.match(/0[ -]?10\s*V|dmx|dali|triac|phase/i)?.[0]?.toLowerCase().replace(/[ -]/g, '') || '';
  // Separate explicit sections/circuits and control protocols even for the same Avery SKU.
  return JSON.stringify([item.sku, line.group_label || '', voltage(text), protocol]);
}
