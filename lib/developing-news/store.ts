import type {Thread,PublicNews,Roster,Run,Article} from './types';
import {publicThread} from './types';

const stop=new Set('the and for with from that this have will into they their about after before been more than which what when were has are was not its new how why can but all you your our out'.split(' '));
export function searchTerms(text:string,limit=48):string[] {
 const counts=new Map<string,number>();
 for(const word of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,39}/gu)??[])if(!stop.has(word))counts.set(word,(counts.get(word)??0)+1);
 return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,limit).map(([word])=>word);
}
export class DevelopingStore {
 constructor(private sql:SqlStorage){
  sql.exec('CREATE TABLE IF NOT EXISTS dn_threads (id TEXT PRIMARY KEY, status TEXT NOT NULL, published INTEGER NOT NULL, updated TEXT NOT NULL, data TEXT NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS dn_roster ON dn_threads(status,published,updated)');
  sql.exec('CREATE TABLE IF NOT EXISTS dn_terms (term TEXT NOT NULL, thread_id TEXT NOT NULL, PRIMARY KEY(term,thread_id))');
  sql.exec('CREATE TABLE IF NOT EXISTS dn_urls (url TEXT NOT NULL, thread_id TEXT NOT NULL, PRIMARY KEY(url,thread_id))');
  sql.exec('CREATE TABLE IF NOT EXISTS dn_updates (thread_id TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(thread_id,id))');
  sql.exec('CREATE INDEX IF NOT EXISTS dn_timeline ON dn_updates(thread_id,at)');
  sql.exec('CREATE TABLE IF NOT EXISTS dn_state (key TEXT PRIMARY KEY, data TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS dn_seen (id INTEGER PRIMARY KEY, at TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS dn_inbox (id INTEGER PRIMARY KEY, score INTEGER NOT NULL, related INTEGER NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS dn_deferred (id INTEGER PRIMARY KEY, retry_at TEXT NOT NULL, attempts INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS dn_requests (id TEXT PRIMARY KEY, at TEXT NOT NULL, request TEXT NOT NULL, response TEXT)');
 }
 get<T>(key:string):T|null {const r=this.sql.exec<{data:string}>('SELECT data FROM dn_state WHERE key=?',key).toArray()[0];return r?JSON.parse(r.data):null;}
 set(key:string,value:unknown){this.sql.exec('INSERT INTO dn_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data',key,JSON.stringify(value));}
 roster():Roster{return this.get<Roster>('roster')??{revision:0,initialized:false,lastPromotionAt:null,lastRunAt:null};}
 run():Run|null{return this.get<Run>('run');}
 runSummary(){const r=this.run();return r?{id:r.id,asOf:r.asOf,remaining:r.queue.length,assessed:r.results.length,failed:r.failed,failures:r.failures??[]}:null;}
 diagnostics(){return {
  threads:this.sql.exec('SELECT status,published,COUNT(*) AS count FROM dn_threads GROUP BY status,published').toArray(),
  inbox:this.sql.exec('SELECT COUNT(*) AS count FROM dn_inbox').toArray()[0],
  deferred:this.sql.exec('SELECT id,retry_at,attempts FROM dn_deferred ORDER BY retry_at DESC LIMIT 10').toArray(),
  requests:this.sql.exec("SELECT CASE WHEN json_type(request,'$.questions') IS NOT NULL THEN 'decisions' ELSE 'responses' END AS endpoint,COALESCE(json_extract(response,'$.status'),CASE WHEN response IS NULL THEN 'unsettled' ELSE 'returned' END) AS status,json_extract(response,'$.incomplete_details.reason') AS incomplete_reason,COUNT(*) AS count,SUM(json_extract(response,'$.usage.input_tokens')) AS input_tokens,SUM(json_extract(response,'$.usage.output_tokens')) AS output_tokens FROM dn_requests GROUP BY endpoint,status,incomplete_reason").toArray()
 };}
 thread(id:string,before?:string):Thread|null {
  const row=this.sql.exec<{data:string}>('SELECT data FROM dn_threads WHERE id=?',id).toArray()[0];if(!row)return null;
  const updates=this.sql.exec<{data:string}>('SELECT data FROM dn_updates WHERE thread_id=? AND at<? ORDER BY at DESC,id DESC LIMIT 50',id,before??'9999').toArray().map(r=>JSON.parse(r.data));
  const thread=JSON.parse(row.data) as Thread;
  const first=thread.followingSince??(thread.published?this.sql.exec<{at:string|null}>('SELECT MIN(at) AS at FROM dn_updates WHERE thread_id=?',id).toArray()[0]?.at:null)??null;
  return {...thread,followingSince:first,updates};
 }
 // Authorize against the permanent timeline, including updates beyond page one.
 hasDiscussion(threadId:string,hnId:number):boolean {
  const row=this.sql.exec<{data:string}>('SELECT data FROM dn_threads WHERE id=? AND published=1',threadId).toArray()[0];
  if(!row)return false;
  if(this.sql.exec("SELECT id FROM dn_updates WHERE thread_id=? AND json_extract(data,'$.source.hnId')=? LIMIT 1",threadId,hnId).toArray().length)return true;
  // Legacy updates may predate hnId. Require the same retained source hash AND URL.
  const thread=JSON.parse(row.data) as Thread;
  return thread.evidence.some(e=>e.id===String(hnId)&&this.sql.exec("SELECT id FROM dn_updates WHERE thread_id=? AND json_extract(data,'$.source.hnId') IS NULL AND json_extract(data,'$.sourceHash')=? AND json_extract(data,'$.source.url')=? LIMIT 1",threadId,e.hash,e.url).toArray().length>0);
 }
 active():Thread[]{return this.sql.exec<{id:string}>("SELECT id FROM dn_threads WHERE status='active' ORDER BY updated DESC,id LIMIT 5").toArray().map(r=>this.thread(r.id)!);}
 save(thread:Thread){
  this.sql.exec('INSERT INTO dn_threads VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,published=excluded.published,updated=excluded.updated,data=excluded.data',thread.id,thread.status,Number(thread.published),thread.lastMaterialAt,JSON.stringify({...thread,updates:[]}));
  this.sql.exec('DELETE FROM dn_terms WHERE thread_id=?',thread.id);
  for(const term of searchTerms(thread.terms.join(' ')+' '+thread.title+' '+thread.question,64))this.sql.exec('INSERT OR IGNORE INTO dn_terms VALUES (?,?)',term,thread.id);
  for(const source of thread.evidence)this.sql.exec('INSERT OR IGNORE INTO dn_urls VALUES (?,?)',source.url,thread.id);
  for(const update of thread.updates)this.sql.exec('INSERT OR IGNORE INTO dn_updates VALUES (?,?,?,?)',thread.id,update.id,update.at,JSON.stringify(update));
 }
 matches(text:string,url:string):Thread[]{
  const exact=this.sql.exec<{thread_id:string}>('SELECT thread_id FROM dn_urls WHERE url=? LIMIT 5',url).toArray();
  const terms=searchTerms(text),slots=terms.map(()=>'?').join(',');
  const ranked=terms.length?this.sql.exec<{thread_id:string}>(`SELECT thread_id,COUNT(*) AS hits FROM dn_terms WHERE term IN (${slots}) GROUP BY thread_id HAVING hits>=2 ORDER BY hits DESC,thread_id LIMIT 5`,...terms).toArray():[];
  return [...new Set([...exact,...ranked].map(r=>r.thread_id))].slice(0,5).map(id=>this.thread(id)!);
 }
 seen(id:number){return this.sql.exec('SELECT id FROM dn_seen WHERE id=?',id).toArray().length>0;}
 markSeen(id:number,at:string){this.sql.exec('INSERT OR IGNORE INTO dn_seen VALUES (?,?)',id,at);}
 ingest(articles:Article[],at:string){
  for(const a of articles){if(this.seen(a.id))continue;const related=this.matches(a.title,a.url).length>0;
   this.sql.exec('INSERT INTO dn_inbox VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET score=excluded.score,related=MAX(dn_inbox.related,excluded.related)',a.id,a.score,Number(related),at,JSON.stringify({id:a.id,title:a.title,url:a.url,time:a.time,score:a.score}));}
  this.sql.exec('DELETE FROM dn_inbox WHERE at<? OR id IN (SELECT id FROM dn_seen)',new Date(Date.parse(at)-7*86400_000).toISOString());
 }
 candidates():Article[]{return this.sql.exec<{data:string}>('SELECT i.data FROM dn_inbox i LEFT JOIN dn_deferred d ON i.id=d.id WHERE i.id NOT IN (SELECT id FROM dn_seen) AND (d.id IS NULL OR (d.retry_at<=? AND d.attempts<3)) ORDER BY i.related DESC,i.score DESC,i.id LIMIT 5',new Date().toISOString()).toArray().map(r=>JSON.parse(r.data));}
 defer(id:number){this.sql.exec('INSERT INTO dn_deferred VALUES (?,?,1) ON CONFLICT(id) DO UPDATE SET retry_at=excluded.retry_at,attempts=dn_deferred.attempts+1',id,new Date(Date.now()+48*3600_000).toISOString());}
 journal(key:string,request:unknown,response?:unknown){this.sql.exec('INSERT INTO dn_requests VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET response=COALESCE(excluded.response,dn_requests.response)',key,new Date().toISOString(),JSON.stringify(request),response?JSON.stringify(response):null);}
 // Full requests are private and retained for 30 days. Permanent public
 // timelines retain links and content hashes. Uncertain budget reservations
 // remain in Newsroom and are never deleted or refunded by this retention job.
 prune(now:number){this.sql.exec('DELETE FROM dn_requests WHERE at<?',new Date(now-30*86400_000).toISOString());}
 publicList(cursor?:string):PublicNews {
  const rows=this.sql.exec<{id:string}>("SELECT id FROM dn_threads WHERE published=1 AND status='quiet' AND id>? ORDER BY id LIMIT 21",cursor??'').toArray();
  return {active:this.active().filter(t=>t.published).map(publicThread),quiet:rows.slice(0,20).map(r=>publicThread(this.thread(r.id)!)),nextCursor:rows.length>20?rows[19].id:null};
 }
}
