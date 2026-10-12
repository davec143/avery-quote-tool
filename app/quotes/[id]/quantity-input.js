'use client';
import { useState } from 'react';
export default function QuantityInput({ id, line, quantity, mode = 'auto' }) {
  const [selected, setSelected] = useState(mode);
  return <>
    <select aria-label={`Quantity mode for line ${line}`} name={`mode_${id}`} value={selected} onChange={(e) => setSelected(e.target.value)}>
      <option value="auto">Calculate from requirements</option><option value="manual">Reviewed manual quantity</option>
    </select>
    <input aria-label={`Avery pieces for line ${line}`} name={`oq_${id}`} type="number" min={selected === 'manual' ? '1' : '0'} step="1" required defaultValue={quantity}
      readOnly={selected === 'auto'} style={{ width: 80 }} />
  </>;
}
