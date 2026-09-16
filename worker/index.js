import content from '../data/content.json' with {type:'json'};
import {structure,canon,validateContent,validateStudents} from './validation.js';
const now=()=>Math.floor(Date.now()/1000);
const token=()=>crypto.randomUUID()+crypto.randomUUID();
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const check=(c,message,status=400)=>{if(!c)throw Object.assign(new Error(message),{status});};
const json=(data,status=200,headers={})=>Response.json(data,{status,headers});
function dbClient(env){const db=env.DB;return {db,devHTTP:env.DEV_HTTP===true,p:(sql,...args)=>db.prepare(sql).bind(...args),one:(sql,...args)=>db.prepare(sql).bind(...args).first(),all:async(sql,...args)=>(await db.prepare(sql).bind(...args).all()).results,run:(sql,...args)=>db.prepare(sql).bind(...args).run()};}
async function seed(d){
 if(await d.one("SELECT 1 FROM settings WHERE key='seed_v1'"))return;
 const p=d.p,stmts=[];
 for(const t of structure){stmts.push(p('INSERT OR IGNORE INTO tractates VALUES(?,?)',t.id,t.name));t.chapters.forEach((n,c)=>{stmts.push(p('INSERT OR IGNORE INTO chapters VALUES(?,?)',t.id,c+1));for(let m=1;m<=n;m++)stmts.push(p('INSERT OR IGNORE INTO mishnayot VALUES(?,?,?,?)',`${t.id}:${c+1}:${m}`,t.id,c+1,m));});}
 for(const r of content)stmts.push(p('INSERT OR IGNORE INTO content(mishnah_id,text,questions,status,source) VALUES(?,?,?,?,?)',r.id,r.text,JSON.stringify(r.questions),r.status,r.source||''));
 stmts.push(p("INSERT OR IGNORE INTO classes VALUES('demo-a','כיתת הדגמה א'),('demo-b','כיתת הדגמה ב')"));
 for(let i=1;i<=4;i++)stmts.push(p('INSERT OR IGNORE INTO students(id,name,class_id) VALUES(?,?,?)',`demo-${i}`,['תלמיד לדוגמה א','תלמידה לדוגמה ב','תלמיד לדוגמה ג','תלמידה לדוגמה ד'][i-1],i<=2?'demo-a':'demo-b'));
 stmts.push(p("INSERT OR IGNORE INTO rounds(id,number,started_at) VALUES(1,1,?)",now()),p("INSERT OR IGNORE INTO settings VALUES('cooldown_seconds','300'),('lease_seconds','900'),('seed_v1','1')"));
 await d.db.batch(stmts);
}
const current=d=>d.one('SELECT * FROM rounds WHERE finished_at IS NULL');
const cookie=req=>(req.headers.get('cookie')||'').match(/(?:^|;\s*)session=([^;]+)/)?.[1]||'';
async function makeSession(d,req,role,sid=null){
 const t=token(),csrf=token();
 await d.db.batch([d.p('DELETE FROM sessions WHERE token_hash=?',await hash(cookie(req))),d.p('INSERT INTO sessions VALUES(?,?,?,?,?)',await hash(t),sid,role,csrf,now()+28800)]);
 return json({role,student_id:sid,csrf,is_staff:sid?!!(await d.one('SELECT is_staff FROM students WHERE id=?',sid))?.is_staff:false},200,{'Set-Cookie':`session=${t}; Path=/; HttpOnly; ${d.devHTTP?'':'Secure; '}SameSite=Strict; Max-Age=28800`});
}
async function auth(d,req){
 const s=await d.one('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',await hash(cookie(req)),now());check(s,'נדרשת כניסה',401);
 if(s.role==='student')check((await d.one('SELECT active FROM students WHERE id=?',s.student_id))?.active,'החשבון אינו פעיל',403);
 if(req.method==='POST')check(req.headers.get('X-CSRF-Token')===s.csrf,'רעננו את העמוד ונסו שוב',403);
 return s;
}
async function login(d,req,env,b){
 const role=b.role||'school';check(['school','admin'].includes(role),'סוג כניסה לא תקין');
 check(typeof b.password==='string'&&b.password.length<=500,'סיסמה לא תקינה');
 const secret=role==='admin'?env.ADMIN_PASSWORD:env.SCHOOL_CODE;check(secret&&secret.length>=(role==='admin'?12:4),'הכניסה עדיין לא הוגדרה',503);
 const key=await hash((req.headers.get('CF-Connecting-IP')||'unknown')+role),time=now();
 await d.run('INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN until_at>? THEN attempts+1 ELSE 1 END,until_at=CASE WHEN until_at>? THEN until_at ELSE excluded.until_at END',key,time+900,time,time);
 const limit=await d.one('SELECT attempts FROM login_limits WHERE key=?',key);check(limit.attempts<=30,'בוצעו ניסיונות רבים. נסו שוב בעוד 15 דקות.',429);
 check(await hash(b.password)===await hash(secret),'הקוד או הסיסמה אינם נכונים',401);
 await d.run('DELETE FROM login_limits WHERE key=?',key);return makeSession(d,req,role);
}
async function acquire(d,sid,mid){
 check(!mid||canon.has(mid),'מזהה משנה לא תקין');const t=now(),lid=token();
 await d.db.batch([
 d.p("UPDATE leases SET result='expired' WHERE result IS NULL AND expires_at<=?",t),
 d.p('DELETE FROM sessions WHERE expires_at<=?',t),d.p('DELETE FROM cooldowns WHERE until_at<=?',t),
 d.p(`INSERT OR IGNORE INTO leases(id,round_id,mishnah_id,student_id,expires_at,content_revision,text,questions)
 SELECT ?,r.id,c.mishnah_id,?,?+CAST((SELECT value FROM settings WHERE key='lease_seconds') AS INTEGER),c.revision,c.text,c.questions
 FROM content c CROSS JOIN rounds r WHERE c.status='ready' AND r.finished_at IS NULL AND (? IS NULL OR c.mishnah_id=?)
 AND NOT EXISTS(SELECT 1 FROM completions x WHERE x.round_id=r.id AND x.mishnah_id=c.mishnah_id AND x.revoked_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM leases l WHERE l.round_id=r.id AND l.mishnah_id=c.mishnah_id AND l.result IS NULL)
 AND EXISTS(SELECT 1 FROM students WHERE id=? AND active=1) ORDER BY random() LIMIT 1`,lid,sid,t,mid||null,mid||null,sid)]);
 const l=await d.one('SELECT * FROM leases WHERE student_id=? AND result IS NULL',sid);
 check(l,'אין כרגע משנה מוכנה ופנויה עבורך. אפשר לנסות שוב בהמשך.',409);return {id:l.id,mishnah_id:l.mishnah_id,text:l.text,expires_at:l.expires_at};
}
async function owned(d,lid,sid){const l=await d.one('SELECT * FROM leases WHERE id=? AND student_id=?',lid||'',sid);check(l,'הלימוד לא נמצא',404);return l;}
const random=n=>{const a=new Uint32Array(1),max=Math.floor(4294967296/n)*n;do{crypto.getRandomValues(a);}while(a[0]>=max);return a[0]%n;};
const studyLease=l=>({id:l.id,mishnah_id:l.mishnah_id,text:l.text,expires_at:l.expires_at});
const feedback=q=>({result:'wrong',selected:q.options.find(o=>o.id===q.selected_id),correct:q.options.find(o=>o.id===q.correct_id)});
async function reread(d,lid,sid){
 const l=await owned(d,lid,sid);check(!l.result&&l.expires_at>now(),'זמן הלימוד הסתיים. בחרו משנה מחדש.',409);
 const q=l.challenge?JSON.parse(l.challenge):null;
 if(q?.answered){
  const qs=JSON.parse(l.questions),index=Number.isInteger(q.index)?q.index:qs.findIndex(x=>x.prompt===q.prompt);
  await d.run('UPDATE leases SET challenge=? WHERE id=? AND challenge=? AND result IS NULL AND expires_at>?',JSON.stringify({reading:true,next_index:(Math.max(index,0)+1)%qs.length}),lid,l.challenge,now());
 }
 return studyLease(l);
}
async function challenge(d,lid,sid){
 const l=await owned(d,lid,sid);check(!l.result&&l.expires_at>now(),'זמן הלימוד הסתיים. בחרו משנה מחדש.',409);
 const previous=l.challenge?JSON.parse(l.challenge):null;
 check(!previous?.answered,'חזרו לקריאת המשנה לפני השאלה הבאה.',409);
 if(!previous||previous.reading){const qs=JSON.parse(l.questions),index=previous?.next_index??random(qs.length),q=qs[index],opts=[...q.options];for(let i=opts.length-1;i>0;i--){const j=random(i+1);[opts[i],opts[j]]=[opts[j],opts[i]];}
 const result={index,prompt:q.prompt,hint:q.hint||'',options:opts.map(text=>({id:token(),text}))};result.correct_id=result.options.find(o=>o.text===q.correct).id;
 await d.run('UPDATE leases SET challenge=? WHERE id=? AND challenge IS ? AND result IS NULL AND expires_at>?',JSON.stringify(result),lid,l.challenge,now());}
 const saved=await owned(d,lid,sid);check(!saved.result&&saved.expires_at>now()&&saved.challenge,'זמן הלימוד הסתיים',409);
 const q=JSON.parse(saved.challenge);check(!q.answered&&!q.reading,'חזרו לקריאת המשנה לפני השאלה הבאה.',409);
 const {correct_id,index,...publicQuestion}=q;return publicQuestion;
}
async function answer(d,lid,sid,option){
 let l=await owned(d,lid,sid);
 if(!['correct','taken'].includes(l.result)){
  const taken=await d.one('SELECT 1 FROM completions WHERE round_id=? AND mishnah_id=? AND revoked_at IS NULL',l.round_id,l.mishnah_id);
  if(taken){await d.run("UPDATE leases SET result='taken' WHERE id=? AND (result IS NULL OR result IN('expired','released'))",lid);return {result:'taken'};}
  check(!l.result&&l.expires_at>now(),'הנעילה פגה. בחרו משנה מחדש.',409);check(l.challenge,'יש לקרוא את המשנה לפני השאלה');
  const q=JSON.parse(l.challenge);check(q.options?.some(o=>o.id===option),'אפשרות תשובה לא תקינה');
  if(q.answered)return feedback(q);
  const correct=option===q.correct_id;
  // Compare-and-swap the challenge too: concurrent answers cannot change a recorded attempt.
  // Wrong answers retain the lock; only a reread opens the other question.
  const next=correct?l.challenge:JSON.stringify({...q,answered:true,selected_id:option});
  await d.run(`UPDATE leases SET challenge=?,result=CASE WHEN EXISTS(SELECT 1 FROM completions x WHERE x.round_id=leases.round_id AND x.mishnah_id=leases.mishnah_id AND x.revoked_at IS NULL) THEN 'taken' ELSE ? END
    WHERE id=? AND student_id=? AND challenge=? AND result IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM rounds r WHERE r.id=leases.round_id AND r.finished_at IS NULL) AND EXISTS(SELECT 1 FROM students WHERE id=? AND active=1)`,next,correct?'correct':null,lid,sid,l.challenge,now(),sid);
  l=await owned(d,lid,sid);
  const saved=l.challenge?JSON.parse(l.challenge):null;
  if(!l.result&&saved?.answered)return feedback(saved);
 }
 check(['correct','taken'].includes(l.result),'הסבב או הלימוד השתנו. בחרו משנה מחדש.',409);
 if(l.result==='taken')return {result:'taken'};
 const tractate=l.mishnah_id.split(':')[0],t=structure.find(t=>t.id===tractate),total=t.chapters.reduce((a,b)=>a+b,0);
 const {n}=await d.one('SELECT COUNT(*) n FROM completions c JOIN mishnayot m ON m.id=c.mishnah_id WHERE c.round_id=? AND c.revoked_at IS NULL AND m.tractate=?',l.round_id,tractate);
 const rnd=await d.one('SELECT * FROM rounds WHERE id=?',l.round_id);
 return {result:'correct',ticket_awarded:!!(await d.one('SELECT 1 FROM tickets WHERE completion_id IN(SELECT id FROM completions WHERE round_id=? AND mishnah_id=? AND student_id=? AND revoked_at IS NULL)',l.round_id,l.mishnah_id,sid)),tractate_completed:n===total?tractate:null,all_completed:!!rnd.finished_at,bonus_round:rnd.finished_at&&rnd.number===1?2:null};
}
const studentQuery=`SELECT s.id,s.name,c.name AS class_name,COALESCE(SUM(t.delta),0) AS tickets FROM students s JOIN classes c ON c.id=s.class_id LEFT JOIN tickets t ON t.student_id=s.id`;
const classQuery=`SELECT c.id,c.name,count(x.id) AS contribution FROM classes c LEFT JOIN completions x ON x.class_id=c.id AND x.revoked_at IS NULL GROUP BY c.id HAVING count(x.id)>0 OR EXISTS(SELECT 1 FROM students s WHERE s.class_id=c.id AND s.active=1) ORDER BY c.name`;
function csv(columns,rows){const cell=v=>{let s=String(v??'');if(typeof v==='string'&&/^[\s]*[=+@\-\t\r]/.test(v))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return '\uFEFF'+[columns,...rows.map(r=>columns.map(c=>r[c]))].map(row=>row.map(cell).join(',')).join('\r\n');}
async function admin(d,route,b,url){
 const record=(action,details)=>d.p('INSERT INTO audit(at,actor,action,details) VALUES(?,?,?,?)',now(),'admin',action,JSON.stringify(details));
 const backupSchema={classes:['id','name'],students:['id','name','class_id','active','is_staff'],rounds:['id','number','started_at','finished_at'],content:['mishnah_id','text','questions','source','status','revision'],completions:['id','round_id','mishnah_id','student_id','class_id','completed_at','revoked_at','content_revision'],tickets:['id','student_id','delta','completion_id','reason','created_at'],audit:['id','at','actor','action','details'],settings:['key','value']};
 if(route==='admin/backup'){const tables={},names=Object.keys(backupSchema),results=await d.db.batch(names.map(t=>d.p('SELECT * FROM '+t)));names.forEach((t,i)=>tables[t]=results[i].results);return new Response(JSON.stringify({format:'hemdat-backup-v1',created_at:now(),tables},null,2),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="hemdat-backup.json"'}});}
 if(route==='admin/restore'){
  check(b.confirm==='שחזור','נדרש אישור שחזור מפורש');const data=b.backup;check(data?.format==='hemdat-backup-v1'&&data.tables,'קובץ גיבוי לא תקין');
  if(Array.isArray(data.tables.students))for(const row of data.tables.students){if(row.is_staff===undefined)row.is_staff=0;check([0,1].includes(row.is_staff),'סוג משתתף לא תקין');}
  let count=0;for(const [t,columns] of Object.entries(backupSchema)){check(Array.isArray(data.tables[t]),'טבלה חסרה בגיבוי: '+t);for(const row of data.tables[t]){count++;check(row&&columns.every(c=>c in row)&&Object.keys(row).every(c=>columns.includes(c)),'מבנה רשומה לא תקין: '+t);check(Object.values(row).every(v=>v===null||typeof v==='string'||typeof v==='number'),'ערך לא תקין בגיבוי');}}
  check(count<=10000,'הגיבוי גדול מדי לשחזור דרך האתר');
  const report=validateContent(data.tables.content.map(r=>({id:r.mishnah_id,text:r.text,source:r.source,status:r.status,questions:JSON.parse(r.questions)})),true);check(!report.errors.length,'תוכן לא תקין בגיבוי: '+report.errors.join('; '));
  check(data.tables.rounds.length&&data.tables.rounds.filter(r=>r.finished_at===null).length<=1,'סבבים לא תקינים');
  check(data.tables.settings.some(r=>r.key==='seed_v1'),'סימון גרסת הגיבוי חסר');
  for(const key of ['cooldown_seconds','lease_seconds'])check(data.tables.settings.some(r=>r.key===key&&Number(r.value)>0),'הגדרות חסרות');
  const balances=new Map();for(const t of data.tables.tickets)balances.set(t.student_id,(balances.get(t.student_id)||0)+t.delta);check([...balances.values()].every(n=>n>=0),'יתרת כרטיסים שלילית בגיבוי');
  const stmts=['sessions','leases','cooldowns','tickets','completions','students','classes','rounds','audit','settings'].map(t=>d.p('DELETE FROM '+t));
  stmts.push(d.p("INSERT INTO settings VALUES('restore_mode','1')"));
  for(const [t,columns] of Object.entries(backupSchema))for(const r of data.tables[t]){if(t==='settings'&&r.key==='restore_mode')continue;if(t==='content')stmts.push(d.p('UPDATE content SET text=?,questions=?,source=?,status=?,revision=? WHERE mishnah_id=?',r.text,r.questions,r.source,r.status,r.revision,r.mishnah_id));else stmts.push(d.p(`INSERT INTO ${t}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,...columns.map(c=>r[c])));}
  stmts.push(d.p("DELETE FROM settings WHERE key='restore_mode'"),record('restore',{rows:count}));await d.db.batch(stmts);return {ok:true};
 }
 if(route==='admin/data'){const data={};for(const table of ['rounds','classes','students','settings','completions','tickets','content'])data[table]=await d.all('SELECT * FROM '+table);data.audit=await d.all('SELECT * FROM audit ORDER BY id DESC LIMIT 200');return data;}
 if(route==='admin/import'){
  check(['content','students','staff'].includes(b.kind),'סוג ייבוא לא תקין');const rows=b.kind==='staff'&&Array.isArray(b.rows)?b.rows.map(r=>({id:r?.id,name:r?.name,class_id:'staff',class_name:'צוות'})):b.rows,report=b.kind==='content'?validateContent(rows,b.full===true):validateStudents(rows);
  if(b.kind!=='content'&&!report.errors.length){const people=await d.all('SELECT id,is_staff FROM students');for(const r of rows){const existing=people.find(p=>p.id===r.id);if(existing&&existing.is_staff!==(b.kind==='staff'?1:0))report.errors.push('לא ניתן להחליף סוג משתתף בייבוא: '+r.id);if(b.kind==='students'&&r.class_id==='staff')report.errors.push('יש לייבא אנשי צוות באמצעות סוג הייבוא צוות');}const classes=await d.all('SELECT * FROM classes');for(const r of rows)if(classes.some(c=>c.name===r.class_name&&c.id!==r.class_id))report.errors.push('שם כיתה קיים עם מזהה אחר: '+r.class_name);}
  if(!report.errors.length&&b.apply===true){const stmts=[];
   if(b.kind==='content')for(const r of rows)stmts.push(d.p('UPDATE content SET text=?,questions=?,status=?,source=?,revision=revision+1 WHERE mishnah_id=?',r.text,JSON.stringify(r.questions),r.status,r.source||'',r.id));
   else {for(const [id,name] of new Map(rows.map(r=>[r.class_id,r.class_name])))stmts.push(d.p('INSERT INTO classes VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name',id,name));for(const r of rows)stmts.push(d.p('INSERT INTO students(id,name,class_id,is_staff) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,class_id=excluded.class_id',r.id,r.name,r.class_id,b.kind==='staff'?1:0));}
   stmts.push(record('import',{kind:b.kind,count:rows.length}));await d.db.batch(stmts);report.applied=true;
  }return report;
 }
 if(route==='admin/settings'){
  const stmts=[];for(const [key,min,max] of [['lease_seconds',60,3600]]){check(Number.isInteger(b[key])&&b[key]>=min&&b[key]<=max,'זמן מחוץ לטווח המותר');stmts.push(d.p('UPDATE settings SET value=? WHERE key=?',String(b[key]),key));}
  await d.db.batch([...stmts,record('settings',b)]);return {ok:true};
 }
 if(route==='admin/ticket'){
  check([-1,1].includes(b.delta),'יש לבחור הוספה או הסרה של כרטיס אחד');check(typeof b.reason==='string'&&b.reason.trim()&&b.reason.length<=300,'יש לציין סיבת תיקון');check(await d.one('SELECT 1 FROM students WHERE id=? AND is_staff=0',b.student_id),'כרטיסי הגרלה מיועדים לתלמידים בלבד');
  await d.db.batch([d.p('INSERT INTO tickets(student_id,delta,reason,created_at) VALUES(?,?,?,?)',b.student_id,b.delta,b.reason,now()),record('ticket',b)]);return {ok:true};
 }
 if(route==='admin/revoke'){
  const r=await d.db.batch([d.p('UPDATE completions SET revoked_at=? WHERE id=? AND revoked_at IS NULL',now(),b.id),record('revoke',b)]);check(r[0].meta.changes>0,'השלמה לא נמצאה או כבר בוטלה');return {ok:true};
 }
 if(route==='admin/student'){
  check([0,1].includes(b.active),'מצב לא תקין');await d.db.batch([d.p('UPDATE students SET active=? WHERE id=?',b.active,b.id),d.p('DELETE FROM sessions WHERE student_id=?',b.id),d.p("UPDATE leases SET result='released' WHERE student_id=? AND result IS NULL",b.id),record('student',b)]);return {ok:true};
 }
 if(route==='admin/round'){
  const r=await d.run('INSERT INTO rounds(number,started_at) SELECT COALESCE(MAX(number),0)+1,? FROM rounds HAVING NOT EXISTS(SELECT 1 FROM rounds WHERE finished_at IS NULL)',now());check(r.meta.changes>0,'ניתן לפתוח סבב נוסף רק אחרי סיום הסבב הפעיל');return {number:(await current(d)).number};
 }
 if(route==='admin/export'){
  const kind=url.searchParams.get('kind')||'tickets';let rows,columns;
  if(kind==='content'){rows=(await d.all('SELECT * FROM content')).map(r=>({id:r.mishnah_id,text:r.text,status:r.status,source:r.source,questions:JSON.parse(r.questions)}));return new Response(JSON.stringify(rows,null,2),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="content.json"'}});}
  if(['tickets','raffle'].includes(kind)){rows=await d.all(studentQuery+' WHERE s.is_staff=0 GROUP BY s.id ORDER BY c.name,s.name');if(kind==='raffle')rows=rows.flatMap(r=>Array.from({length:r.tickets},()=>r));columns=['id','name','class_name',...(kind==='tickets'?['tickets']:[])];}
  else if(kind==='students'){rows=await d.all('SELECT s.id,s.name,s.class_id,c.name AS class_name FROM students s JOIN classes c ON c.id=s.class_id WHERE s.is_staff=0');columns=['id','name','class_id','class_name'];}
  else if(kind==='staff'){rows=await d.all('SELECT id,name FROM students WHERE is_staff=1 ORDER BY name');columns=['id','name'];}
  else if(kind==='classes'){rows=await d.all(classQuery);columns=['id','name','contribution'];}
  else if(kind==='completions'){rows=await d.all('SELECT * FROM completions');columns=['id','round_id','mishnah_id','student_id','class_id','completed_at','revoked_at','content_revision'];}
  else check(false,'סוג ייצוא לא תקין');
  return new Response(csv(columns,rows),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${kind}.csv"`}});
 }
 check(false,'הפעולה לא נמצאה',404);
}
async function handle(req,env){
 const url=new URL(req.url),path=url.pathname;
 if(path==='/health')return json({status:'ok'});
 if(!path.startsWith('/api/'))return env.ASSETS.fetch(new Request(new URL(path==='/'?'/index.html':path,req.url),req));
 const d=dbClient(env);await seed(d);
 const route=path.slice(5),method=req.method;
 check(['GET','POST'].includes(method),'פעולה לא מותרת',405);
 if(method==='POST'){const origin=req.headers.get('origin');check(!origin||origin===url.origin,'מקור בקשה לא תקין',403);}
 let b={};if(method==='POST'){const raw=await req.text();check(raw.length<=4*1024*1024,'הקובץ גדול מדי',413);try{b=JSON.parse(raw||'{}');}catch{check(false,'JSON לא תקין');}check(b&&typeof b==='object'&&!Array.isArray(b),'מבנה בקשה לא תקין');}
 if(route==='login'){check(method==='POST','פעולה לא מותרת',405);return login(d,req,env,b);}
 const s=await auth(d,req);
 const getRoutes=['me','roster','state','board','admin/data','admin/export','admin/backup'];check(method===(getRoutes.includes(route)?'GET':'POST'),'פעולה לא מותרת',405);
 if(route==='me')return json({role:s.role,student_id:s.student_id,csrf:s.csrf,is_staff:s.student_id?!!(await d.one('SELECT is_staff FROM students WHERE id=?',s.student_id))?.is_staff:false});
 if(route==='logout'){await d.run('DELETE FROM sessions WHERE token_hash=?',s.token_hash);return json({ok:true},200,{'Set-Cookie':'session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});}
 if(route==='roster')return json({classes:await d.all('SELECT * FROM classes c WHERE EXISTS(SELECT 1 FROM students s WHERE s.class_id=c.id AND s.active=1) ORDER BY name'),students:await d.all('SELECT id,name,class_id,is_staff FROM students WHERE active=1 ORDER BY name')});
 if(route==='select'){check(['school','student'].includes(s.role),'כניסה זו מיועדת לתלמידים',403);check(await d.one('SELECT 1 FROM students WHERE id=? AND active=1',b.student_id),'התלמיד לא נמצא');return makeSession(d,req,'student',b.student_id);}
 if(route==='state'){const round=await current(d)||await d.one('SELECT * FROM rounds ORDER BY number DESC LIMIT 1');return json({structure,total:149,round,completed:(await d.all('SELECT mishnah_id FROM completions WHERE round_id=? AND revoked_at IS NULL',round.id)).map(r=>r.mishnah_id),statuses:Object.fromEntries((await d.all('SELECT mishnah_id,status FROM content')).map(r=>[r.mishnah_id,r.status])),my_tickets:(await d.one('SELECT COALESCE(SUM(delta),0) n FROM tickets WHERE student_id=?',s.student_id)).n});}
 if(route==='board')return json({students:await d.all(studentQuery+' WHERE s.active=1 AND s.is_staff=0 GROUP BY s.id ORDER BY c.name,s.name'),classes:await d.all(classQuery),recent:await d.all('SELECT c.name AS class_name,m.tractate,x.completed_at FROM completions x JOIN classes c ON c.id=x.class_id JOIN mishnayot m ON m.id=x.mishnah_id WHERE x.revoked_at IS NULL ORDER BY x.id DESC LIMIT 10')});
 if(['learn','question','answer','release','reread'].includes(route)){
  check(s.role==='student','יש לבחור כיתה ושם לפני הלימוד',403);let result;
  if(route==='learn')result=await acquire(d,s.student_id,b.id);
  if(route==='reread')result=await reread(d,b.id,s.student_id);
  if(route==='question')result=await challenge(d,b.id,s.student_id);
  if(route==='answer')result=await answer(d,b.id,s.student_id,b.option);
  if(route==='release'){await owned(d,b.id,s.student_id);await d.run("UPDATE leases SET result='released' WHERE id=? AND result IS NULL",b.id);result={ok:true};}return json(result);
 }
 check(route.startsWith('admin/')&&s.role==='admin','אין הרשאה לפעולה',403);
 const result=await admin(d,route,b,url);return result instanceof Response?result:json(result);
}
export default {async fetch(req,env){let response;try{response=await handle(req,env);}catch(e){const balance=e.message?.includes('negative_ticket_balance');const conflict=e.message?.includes('UNIQUE constraint');if(!e.status&&!balance&&!conflict)console.error('Request failed',e.message);response=json({error:balance?'אין מספיק כרטיסים להפחתה. תקנו תחילה את יתרת התלמיד.':conflict?'הפעולה כבר בוצעה או שהנתון השתנה. רעננו ונסו שוב.':e.status?e.message:'לא הצלחנו לשמור כעת. נסו שוב בעוד רגע.'},e.status||(balance?400:conflict?409:503));}
 const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');headers.set('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'self' https://chatgpt.com; base-uri 'none'; form-action 'self'");if(new URL(req.url).pathname.startsWith('/api/'))headers.set('Cache-Control','no-store');return new Response(response.body,{status:response.status,headers});}};
