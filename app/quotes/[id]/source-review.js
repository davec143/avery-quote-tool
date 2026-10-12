'use client';
import { useState } from 'react';

export default function SourceReview({ id, mime, hasFile, text, children }) {
  const [search,setSearch]=useState(''),[view,setView]=useState('text');
  const raw=text || 'No readable source text is available yet.';
  const index=search.trim() ? raw.toLowerCase().indexOf(search.trim().toLowerCase()) : -1;
  return <div className="source-workspace" onClick={(e)=>{const b=e.target.closest('[data-source-sku]');if(b){setSearch(b.dataset.sourceSku);setView('text');}}}>
    <aside className="source-panel no-print">
      <h3>Original source</h3>
      <div className="row"><button type="button" onClick={()=>setView('text')}>Searchable text</button>{hasFile && <button type="button" onClick={()=>setView('original')}>Original {mime?.startsWith('image/') ? 'image' : 'PDF'}</button>}</div>
      {view==='original' && hasFile ? mime?.startsWith('image/') ? <a href={`/api/quotes/${id}/pdf`} target="_blank" rel="noreferrer"><img className="source-image" src={`/api/quotes/${id}/pdf`} alt="Original competitor quote" /></a> : <iframe title="Original competitor quote PDF" src={`/api/quotes/${id}/pdf`} className="source-pdf" /> : <>
        <label>Find SKU or source text<input value={search} onChange={(e)=>setSearch(e.target.value)} /></label>
        {search && index<0 && <p className="error small" role="status">No matching text found. Check the original file.</p>}
        <pre className="source-text">{index<0 ? raw : <>{raw.slice(0,index)}<mark tabIndex={-1} ref={(el)=>{if(el) el.scrollIntoView({block:'nearest'});}}>{raw.slice(index,index+search.trim().length)}</mark>{raw.slice(index+search.trim().length)}</>}</pre>
      </>}
      <p className="small muted">Image text is an AI transcription. Verify it against the original image. Source corrections preserve the original upload and are recorded in review history.</p>
    </aside>
    <div className="source-editor">{children}</div>
  </div>;
}
