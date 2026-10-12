import { planQuantities } from './requirements.js';
import { assessMatch } from './match-safety.js';
import { kindFromText } from './specs.js';

export const MATCH_LABELS = { exact: 'Exact on checked specs', alternative: 'Alternative — differences disclosed', review: 'Option requiring review' };
export function evaluateCrossovers(lines, catalog, options = {}) {
  const planned = planQuantities(lines, catalog, options);
  return planned.map((l) => {
    const item = catalog[l.our_sku];
    if (!item) return { ...l, match_kind: 'review', review_required: 0, difference_notes: '', dependency_ids: '[]', blockers: [], gaps: [] };
    const a = assessMatch(l, item, { lines: planned, catalog, driverBasis:options.driverBasis });
    if (kindFromText(l.comp_desc, l.comp_sku) !== item.category) a.blockers.push('Product types do not match.');
    if (l.quantity_problem) a.gaps.push(l.quantity_problem);
    if (l.quantity_mode === 'manual' && !l.customer_note) a.gaps.push('Explain the manual Avery quantity in the customer-facing specification note.');
    const differences = [...a.differences, ...(l.quantity_note ? [l.quantity_note] : [])];
    const review = a.blockers.length > 0 || a.gaps.length > 0 || l.quantity_review;
    const match_kind = review ? 'review' : differences.length ? 'alternative' : 'exact';
    return { ...l, blockers: a.blockers, gaps: a.gaps, match_kind, review_required: review ? 1 : 0,
      difference_notes: [...new Set([...differences, ...a.gaps])].join(' '), dependency_ids: JSON.stringify(a.dependencyIds),
      confidence: review ? 'low' : match_kind === 'exact' ? 'high' : 'medium' };
  });
}
