'use client';
import { useState } from 'react';

export default function SummaryActions({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button className="primary" onClick={() => window.print()}>
        Print / save as PDF
      </button>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? 'Copied' : 'Copy as text'}
      </button>
    </>
  );
}
