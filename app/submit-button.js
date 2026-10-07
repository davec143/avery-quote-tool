'use client';
import { useFormStatus } from 'react-dom';

export default function SubmitButton({ label, pending, className = 'primary', name, value, confirmMessage }) {
  const { pending: busy } = useFormStatus();
  return (
    <button onClick={confirmMessage ? (event) => { if (!window.confirm(confirmMessage)) event.preventDefault(); } : undefined} className={className} disabled={busy} name={name} value={value}>
      {busy ? pending || 'Working…' : label}
    </button>
  );
}
