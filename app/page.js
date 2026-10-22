import { requireAdmin } from '@/lib/access';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createQuoteFromSource, getQuote, computeQuote, fmt } from '@/lib/quotes';
import { listCatalog } from '@/lib/catalog';
import { listCompat } from '@/lib/compat';
import { llmConfig, PROVIDERS, brand } from '@/lib/settings';
import { aiEnabled } from '@/lib/llm';
import SubmitButton from './submit-button';
import UploadInput from './upload-input';
import { searchQuotes } from '@/lib/quote-search';
import { todayEastern } from '@/lib/readiness';
import { validateUploads, sourceMime } from '@/lib/uploads';
import { listMemberSubmissions } from '@/lib/portal';

async function upload(formData) {
  'use server';
  await requireAdmin();
  const files = formData.getAll('pdf').filter((f) => f && f.size);
  try { validateUploads(files); } catch (e) { redirect(`/?error=${encodeURIComponent(e.message)}`); }
  if (!listCatalog().length) redirect('/?error=Load the Avery catalog before comparing a quote');
  const buffers = await Promise.all(files.map((f) => f.arrayBuffer().then((b) => Buffer.from(b))));
  try { buffers.forEach((b,i) => sourceMime(files[i].name,b)); } catch (e) { redirect(`/?error=${encodeURIComponent(e.message)}`); }
  let last;
  for (const [i, f] of files.entries()) last = await createQuoteFromSource(f.name, buffers[i]);
  revalidatePath('/');
  if (files.length !== 1) redirect('/');
  // Open the draft proposal first; quotes that could not be read go straight to the review screen to fix.
  redirect(getQuote(last)?.status === 'error' ? `/quotes/${last}` : `/quotes/${last}/summary`);
}

export default async function Home({ searchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const results=searchQuotes({query:sp?.q,status:sp?.status,outcome:sp?.outcome,page:sp?.page});
  const {quotes}=results;
  const pageLink=(page)=>'/?'+new URLSearchParams({q:results.query,status:results.status,outcome:results.outcome,page:String(page)});
  const today=todayEastern();
  const catalogCount = listCatalog().length;
  const compatCount = listCompat().length;
  const cfg = llmConfig();
  const b = brand();
  const ai = aiEnabled(cfg);
  const memberQueue = listMemberSubmissions();

  return (
    <>
      <div className="spread">
        <div>
          <h1>Competitor quotes</h1>
          <p className="muted">Upload a competitor quote, check the matches, then send the branded savings summary.</p>
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <form action={upload} className="card">
          <h3>New quote</h3>
          <UploadInput />
          {sp?.error && <p className="error">{sp.error}</p>}
          <div style={{ marginTop: 12 }}>
            <SubmitButton label="Compare quote" pending="Reading and matching…" />
          </div>
        </form>

        <div className="card">
          <h3>Setup</h3>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li className={catalogCount ? 'ok' : 'error'}>
              Catalog: {catalogCount ? `${catalogCount} Avery products loaded` : 'not loaded'} — <Link href="/catalog">manage</Link>
            </li>
            <li className={compatCount ? 'ok' : 'muted'}>
              Compatibility list: {compatCount ? `${compatCount} rows` : 'empty (the tool will search for substitutes)'} — <Link href="/compatibility">upload</Link>
            </li>
            <li className={ai ? 'ok' : 'muted'}>
              AI: {ai ? `${PROVIDERS[cfg.provider]?.label} · ${cfg.model}` : 'off — using built-in rules'} — <Link href="/settings">change</Link>
            </li>
            <li className={b.intakeEmail ? 'ok' : 'muted'}>
              Intake email: {b.intakeEmail || 'not set yet'} — <Link href="/settings">set</Link>
            </li>
          </ul>
        </div>
      </div>

      {memberQueue.length > 0 && <section className="card" style={{ marginTop: 16 }} aria-label="Member submissions">
        <h3>Member quotes not yet confirmed ({memberQueue.length})</h3>
        <p className="small muted">Approved partners compare their own quotes at averyled.com/apps/quote. You can open any of them to help; the member sees your changes.</p>
        <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
          {memberQueue.map((q) => <li key={q.id}><Link href={`/quotes/${q.id}`}>AQ-{q.id} · {q.portal_project || q.job_name || q.filename}</Link> — {[q.portal_customer_name, q.portal_company].filter(Boolean).join(', ') || 'Member'} · {q.state.label} · {q.created_at?.slice(0, 16)}</li>)}
        </ul>
      </section>}

      <h2>Find a quote</h2>
      <form action="/" method="get" className="quote-search card">
        <label>Search<input type="search" name="q" defaultValue={results.query} placeholder="Customer, project, quote or SKU" /></label>
        <label>Review status<select name="status" defaultValue={results.status}><option value="">All statuses</option><option value="review">To review</option><option value="done">Confirmed</option><option value="expired">Expired confirmed quotes</option><option value="error">Error</option><option value="processing">Processing</option></select></label>
        <label>Customer outcome<select name="outcome" defaultValue={results.outcome}><option value="">All outcomes</option><option value="open">Open</option><option value="reviewing">Customer reviewing</option><option value="accepted">Customer accepted</option><option value="declined">Customer declined</option></select></label>
        <button type="submit">Search quotes</button><Link href="/">Clear</Link>
      </form>
      <p className="small muted">{results.total} quote{results.total===1 ? '' : 's'} found · page {results.page} of {results.pages}</p>
      {quotes.length === 0 ? (
        <p className="muted">No quotes match these filters. Clear the filters or upload a new quote.</p>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Quote</th>
                <th>Job / customer</th>
                <th>Lines</th>
                <th className="num">Savings shown</th>
                <th>Status / outcome</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const full = q.status === 'error' ? null : getQuote(q.id);
                const c = full ? computeQuote(full) : null;
                return (
                  <tr key={q.id}>
                    <td>{q.id}</td>
                    <td>
                      <Link href={`/quotes/${q.id}`}>{q.quote_number || q.filename}</Link>
                      <div className="muted small">{q.competitor || ''}</div>
                    </td>
                    <td>
                      {q.job_name || '—'}
                      <div className="muted small">{q.customer || ''}</div>
                      {q.shopify_customer_id && <div className="small"><span className="pill medium">Member</span></div>}
                    </td>
                    <td>{q.line_count}</td>
                    <td className="num">{c?.totals.savings == null ? '—' : fmt(c.totals.savings)}{c?.counts.unpricedIncluded > 0 && <div className="muted small">{c.counts.priced ? 'Priced lines only' : 'Avery pricing only'}</div>}</td>
                    <td>
                      {q.status === 'error' ? <span className="pill low">Error</span> : q.status === 'done' && q.summary_snapshot ? <span className="pill high">Confirmed</span> : <span className="pill medium">{q.status==='processing' ? 'Processing' : 'To review'}</span>}
                      <div className="small muted">{{open:'Open',reviewing:'Customer reviewing',accepted:'Customer accepted',declined:'Customer declined'}[q.outcome] || 'Open'}</div>
                      {q.valid_until && <div className={q.valid_until<today ? 'small error' : 'small muted'}>{q.valid_until<today ? 'Expired' : 'Valid until'} {q.valid_until}</div>}
                    </td>
                    <td className="small muted">{q.created_at?.slice(0, 16)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {results.pages>1 && <nav className="row" aria-label="Quote pages" style={{marginTop:16}}>{results.page>1 && <Link className="btn" href={pageLink(results.page-1)}>Previous</Link>}<span>Page {results.page} of {results.pages}</span>{results.page<results.pages && <Link className="btn" href={pageLink(results.page+1)}>Next</Link>}</nav>}
    </>
  );
}
