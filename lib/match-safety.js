import { itemText, sourceText, voltage, tapeWidth, colourTemperature, brightness, catalogBrightness, sourceWatts, channelProfile } from './specs.js';
import { productSpecs } from './product-specs.js';
import { sourceLength } from './requirements.js';

/** Every match source uses the same limits, disclosures and quote dependencies. */
export function assessMatch(line, item, { lines = [], catalog = {}, driverBasis = 'source' } = {}) {
  const source = sourceText(line), target = itemText(item);
  const blockers = [], gaps = [], checks = [], differences = [], dependencyIds = [];
  const specs=productSpecs(item);
  const sv = voltage(source), tv = specs.voltage_v;
  if (!['connector', 'channel'].includes(item.category)) {
    if (sv && tv && sv !== tv) blockers.push(`Voltage mismatch: source ${sv}V, Avery ${tv}V.`);
    if (!sv || !tv) gaps.push('Verify operating voltage against the product datasheets.');
  }
  const sourceRgbw = /rgbw/i.test(source), targetRgbw = Object.hasOwn(item.specification_values || {},'cct') ? specs.cct === 'RGBW' : /rgbw/i.test(target);
  if (item.category === 'tape' && sourceRgbw !== targetRgbw) blockers.push('RGBW and white tape are not interchangeable.');
  if (item.category === 'tape' && /\brgb\b/i.test(source) && !sourceRgbw) blockers.push('RGB and RGBW tape require different controls.');
  const sourceIp = source.match(/\bIP\s*(\d{2})\b/i)?.[1];
  const targetIp = item.ip_rating?.match(/IP\s*(\d{2})/i)?.[1];
  if (/wet|outdoor|IP\s*6[5-9]|IP\s*[78]\d/i.test(source)) {
    if (!/^(6[5-9]|[78]\d)$/.test(targetIp || '')) blockers.push('Wet/outdoor requirement is not supported by the Avery IP rating.');
    else if (sourceIp && sourceIp !== targetIp) gaps.push(`Environmental ratings differ: source IP${sourceIp}, Avery IP${targetIp}. Verify suitability for the specified exposure; wet ratings are not interchangeable.`);
  }
  if (item.category === 'driver') {
    const watts = sourceWatts(line);
    if (!watts || !item.watts) gaps.push('Confirm driver wattage and connected load.');
    if (watts && item.watts && watts !== item.watts) differences.push(`Quoted ${watts}W driver(s) replaced by ${item.watts}W Avery drivers using ${driverBasis === 'tape_load' ? 'selected replacement tape load with reviewed headroom' : 'total rated job capacity'}.`);
    if (/dimm/i.test(source) && !/non[ -]?dimm/i.test(source) && item.dimmable !== 1) blockers.push('The source requires a dimmable driver.');
    if (/0[ -]?10\s*V|dmx|dali|triac|phase/i.test(source)) gaps.push('Confirm the dimming protocol and AC input voltage.');
    checks.push('AC input range, connected load, headroom, circuit layout and dimming compatibility');
  }
  if (item.category === 'channel') {
    const sp = channelProfile(source), tp = specs.profile;
    if (sp && tp && sp !== tp) blockers.push(`Channel profile mismatch: source ${sp}, Avery ${tp}.`);
    if (!sp || !tp) gaps.push('Verify channel profile and dimensions against the source, including fit for the replacement tape.');
    checks.push('profile dimensions, diffuser, joints, cutting waste and mounting');
  }
  if (item.category === 'tape') {
    const sw = tapeWidth(source), tw = specs.width_mm || (Object.hasOwn(item.specification_values || {},'width_mm') ? null : 10);
    if (!sw) gaps.push('Verify the source tape width and fit within the channel.');
    if (!tw) gaps.push('Verify Avery tape width; the catalog width is unknown.');
    if (sw && sw <= 6) blockers.push(`Source tape is ${sw}mm wide; narrow tape at 6mm or less is excluded.`);
    else if (sw && tw && sw !== tw) {
      differences.push(`Avery tape is ${tw}mm wide versus the quoted ${sw}mm. Confirm fit within the channel.`);
      if (sw < 8) gaps.push('The source width is below the common 8mm range; verify the intentional fit requirement.');
    }
    const src = brightness(source), avLm = catalogBrightness(item);
    if (src.value >= 700) blockers.push(`Source output is ${Math.round(src.value)} lm/ft; products at 700 lm/ft or above are excluded.`);
    if (!sourceRgbw && (!src.value || !avLm)) gaps.push('Verify brightness on the same length basis; source or catalog output is unknown.');
    if (src.inferred) gaps.push('Source brightness was inferred from the series name; verify its lumens per foot.');
    if (src.value && avLm && Math.abs(avLm - src.value) > 0.5) {
      const delta = Math.round(Math.abs(avLm - src.value) * 100) / 100;
      differences.push(`Output: source ${Math.round(src.value * 100) / 100} lm/ft, Avery ${avLm} lm/ft (${delta} lm/ft ${avLm > src.value ? 'higher' : 'lower'}).${avLm > src.value ? ' Compatible dimming may reduce brightness; confirm driver and control compatibility.' : ' Confirm that the lower output meets the project requirement.'}`);
    }
    const sc = colourTemperature(source), tc = item.cct;
    if (!sourceRgbw && (!sc || !tc || sc !== tc)) gaps.push(`Verify colour temperature${sc && tc ? `: source ${sc}, Avery ${tc}` : ''}.`);
    const run=sourceLength(line);
    if (specs.max_run_ft && !run.problem && !run.perFoot && !run.totalOnly && run.feet>specs.max_run_ft) gaps.push(`Source run exceeds Avery's ${specs.max_run_ft}ft maximum continuous run. Review feed locations and segmentation.`);
    checks.push('continuous run lengths, wattage per length, cut increments and channel fit');
  }
  if (item.category === 'connector') {
    const sw = tapeWidth(source), tw = specs.width_mm;
    if (!sw || !tw) gaps.push('Verify connector width against the selected tape.');
    if (sw && tw && sw !== tw) {
      const parents = lines.filter((l) => l.include && l.our_sku && catalog[l.our_sku]?.category === 'tape' &&
        (!line.group_label || l.group_label === line.group_label) && tapeWidth(sourceText(l)) === sw &&
        (productSpecs(catalog[l.our_sku]).width_mm || (Object.hasOwn(catalog[l.our_sku].specification_values || {},'width_mm') ? null : 10)) === tw);
      if (!parents.length) blockers.push(`Connector width mismatch: ${sw}mm versus ${tw}mm. Select corresponding Avery tape first; this connector does not fit the original tape.`);
      else {
        dependencyIds.push(...parents.map((l) => l.id));
        differences.push(`Conditional on using the Avery ${tw}mm tape selected on source line(s) ${parents.map((l) => l.line_ref).join(', ')}. This ${tw}mm terminal block is not compatible with the original ${sw}mm tape.`);
        gaps.push('Verify connector type, pin count, polarity and its association with the selected replacement tape.');
      }
    }
    const sourcePins=Number(source.match(/\b(\d+)\s*[- ]?pins?\b/i)?.[1]);
    if (sourcePins && specs.connector_pins && sourcePins !== specs.connector_pins) blockers.push(`Connector pin count mismatch: source ${sourcePins}, Avery ${specs.connector_pins}.`);
    checks.push('tape width, pin count, polarity and connector type');
  }
  return { blockers, gaps, checks, differences, dependencyIds };
}
