import { db } from './db.js';

export function recordEvent(d, quoteId, revision, type, actor, details) {
  d.prepare('INSERT INTO quote_events (quote_id,revision,event_type,actor,details_json) VALUES (?,?,?,?,?)')
    .run(quoteId, revision, type, String(actor || '').trim() || 'Unspecified reviewer', JSON.stringify(details));
}
export function quoteHistory(id) {
  return db().prepare('SELECT * FROM quote_events WHERE quote_id=? ORDER BY id DESC LIMIT 100').all(id)
    .map((e) => ({ ...e, details:JSON.parse(e.details_json) }));
}
export function saveOutcome(id, form) {
  const d=db(), q=d.prepare('SELECT * FROM quotes WHERE id=?').get(id);
  if (!q || Number(form.get('revision')) !== q.revision) throw new Error('This quote changed. Reload before recording the outcome.');
  const outcome=String(form.get('outcome') || ''), note=String(form.get('outcome_note') || '').trim(), actor=String(form.get('actor') || '').trim();
  if (!['open','reviewing','accepted','declined'].includes(outcome)) throw new Error('Choose a valid customer outcome.');
  if (!actor) throw new Error('Enter your name to record the outcome.');
  if (outcome === 'declined' && !note) throw new Error('Record the reason the customer declined.');
  d.transaction(() => {
    const r=d.prepare('UPDATE quotes SET outcome=?,outcome_note=?,revision=revision+1 WHERE id=? AND revision=?').run(outcome,note,id,q.revision);
    if (!r.changes) throw new Error('This quote changed. Reload before recording the outcome.');
    recordEvent(d,id,q.revision+1,'outcome',actor,{before:q.outcome,after:outcome,note});
  })();
}
