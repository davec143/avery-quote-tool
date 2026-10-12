'use client';
import { useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { validateUploads } from '@/lib/uploads';

export default function UploadInput() {
  const input = useRef(null);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const { pending } = useFormStatus();
  function choose(next) {
    try {
      if (next.length) validateUploads(next);
      const transfer = new DataTransfer();
      next.forEach((f) => transfer.items.add(f));
      input.current.files = transfer.files;
      setFiles(next); setError('');
    } catch (e) { setError(e.message); input.current.value = ''; setFiles([]); }
  }
  return <div className={`drop ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); if (!pending) setDragging(true); }}
    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
    onDrop={(e) => { e.preventDefault(); setDragging(false); if (!pending) choose(Array.from(e.dataTransfer.files)); }}>
    <p><b>Drop quote PDFs or screenshots here</b></p>
    <label>Or choose files
      <input ref={input} type="file" name="pdf" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" multiple required disabled={pending}
        onChange={(e) => choose(Array.from(e.target.files))} />
    </label>
    <p className="muted small">PDF, JPEG or PNG · up to 5 files · 10 MB per file · 18 MB per batch.</p>
    <p className="muted small">Screenshots are read using the vision-capable AI model selected in Settings. Text PDFs also work with AI off.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {files.length > 0 && <ul className="upload-files">{files.map((f, i) => <li key={`${f.name}-${i}`}><span>{f.name} ({(f.size / 1024 / 1024).toFixed(2)} MB)</span>
      <button type="button" disabled={pending} aria-label={`Remove ${f.name}`} onClick={() => choose(files.filter((_, n) => n !== i))}>Remove</button></li>)}</ul>}
  </div>;
}
