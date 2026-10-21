// Match reasons can carry team-only notes (compatibility-list notes, older review decisions).
// Customer-facing views use this version, which keeps only the reason category.
export function publicReason(reason) {
  const text = String(reason || '');
  if (/^From compatibility list/i.test(text)) return 'From compatibility list.';
  if (/^Product selected during review/i.test(text)) return 'Product selected during review.';
  return text;
}
