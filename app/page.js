import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { listQuotes, createQuoteFromPdf, getQuote, computeQuote, fmt } from '@/lib/quotes';
import { listCatalog } from '@/lib/catalog';
import { listCompat } from '@/lib/compat';
import { llmConfig, PROVIDERS, brand } from '@/lib/settings';
import { aiEnabled } from '@/lib/llm';
import SubmitButton from './submit-button';

async function upload(formData) {
  'use server';
  const files = formData.getAll('pdf').filter((f) => f && f.size);
  if (!files.length) redirect('/?error=Choose a PDF first');
  let last;
  for (const f of files) last = await createQuoteFromPdf(f.name, Buffer.from(await f.arrayBuffer()));
  revalidatePath('/');
  redirect(files.length === 1 ? `/quotes/${last}` : '/');
}

export default async function Home({ searchParams }) {
  const sp = await searchParams;
  const quotes = listQuotes();
  const catalogCount = listCatalog().length;
  const compatCount = listCompat().length;
  const cfg = llmConfig();
  const b = brand();
  const ai = aiEnabled(cfg);

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
          <div className="drop">
            <input type="file" name="pdf" accept="application/pdf,.pdf" multiple required />
            <p className="muted small">PDF quotes. You can pick several at once.</p>
          </div>
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

      <h2>Recent quotes</h2>
      {quotes.length === 0 ? (
        <p className="muted">No quotes yet.</p>
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
                <th>Status</th>
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
                    </td>
                    <td>{q.line_count}</td>
                    <td className="num">{c ? fmt(c.totals.savings) : '—'}</td>
                    <td>
                      {q.status === 'error' ? <span className="pill low">Error</span> : q.status === 'done' ? <span className="pill high">Confirmed</span> : <span className="pill medium">To review</span>}
                    </td>
                    <td className="small muted">{q.created_at?.slice(0, 16)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
