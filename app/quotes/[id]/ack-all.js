'use client';
/** Ticks every "I understand" box on the page (full-pack minimums) in one click. */
export default function AckAll({ count }) {
  return <button type="button" onClick={(e) => {
    for (const box of e.currentTarget.form.querySelectorAll('input[type=checkbox][name^="ack_"]')) box.checked = true;
    e.currentTarget.textContent = 'All acknowledged — now Save';
  }}>Acknowledge all {count}</button>;
}
