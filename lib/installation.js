import { productSpecs } from './product-specs.js';
import { parseSourceLength } from './requirements.js';
import { sourceText } from './specs.js';

export function installationPlan(q,catalog) {
  const groups=new Map();
  const get=(l)=>{const key=l.group_label?.trim() || '';if(!groups.has(key)) groups.set(key,{name:key || 'Unassigned products',assigned:!!key,tapeFeet:0,knownLoadWatts:0,capacityWatts:0,incomplete:[],conditions:[],blockers:[],tape:[],channels:[],connectors:[]});return groups.get(key);};
  for (const l of q.lines.filter((l)=>l.include && catalog[l.our_sku])) {
    const item=catalog[l.our_sku], s=productSpecs(item), g=get(l);
    if (item.category==='tape') {
      const length=parseSourceLength(sourceText(l));g.tape.push({l,s});
      if (!length.problem) g.tapeFeet+=length.feet*l.qty;
      if (length.problem || !s.watts_ft) g.incomplete.push(`${l.comp_sku}: verify tape length and Avery watts per foot.`);
      else g.knownLoadWatts+=length.feet*l.qty*s.watts_ft;
      if (s.max_run_ft && !length.problem && !length.perFoot && length.feet>s.max_run_ft) g.conditions.push(`${l.comp_sku}: ${length.raw} exceeds Avery's ${s.max_run_ft}ft maximum run; review feeds and segmentation.`);
    } else if(item.category==='driver') {
      if (!item.watts) g.incomplete.push(`${l.comp_sku}: Avery driver wattage is unknown.`);
      else g.capacityWatts+=(l.our_qty ?? l.qty)*item.watts;
      g.driverVoltages ||= [];g.driverVoltages.push(s.voltage_v);
    } else if(item.category==='channel') g.channels.push({l,s});
    else if(item.category==='connector') g.connectors.push({l,s});
  }
  for (const g of groups.values()) {
    g.requiredWatts=q.design_headroom == null ? null : g.knownLoadWatts*(1+q.design_headroom/100);
    if (g.tape.length && q.design_headroom == null) g.conditions.push('Review and enter the required driver headroom percentage.');
    if (g.tape.length && !g.assigned) g.conditions.push('Assign circuit groups before interpreting tape, drivers and channels as one installation.');
    if (!g.tape.length && g.capacityWatts>0) g.conditions.push('Connected load is not represented by selected tape products; verify it separately.');
    if (g.tape.length && !g.capacityWatts) g.conditions.push('No driver capacity is selected in this group; allow for power supplies separately.');
    if (g.assigned && g.tape.length && g.capacityWatts>0) {
      if (!g.incomplete.length && g.capacityWatts+0.001 < (g.requiredWatts ?? g.knownLoadWatts)) g.blockers.push(`${g.name}: selected drivers provide ${g.capacityWatts}W, below the ${Math.round((g.requiredWatts ?? g.knownLoadWatts)*100)/100}W tape requirement${g.requiredWatts == null ? ' before headroom' : ' including headroom'}.`);
      if (g.driverVoltages?.some((v)=>v && g.tape.some(({s})=>s.voltage_v && s.voltage_v !== v))) g.blockers.push(`${g.name}: selected tape and driver voltages differ. Separate the circuits or select matching products.`);
    }
    if (g.assigned) for (const {s:channel,l} of g.channels) for (const {s:tape} of g.tape) {
      if (channel.channel_inner_mm && tape.width_mm && channel.channel_inner_mm < tape.width_mm) g.blockers.push(`${g.name}: ${l.our_sku} has ${channel.channel_inner_mm}mm usable width, below the selected ${tape.width_mm}mm tape width.`);
      else if (!channel.channel_inner_mm) g.conditions.push(`${l.our_sku}: verify channel's usable inner width for the replacement tape.`);
    }
    if (g.assigned && g.tape.length===1) for (const {s:connector,l} of g.connectors) {
      const tape=g.tape[0].s;
      if(connector.width_mm && tape.width_mm && connector.width_mm !== tape.width_mm) g.blockers.push(`${g.name}: ${l.our_sku} connector width differs from the selected tape.`);
      if(connector.connector_pins && tape.connector_pins && connector.connector_pins !== tape.connector_pins) g.blockers.push(`${g.name}: ${l.our_sku} pin count differs from the selected tape.`);
    }
    g.status=g.blockers.length ? 'Needs correction' : g.incomplete.length ? 'Incomplete load data' : g.conditions.length ? 'Requires installation review' : 'Calculated; verify circuit distribution';
    g.incomplete=[...new Set(g.incomplete)];g.conditions=[...new Set(g.conditions)];g.blockers=[...new Set(g.blockers)];
    delete g.tape;delete g.channels;delete g.connectors;delete g.driverVoltages;
  }
  return {groups:[...groups.values()],blockers:[...groups.values()].flatMap((g)=>g.blockers),basis:q.driver_basis || 'source',headroom:q.design_headroom ?? null,note:q.installation_note || ''};
}
