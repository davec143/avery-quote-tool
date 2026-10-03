'use client';
import { useFormStatus } from 'react-dom';

export default function SubmitButton({ label, pending, className = 'primary', name, value }) {
  const { pending: busy } = useFormStatus();
  return (
    <button className={className} disabled={busy} name={name} value={value}>
      {busy ? pending || 'Working…' : label}
    </button>
  );
}
