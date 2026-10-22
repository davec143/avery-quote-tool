'use client';
import { useState } from 'react';

/**
 * Quantity control for members. The calculated number is shown as text with a "Change" link;
 * typing a number switches the line to a manual quantity. When nothing could be calculated,
 * the input is shown straight away.
 */
export default function MemberQuantity({ id, line, quantity, mode = 'auto', problem = '', basis = '', unit = 'pieces' }) {
  const [manual, setManual] = useState(mode === 'manual' || !!problem);
  const name = `oq_${id}`;
  return <div className={`mq ${problem && !manual ? 'mq-problem' : ''}`}>
    <input type="hidden" name={`mode_${id}`} value={manual ? 'manual' : 'auto'} />
    {manual ? <>
      <label className="mq-label">How many Avery {unit} do you need?
        <input aria-label={`Avery pieces for line ${line}`} name={name} type="number" min="1" step="1" required defaultValue={quantity || ''} className="mq-input" autoFocus={!!problem} />
      </label>
      {mode !== 'manual' && !problem && <button type="button" className="linklike small" onClick={() => setManual(false)}>Use the calculated quantity instead</button>}
    </> : <>
      <input type="hidden" name={name} value={quantity} />
      <div className="mq-value"><b>{quantity}</b> {Number(quantity) === 1 ? unit.replace(/s$/, '') : unit} <button type="button" className="linklike small" onClick={() => setManual(true)}>Change</button></div>
      {basis && <div className="small muted">{basis}</div>}
    </>}
  </div>;
}
