'use client';
import { useState } from 'react';

export default function SourceReview({ id, mime, hasFile, text, children, compact = false }) {
  const [search,setSearch]=useState(''),[view,setView]=useState('text');
  const raw=text || 'No readable source text is available yet.';
  const index=search.trim() ? raw.toLowerCase().indexOf(search.trim().toLowerCase()) : -1;
  const [open,setOpen]=useState(false);
  const Panel=compact ? 'details' : 'aside';
  return <div className={`source-workspace ${compact ? 'compact' : ''}`} onClick={(e)=>{const b=e.target.closest('[data-source-sku]');if(b){setSearch(b.dataset.sourceSku);setView('text');setOpen(true);}}}>
    <Panel className="source-panel no-print" {...(compact ? {open,onToggle:(e)=>setOpen(e.currentTarget.open)} : {})}>
      {compact ? <summary><b>Their original quote</b> <span className="small muted">— open to check what we read</span></summary> : <h3>Original source</h3>}
      <div className="row"><button type="button" onClick={()=>setView('text')}>Searchable text</button>{hasFile && <button type="button" onClick={()=>setView('original')}>Original {mime?.startsWith('image/') ? 'image' : 'PDF'}</button>}</div>
      {view==='original' && hasFile ? mime?.startsWith('image/') ? <a href={`/api/quotes/${id}/pdf`} target="_blank" rel="noreferrer"><img className="source-image" src={`/api/quotes/${id}/pdf`} alt="Original competitor quote" /></a> : <iframe title="Original competitor quote PDF" src={`/api/quotes/${id}/pdf`} className="source-pdf" /> : <>
        <label>Find SKU or source text<input value={search} onChange={(e)=>setSearch(e.target.value)} /></label>
        {search && index<0 && <p className="error small" role="status">No matching text found. Check the original file.</p>}
        <pre className="source-text">{index<0 ? raw : <>{raw.slice(0,index)}<mark tabIndex={-1} ref={(el)=>{if(el) el.scrollIntoView({block:'nearest'});}}>{raw.slice(index,index+search.trim().length)}</mark>{raw.slice(index+search.trim().length)}</>}</pre>
      </>}
      <p className="small muted">{compact ? 'This is the text we read from the file. If something is wrong, fix it under "Edit what we read" on that item.' : 'Image text is an AI transcription. Verify it against the original image. Source corrections preserve the original upload and are recorded in review history.'}</p>
    </Panel>
    <div className="source-editor">{children}</div>
  </div>;
}
