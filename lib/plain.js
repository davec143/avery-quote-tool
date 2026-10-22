// Plain-language versions of the review checks for members, who are usually salespeople, not engineers.
// The admin page keeps the technical wording; these only change how the same facts are explained.

/** Why a quantity could not be calculated, in one sentence. */
export function plainQuantityProblem(problem = '') {
  const p = problem.toLowerCase();
  if (p.includes('no tape length')) return "We couldn't find the length of each piece on their quote, so we can't work out how many rolls you need.";
  if (p.includes('conflicting total') || p.includes('several section lengths') || p.includes('total footage')) return 'Their quote lists lengths in more than one way, so we can\'t be sure how much tape you need.';
  if (p.includes('wattage')) return "We couldn't tell the wattage of their driver, so we can't work out how many Avery drivers you need.";
  if (p.includes('section length')) return 'We don\'t know the section length for this channel, so we can\'t count the sections.';
  if (p.includes('tape-load')) return 'This driver quantity needs a power calculation that our team does by hand.';
  if (p.includes('source quantity')) return 'The quantity on their quote doesn\'t look right. Check it.';
  return "We couldn't work out the quantity for this item automatically.";
}

/** Why a selected product does not fit, trimmed to what a buyer needs to know. */
export function plainBlocker(blocker = '') {
  return blocker
    .replace(/Select a compatible product or exclude the line\.?/i, '')
    .replace(/Select corresponding Avery tape first; this connector does not fit the original tape\./i, 'Pick the Avery tape for that run first.')
    .trim();
}

/**
 * The confirmation checklist, item by item, as a buyer would read it.
 * Each item: { title, detail, action, target }.
 */
export function plainIssue(issue, lines = []) {
  const line = issue.lineId ? lines.find((l) => l.id === issue.lineId) : null;
  const name = line ? `${line.comp_sku || 'Line ' + line.line_ref}` : '';
  const target = issue.target;
  switch (issue.kind) {
    case 'quantity':
      return { title: `How many of ${name} do you need?`, detail: plainQuantityProblem(issue.detail), action: 'Type the number of Avery pieces, or untick "Include" to leave this item out.', target };
    case 'blocker':
      return { title: `${name}: the Avery product you picked doesn't fit`, detail: plainBlocker(issue.detail), action: 'Choose a different Avery product, or untick "Include" to leave this item out.', target };
    case 'invalid':
      return { title: `${name}: check the numbers`, detail: 'The quantity or price on this line is missing or not valid.', action: 'Fix the quantity and price, or untick "Include".', target };
    case 'source':
      return { title: "We couldn't read their quote", detail: issue.message, action: 'Re-upload a clearer copy, or add the products by hand below.', target };
    case 'currency':
      return { title: 'This quote is not in US dollars', detail: 'Savings can only be compared in USD.', action: 'Upload a USD quote, or clear the prices and compare products only.', target };
    case 'expired':
      return { title: 'This comparison has expired', detail: 'Its validity date has passed.', action: 'Ask our team for updated pricing.', target };
    case 'empty':
      return { title: 'Nothing is included yet', detail: 'A proposal needs at least one Avery product.', action: 'Pick an Avery product for at least one line and tick "Include".', target };
    case 'overage':
      return { title: `${name}: you'll get more than their quote needs`, detail: `Avery sells this in ${issue.detail.packLabel}s of ${issue.detail.packQty}. You need ${issue.detail.required}, so the order is ${issue.detail.ordered} (${issue.detail.extra} extra).`, action: 'Tick "I understand" on that item, or use Acknowledge all above.', target };
    case 'installation':
      return { title: 'Power check', detail: issue.message, action: 'Pick a bigger driver, add another one, or ask our team.', target };
    default:
      return { title: issue.message, detail: '', action: '', target };
  }
}

/** Status for a line card. */
export function plainLineStatus(row) {
  if (row.state === 'na' || !row.our) return { key: 'pick', label: 'No Avery product yet' };
  if (row.blockers?.length) return { key: 'bad', label: "Doesn't fit" };
  if (row.quantity_problem && row.quantity_mode !== 'manual') return { key: 'qty', label: 'Quantity needed' };
  if (row.state.startsWith('invalid')) return { key: 'bad', label: 'Check the numbers' };
  if (!row.include) return { key: 'off', label: 'Left out' };
  if (row.match_kind === 'exact') return { key: 'good', label: 'Match' };
  if (row.match_kind === 'alternative') return { key: 'near', label: 'Close match' };
  return { key: 'near', label: 'Please check' };
}

/** How the calculated quantity was reached, in a short phrase. */
export function plainQuantityBasis(row) {
  if (!row.our) return '';
  if (row.quantity_mode === 'manual') return 'Quantity you entered.';
  const b = String(row.qty_basis || '');
  const cat = row.our.category;
  if (cat === 'tape') {
    const m = b.match(/=\s*([\d.]+)\s*ft;\s*Avery rolls are\s*([\d.]+)\s*ft/i);
    return m ? `Their quote needs about ${m[1]} ft of tape; Avery rolls are ${m[2]} ft, rounded up to whole rolls.` : 'Calculated from the tape length on their quote.';
  }
  if (cat === 'driver') return b.includes('Job capacity') ? 'Calculated from the total driver wattage on their quote; drivers are shared across the job.' : 'Calculated from the driver wattage on their quote.';
  if (cat === 'channel') { const m = b.match(/=\s*([\d.]+)\s*ft;/i); return m ? `Their quote needs about ${m[1]} ft of channel, in Avery sections.` : 'Calculated from the channel length on their quote.'; }
  return 'Same quantity as their quote.';
}
