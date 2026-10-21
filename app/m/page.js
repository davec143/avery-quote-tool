// Member home: an approved Avery partner's own quotes, signed in with their averyled.com account.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireMember } from '@/lib/access';
import { createMemberQuotes, listMemberQuotes, reserveMemberUsage, MEMBER_DAILY_LIMIT } from '@/lib/portal';
import { getQuote } from '@/lib/quotes';
import { listCatalog } from '@/lib/catalog';
import { validateUploads, sourceMime } from '@/lib/uploads';
import { portalConfig } from '@/lib/shopify-portal';
import UploadInput from '../upload-input';
import SubmitButton from '../submit-button';

export const dynamic = 'force-dynamic';

async function upload(formData) {
  'use server';
  const actor = await requireMember();
  const files = formData.getAll('pdf').filter((f) => f && f.size);
  try { validateUploads(files); } catch (e) { redirect(`/m?error=${encodeURIComponent(e.message)}`); }
  if (!listCatalog().length) redirect('/m?error=The Quote Tool is temporarily unavailable. Please try again shortly.');
  const buffers = await Promise.all(files.map((f) => f.arrayBuffer().then((b) => Buffer.from(b))));
  try { buffers.forEach((b, i) => sourceMime(files[i].name, b)); } catch (e) { redirect(`/m?error=${encodeURIComponent(e.message)}`); }
  // Reserved atomically before any AI call, so parallel submissions can't exceed the daily allowance.
  if (!reserveMemberUsage(actor.customerId, 'upload', files.length, MEMBER_DAILY_LIMIT)) redirect(`/m?error=${encodeURIComponent(`You can compare up to ${MEMBER_DAILY_LIMIT} quotes a day. Contact our team if you need more today.`)}`);
  const ids = await createMemberQuotes(actor.member, files.map((f, i) => ({ name: f.name, buffer: buffers[i] })), { project: formData.get('project') || '' });
  revalidatePath('/m');
  if (ids.length !== 1) redirect('/m');
  // A file that couldn't be read opens the review screen, which explains the problem, instead of an empty draft.
  redirect(getQuote(ids[0])?.status === 'error' ? `/quotes/${ids[0]}` : `/quotes/${ids[0]}/summary`);
}

export default async function MemberHome({ searchParams }) {
  const actor = await requireMember();
  const sp = await searchParams;
  const quotes = listMemberQuotes(actor.customerId);
  const cfg = portalConfig();
  const store = `${cfg.storefront}${cfg.proxyPath}`;
  return <>
    <div className="spread">
      <div>
        <h1>Your quote comparisons</h1>
        <p className="muted">Signed in as {actor.member.name || actor.member.email || 'your Avery LED account'}{actor.member.company ? ` · ${actor.member.company}` : ''}. Only you can see these quotes.</p>
      </div>
    </div>
    <form action={upload} className="card" style={{ marginTop: 16 }}>
      <h3>Compare a competitor quote</h3>
      <p className="small muted">Upload the quote you received from another supplier. You'll see a draft Avery proposal right away, then review, adjust and confirm it.</p>
      <UploadInput member />
      <label className="small" style={{ display: 'block', marginTop: 12 }}>Project name (optional)<input name="project" maxLength={200} placeholder="e.g. Smith kitchen remodel" /></label>
      {sp?.error && <p className="error" role="alert">{sp.error}</p>}
      <div style={{ marginTop: 12 }}><SubmitButton label="Compare quote" pending="Reading and matching…" /></div>
    </form>
    <h2>Your quotes</h2>
    {!quotes.length ? <p className="muted">No quotes yet. Upload your first competitor quote above.</p> : <div className="tablewrap"><table>
      <thead><tr><th>#</th><th>Quote / project</th><th>Lines</th><th>Status</th><th>Added</th><th></th></tr></thead>
      <tbody>{quotes.map((q) => <tr key={q.id}>
        <td>AQ-{q.id}</td>
        <td><Link href={`/quotes/${q.id}/summary`}>{q.portal_project || q.job_name || q.quote_number || q.filename}</Link><div className="muted small">{[q.competitor, q.filename].filter(Boolean).join(' · ')}</div></td>
        <td>{q.line_count}</td>
        <td><span className={`pill ${q.state.key === 'ready' ? 'high' : q.state.key === 'attention' ? 'low' : 'medium'}`}>{q.state.label}</span></td>
        <td className="small muted">{q.created_at?.slice(0, 10)}</td>
        <td className="row">{q.state.key === 'attention' ? <Link href={`/quotes/${q.id}`}>Fix</Link> : <Link href={`/quotes/${q.id}`}>Review &amp; adjust</Link>}{q.state.orderable && <a className="btn primary" href={`${store}/q/${q.id}/buy?mode=add`}>Add all to cart</a>}</td>
      </tr>)}</tbody>
    </table></div>}
  </>;
}
