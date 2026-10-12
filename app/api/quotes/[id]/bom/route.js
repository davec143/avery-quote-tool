import { requireAuth } from '@/lib/auth';
import { getQuote,summaryDocument } from '@/lib/quotes';
import { purchaseCsv,reviewedExpectation } from '@/lib/exports';
export async function GET(req,{params}) {
  await requireAuth();const {id}=await params,q=getQuote(Number(id));if(!q) return new Response('Not found',{status:404});
  const document=summaryDocument(q), expectation=new URL(req.url).searchParams.has('benchmark');
  if(!document.ready) return new Response('Confirm the comparison before exporting.',{status:409});
  if(q.valid_until && q.valid_until<new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())) return new Response('Comparison expired; review current pricing.',{status:409});
  return new Response(expectation ? JSON.stringify(reviewedExpectation(document),null,2) : purchaseCsv(document),{headers:{'content-type':expectation ? 'application/json' : 'text/csv; charset=utf-8','content-disposition':`attachment; filename="AQ-${q.id}-${expectation ? 'expectations.json' : 'purchase.csv'}"`,'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
