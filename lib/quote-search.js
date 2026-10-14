import { db } from './db.js';
import { todayEastern } from './readiness.js';

export function searchQuotes({query='',status='',outcome='',page=1}={}) {
  query=String(query).trim().slice(0,200);
  status=['review','done','error','processing','expired'].includes(status) ? status : '';
  outcome=['open','reviewing','accepted','declined'].includes(outcome) ? outcome : '';
  const where=[],args=[];
  if(query) {
    where.push(`(instr(lower(COALESCE(q.customer,'') || ' ' || COALESCE(q.job_name,'') || ' ' || COALESCE(q.quote_number,'') || ' ' || COALESCE(q.filename,'') || ' ' || COALESCE(q.competitor,'') || ' ' || q.id),lower(?))>0 OR EXISTS (SELECT 1 FROM quote_lines l WHERE l.quote_id=q.id AND instr(lower(COALESCE(l.comp_sku,'') || ' ' || COALESCE(l.our_sku,'')),lower(?))>0))`);
    args.push(query,query);
  }
  if(status==='expired') {where.push("q.status='done' AND q.summary_snapshot IS NOT NULL AND q.valid_until<>'' AND q.valid_until<?");args.push(todayEastern());}
  else if(status) {where.push('q.status=?');args.push(status);}
  if(outcome) {where.push("COALESCE(q.outcome,'open')=?");args.push(outcome);}
  const clause=where.length ? ' WHERE '+where.join(' AND ') : '';
  const total=db().prepare('SELECT COUNT(*) AS n FROM quotes q'+clause).get(...args).n;
  const pageSize=25,pages=Math.max(1,Math.ceil(total/pageSize));
  page=Math.min(pages,Math.max(1,Math.floor(Number(page)) || 1));
  const quotes=db().prepare(`SELECT q.*, (SELECT COUNT(*) FROM quote_lines l WHERE l.quote_id=q.id) AS line_count FROM quotes q ${clause} ORDER BY q.id DESC LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize);
  return {quotes,total,page,pages,query,status,outcome};
}
