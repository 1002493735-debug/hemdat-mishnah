import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {validateContent} from '../worker/validation.js';
let mf,db;
before(async()=>{mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2025-09-06',d1Databases:['DB'],bindings:{ADMIN_PASSWORD:'test-only-password',SCHOOL_CODE:'test-only-code',STAFF_CODE:'test-only-staff-code'},serviceBindings:{ASSETS:()=>new Response('asset')}});db=await mf.getD1Database('DB');for(const file of (await fs.readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()){for(const stmt of (await fs.readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(stmt).run();}});
after(async()=>{await mf?.dispose();});
function client(){return {cookie:'',csrf:'',async api(path,body){const response=await mf.dispatchFetch('https://game.test/api/'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:this.cookie,'X-CSRF-Token':this.csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}if(data.csrf)this.csrf=data.csrf;return {status:response.status,data};}};}
async function login(sid){const c=client();assert.equal((await c.api('login',sid.startsWith('staff-')?{role:'staff_gate',password:'test-only-staff-code'}:{password:'test-only-code'})).status,200);assert.equal((await c.api('select',{student_id:sid})).status,200);return c;}
async function correct(c,mid){const l=await c.api('learn',mid?{id:mid}:{});assert.equal(l.status,200);const q=await c.api('question',{id:l.data.id});assert.equal(q.status,200);const stored=await db.prepare('SELECT challenge FROM leases WHERE id=?').bind(l.data.id).first();const option=JSON.parse(stored.challenge).correct_id;return {l:l.data,q:q.data,option};}
test('149 ready records; 298 questions; stable canonical identifiers',async()=>{const c=await login('demo-1');const s=(await c.api('state')).data;assert.equal(s.total,149);assert.deepEqual(s.structure.map(t=>t.id),['sukkah','yoma','rosh-hashanah']);assert.equal(Object.values(s.statuses).filter(v=>v==='ready').length,149);assert.deepEqual(validateContent(JSON.parse(await fs.readFile('data/content.json','utf8')),true).errors,[]);});
test('authentication, CSRF and answer secrecy',async()=>{const anon=client();assert.equal((await anon.api('roster')).status,401);const c=await login('demo-1');assert.equal((await c.api('admin/data')).status,403);const csrf=c.csrf;c.csrf='bad';assert.equal((await c.api('learn',{})).status,403);c.csrf=csrf;const x=await correct(c,'sukkah:1:1');assert.equal(x.q.options.length,4);assert.ok(!('correct_id' in x.q));assert.ok(!('questions' in x.l));await c.api('release',{id:x.l.id});});
test('simultaneous devices receive one lock; retry awards exactly one ticket',async()=>{const a=await login('demo-1'),b=await login('demo-2');const results=await Promise.all([a.api('learn',{id:'sukkah:1:2'}),b.api('learn',{id:'sukkah:1:2'})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const winner=results[0].status===200?a:b;const l=results.find(r=>r.status===200).data;await winner.api('question',{id:l.id});const option=JSON.parse((await db.prepare('SELECT challenge FROM leases WHERE id=?').bind(l.id).first()).challenge).correct_id;const answers=await Promise.all(Array.from({length:8},()=>winner.api('answer',{id:l.id,option})));assert.ok(answers.every(r=>r.status===200&&r.data.result==='correct'));assert.equal((await db.prepare("SELECT count(*) n FROM completions WHERE mishnah_id='sukkah:1:2'").first()).n,1);assert.equal((await db.prepare("SELECT count(*) n FROM tickets WHERE completion_id IS NOT NULL").first()).n,1);});
test('wrong feedback, reread and alternate question survive login with no cooldown',async()=>{
 const a=await login('demo-3'),x=await correct(a,'yoma:1:1');
 const first=JSON.parse((await db.prepare('SELECT challenge FROM leases WHERE id=?').bind(x.l.id).first()).challenge);
 const wrong=x.q.options.find(o=>o.id!==x.option),r=await a.api('answer',{id:x.l.id,option:wrong.id});
 assert.equal(r.data.result,'wrong');assert.equal(r.data.selected.text,wrong.text);assert.equal(r.data.correct.id,x.option);assert.ok(!('until' in r.data));
 assert.equal((await db.prepare('SELECT count(*) n FROM cooldowns').first()).n,0);
 assert.equal((await a.api('answer',{id:x.l.id,option:x.option})).data.result,'wrong');
 assert.equal((await a.api('question',{id:x.l.id})).status,409);
 const again=await login('demo-3');assert.equal((await again.api('learn',{id:'yoma:1:1'})).data.id,x.l.id);
 const other=await login('demo-4');assert.equal((await other.api('learn',{id:'yoma:1:1'})).status,409);
 assert.equal((await again.api('reread',{id:x.l.id})).data.text,x.l.text);
 const q2=await again.api('question',{id:x.l.id});assert.equal(q2.status,200);assert.notEqual(q2.data.prompt,x.q.prompt);
 const second=JSON.parse((await db.prepare('SELECT challenge FROM leases WHERE id=?').bind(x.l.id).first()).challenge);
 assert.equal(second.index,1-first.index);assert.ok(!('correct_id' in q2.data));
 assert.equal((await again.api('answer',{id:x.l.id,option:x.option})).status,400);
 await again.api('reread',{id:x.l.id});assert.deepEqual((await again.api('question',{id:x.l.id})).data,q2.data);
 assert.equal((await again.api('answer',{id:x.l.id,option:second.correct_id})).data.result,'correct');
 assert.equal((await db.prepare("SELECT count(*) n FROM completions WHERE mishnah_id='yoma:1:1'").first()).n,1);
});
test('repeated wrong attempts alternate, legacy cooldowns ignored, parallel answers first wins',async()=>{
 const c=await login('demo-3');await db.prepare("INSERT INTO cooldowns VALUES('demo-3','sukkah:3:1',?)").bind(Math.floor(Date.now()/1000)+3600).run();
 const x=await correct(c,'sukkah:3:1');let q=x.q;
 for(let i=0;i<3;i++){
  const before=JSON.parse((await db.prepare('SELECT challenge FROM leases WHERE id=?').bind(x.l.id).first()).challenge);
  const wrong=q.options.find(o=>o.id!==before.correct_id).id;
  const rs=await Promise.all(Array.from({length:5},()=>c.api('answer',{id:x.l.id,option:wrong})));
  assert.ok(rs.every(r=>r.data.result==='wrong'));assert.ok(rs.every(r=>r.data.correct.id===before.correct_id));
  const retry=await c.api('answer',{id:x.l.id,option:before.correct_id});assert.equal(retry.data.result,'wrong');
  await c.api('reread',{id:x.l.id});q=(await c.api('question',{id:x.l.id})).data;
  assert.notEqual(q.prompt,before.prompt);
 }
 const end=JSON.parse((await db.prepare('SELECT challenge FROM leases WHERE id=?').bind(x.l.id).first()).challenge);
 const rs=await Promise.all([c.api('answer',{id:x.l.id,option:end.correct_id}),c.api('answer',{id:x.l.id,option:q.options.find(o=>o.id!==end.correct_id).id})]);
 assert.equal(rs[0].data.result,rs[1].data.result);
 const count=(await db.prepare("SELECT count(*) n FROM completions WHERE mishnah_id='sukkah:3:1'").first()).n;
 assert.equal(count,rs[0].data.result==='correct'?1:0);await c.api('release',{id:x.l.id});
});
test('expired lock can be taken; late answer gets friendly taken response',async()=>{const a=await login('demo-1'),x=await correct(a,'yoma:1:2');await db.prepare('UPDATE leases SET expires_at=1 WHERE id=?').bind(x.l.id).run();const b=await login('demo-2'),y=await correct(b,'yoma:1:2');assert.equal((await b.api('answer',{id:y.l.id,option:y.option})).data.result,'correct');assert.equal((await a.api('answer',{id:x.l.id,option:x.option})).data.result,'taken');});
test('imports validate errors and preserve game history; admin revocation atomic',async()=>{const a=client();await a.api('login',{role:'admin',password:'test-only-password'});const rows=JSON.parse(await fs.readFile('data/content.json','utf8'));const before=(await a.api('admin/data')).data;assert.ok(validateContent([rows[0],rows[0]]).errors.length);assert.ok(validateContent([{...rows[0],id:'bad'}]).errors.length);const bad=structuredClone(rows[0]);bad.questions[0].options.pop();assert.ok(validateContent([bad]).errors.length);bad.questions[0].options.push('not correct');bad.questions[0].correct='absent';assert.ok(validateContent([bad]).errors.length);const report=await a.api('admin/import',{kind:'content',rows,full:true,apply:true});assert.equal(report.data.applied,true);const after=(await a.api('admin/data')).data;assert.deepEqual(after.completions,before.completions);assert.deepEqual(after.tickets,before.tickets);const id=before.completions[0].id;const rs=await Promise.all([a.api('admin/revoke',{id}),a.api('admin/revoke',{id})]);assert.deepEqual(rs.map(r=>r.status).sort(),[200,400]);assert.equal((await db.prepare('SELECT COUNT(*) n FROM tickets WHERE reason=?').bind('ביטול השלמה '+id).first()).n,1);assert.equal((await a.api('admin/export?kind=raffle')).status,200);});
test('question positions vary across attempts',async()=>{const c=await login('demo-3'),positions=new Set();for(let i=0;i<16;i++){const x=await correct(c,'sukkah:2:1');positions.add(x.q.options.findIndex(o=>o.id===x.option));await c.api('release',{id:x.l.id});}assert.ok(positions.size>1);});
test('staff share completion and locks but never receive raffle tickets',async()=>{
 const admin=client();await admin.api('login',{role:'admin',password:'test-only-password'});
 const imported=await admin.api('admin/import',{kind:'staff',rows:[{id:'staff-test',name:'אשת צוות לדוגמה',phone:'must-not-persist'}],apply:true});assert.equal(imported.data.applied,true);
 const c=await login('staff-test');assert.equal((await c.api('me')).data.is_staff,true);
 const roster=(await c.api('roster')).data;assert.ok(roster.classes.some(x=>x.name==='צוות'));assert.ok(!('phone' in roster.students.find(x=>x.id==='staff-test')));
 const x=await correct(c,'sukkah:4:1'),student=await login('demo-4');assert.equal((await student.api('learn',{id:x.l.mishnah_id})).status,409);
 const rs=await Promise.all(Array.from({length:4},()=>c.api('answer',{id:x.l.id,option:x.option})));
 assert.ok(rs.every(r=>r.data.result==='correct'&&r.data.ticket_awarded===false));
 assert.ok((await student.api('state')).data.completed.includes(x.l.mishnah_id));
 assert.equal((await db.prepare("SELECT count(*) n FROM tickets WHERE student_id='staff-test'").first()).n,0);
 const board=(await c.api('board')).data;assert.ok(!board.students.some(x=>x.id==='staff-test'));assert.equal(board.classes.find(x=>x.id==='staff').contribution,1);
 assert.equal((await admin.api('admin/ticket',{student_id:'staff-test',delta:1,reason:'not allowed'})).status,400);
 await assert.rejects(db.prepare("INSERT INTO tickets(student_id,delta,reason,created_at) VALUES('staff-test',1,'test',1)").run());
 for(const kind of ['tickets','raffle'])assert.ok(!(await admin.api('admin/export?kind='+kind)).data.includes('staff-test'));
 const conversion=await admin.api('admin/import',{kind:'students',rows:[{id:'staff-test',name:'test',class_id:'demo-a',class_name:'כיתת הדגמה א'}],apply:true});assert.ok(conversion.data.errors.length);
 const completion=await db.prepare("SELECT id FROM completions WHERE student_id='staff-test'").first();assert.equal((await admin.api('admin/revoke',{id:completion.id})).status,200);
 assert.equal((await db.prepare("SELECT count(*) n FROM tickets WHERE student_id='staff-test'").first()).n,0);
 // Reimport of staff retains flags and existing records; backup keeps staff type.
 assert.equal((await admin.api('admin/import',{kind:'staff',rows:[{id:'staff-test',name:'שם צוות מתוקן'}],apply:true})).data.applied,true);
 assert.equal((await admin.api('admin/backup')).data.tables.students.find(x=>x.id==='staff-test').is_staff,1);
});
test('staff code protects roster and selection, including old sessions',async()=>{
 const school=client();await school.api('login',{password:'test-only-code'});
 assert.ok(!(await school.api('roster')).data.students.some(p=>p.is_staff));
 assert.equal((await school.api('select',{student_id:'staff-test'})).status,403);
 const staff=client();assert.equal((await staff.api('login',{role:'staff_gate',password:'test-only-code'})).status,401);
 assert.equal((await staff.api('login',{role:'staff_gate',password:'test-only-staff-code'})).status,200);
 assert.ok((await staff.api('roster')).data.students.every(p=>p.is_staff));
 assert.equal((await staff.api('select',{student_id:'demo-1'})).status,403);
 assert.equal((await staff.api('select',{student_id:'staff-test'})).data.role,'staff');
 assert.equal((await staff.api('admin/data')).status,403);
 const student=await login('demo-1');assert.equal((await student.api('select',{student_id:'staff-test',role:'staff',is_staff:1})).status,403);
 await db.prepare("UPDATE sessions SET role='student' WHERE student_id='staff-test'").run();
 assert.equal((await staff.api('me')).status,401);
});
test('consistent full backup restores history exactly and invalidates sessions',async()=>{const a=client();await a.api('login',{role:'admin',password:'test-only-password'});const backup=(await a.api('admin/backup')).data;const old=backup.tables.tickets;await a.api('admin/ticket',{student_id:'demo-4',delta:1,reason:'temporary test'});assert.equal((await a.api('admin/restore',{backup,confirm:'שחזור'})).status,200);assert.equal((await a.api('admin/data')).status,401);await a.api('login',{role:'admin',password:'test-only-password'});assert.deepEqual((await a.api('admin/data')).data.tickets,old);});
test('final staff completion opens bonus without losing history; later rounds supported',async()=>{const c=await login('staff-test'),x=await correct(c,'yoma:8:9');const rows=await db.prepare('SELECT id FROM mishnayot WHERE id<>? AND id NOT IN(SELECT mishnah_id FROM completions WHERE round_id=1 AND revoked_at IS NULL)').bind(x.l.mishnah_id).all();for(const r of rows.results)await db.prepare("INSERT INTO completions(round_id,mishnah_id,student_id,class_id,completed_at,content_revision) VALUES(1,?,'demo-4','demo-b',unixepoch(),1)").bind(r.id).run();const result=await c.api('answer',{id:x.l.id,option:x.option});assert.equal(result.data.bonus_round,2);assert.equal(result.data.ticket_awarded,false);assert.equal((await db.prepare('SELECT COUNT(*) n FROM completions WHERE round_id=1 AND revoked_at IS NULL').first()).n,149);const state=(await c.api('state')).data;assert.equal(state.round.number,2);assert.equal(state.completed.length,0);const admin=client();await admin.api('login',{role:'admin',password:'test-only-password'});assert.equal((await admin.api('admin/round',{})).status,400);await db.prepare('UPDATE rounds SET finished_at=unixepoch() WHERE number=2').run();assert.equal((await admin.api('admin/round',{})).data.number,3);});
