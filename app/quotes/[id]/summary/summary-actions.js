'use client';
import { useState } from 'react';
export default function SummaryActions({ text, ready }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  return <>
    <button className="primary" disabled={!ready} onClick={() => window.print()}>Print / save as PDF</button>
    <button disabled={!ready} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setError(''); setTimeout(() => setCopied(false), 2000); }
      catch { setError('Copy failed. Use Print / save as PDF, or copy the page text manually.'); }
    }}>{copied ? 'Copied' : 'Copy as text'}</button>
    {error && <span className="error small" role="alert">{error}</span>}
  </>;
}
