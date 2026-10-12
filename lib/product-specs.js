import { itemText, voltage, tapeWidth, catalogBrightness, channelProfile } from './specs.js';

export const SPEC_FIELDS = {
  voltage_v:'Operating voltage (V)', width_mm:'Tape / connector width (mm)', lumens_ft:'Output (lm/ft)',
  watts_ft:'Tape power (W/ft)', length_ft:'Roll / section length (ft)', channel_inner_mm:'Channel usable inner width (mm)',
  connector_pins:'Connector pin count', max_run_ft:'Maximum continuous run (ft)', pack_qty:'Pieces per sold pack',
  driver_watts:'Driver rated output (W)',
};
export function productSpecs(item) {
  const text=itemText(item);
  const power=text.match(/(\d+(?:\.\d+)?)\s*W(?:atts?)?\s*(?:\/|per\s+)(ft|foot|feet|m|met(?:er|re)s?)\b/i);
  const pins=text.match(/\b(\d+)\s*[- ]?pins?\b/i);
  const inner=text.match(/(?:inner|internal|usable)\s*width\s*[:=]?\s*(\d+(?:\.\d+)?)\s*mm/i);
  const inferred={voltage_v:voltage(text),width_mm:tapeWidth(text),lumens_ft:catalogBrightness(item),
    watts_ft:power ? Number(power[1]) / (/^(m|met)/i.test(power[2]) ? 3.28084 : 1) : null,
    length_ft:null,channel_inner_mm:inner ? Number(inner[1]) : null,connector_pins:pins ? Number(pins[1]) : null,
    max_run_ft:null,pack_qty:item.pack_qty,profile:channelProfile(text),driver_watts:item.watts,
    cct:item.cct,ip_rating:item.ip_rating,dimmable:item.dimmable};
  return { ...inferred, ...(item.specification_values || {}) };
}
export function specOptions(q) { return { driverBasis:q.driver_basis || 'source', headroom:q.design_headroom }; }
