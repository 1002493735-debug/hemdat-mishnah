'use strict';
const $ = s => document.querySelector(s);
const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const E = escapeHTML;
let me=null, state=null, roster=null, lease=null, view='home', adminData=null;
const names={'rosh-hashanah':'ראש השנה',yoma:'יומא',sukkah:'סוכה'};
const letters=['','א','ב','ג','ד','ה','ו','ז','ח','ט','י','יא','יב','יג','יד','טו'];
const title=id=>{const [t,c,m]=id.split(':');return 'מסכת '+names[t]+' · פרק '+letters[+c]+' · משנה '+letters[+m];};
function notify(text=''){$('#notice').textContent=text;}
async function api(path, body) {
  const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':me?.csrf||''},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok){if(response.status===401 && path!=='login'){me=null;login();}throw new Error(data.error||'לא הצלחנו לבצע את הפעולה. נסו שוב.');}
  return data;
}
function main(html){$('#main').innerHTML=html;}
function nav(){
  $('#nav').hidden=!me||me.role==='school';
  $('#logout').hidden=!me;
  const items=[['home','הבית שלנו'],['map','מפת המסכתות'],['board','העשייה שלנו']];
  if(me?.role==='admin')items.push(['admin','ניהול']);
  $('#nav').innerHTML=items.map(([v,n])=>'<button data-view="'+v+'" '+(view===v?'aria-current="page"':'')+'>'+n+'</button>').join('');
}
function login(admin=false){
  view='login';nav();
  main('<section class="panel narrow intro welcome"><span class="school-logo welcome-logo"><img src="/static/assets/school-logo.jpg" alt="סמל בית הספר חמדת השקד" width="1086" height="1536"></span><p class="eyebrow">ממ״ד חמדת השקד – מבשרת ציון</p><h1>לומדים יחד<br>משלימים יחד</h1><p>כל משנה מוסיפה אור. כל אחד ואחת שותפים.</p><form id="login-form"><label for="password">'+(admin?'סיסמת מנהל':'קוד הכניסה של בית הספר')+'</label><input id="password" type="password" autocomplete="current-password" required><input id="role" type="hidden" value="'+(admin?'admin':'school')+'"><button class="cta">כניסה '+(admin?'לניהול':'למרחב הלימוד')+'</button></form><p><button class="quiet" data-action="'+(admin?'student-login':'admin-login')+'">'+(admin?'כניסת תלמידים':'כניסת מנהל')+'</button></p><p class="dedication">לעילוי נשמת הקדושים שנרצחו על קידוש ה׳ בשמחת תורה תשפ״ד, במלחמת חרבות ברזל.</p></section>');
}
async function chooseStudent(){
  roster=await api('roster');view='select';nav();
  main('<section class="panel narrow"><p class="eyebrow">נעים ללמוד יחד</p><h1>מי מצטרפים ללימוד?</h1><form id="select-form"><label for="class">הכיתה שלי</label><select id="class" required><option value="">בחרו כיתה</option>'+roster.classes.map(c=>'<option value="'+E(c.id)+'">'+E(c.name)+'</option>').join('')+'</select><label for="student">השם שלי</label><select id="student" required disabled><option value="">בחרו קודם כיתה</option></select><button class="cta">בואו נלמד יחד</button></form></section>');
}
function stats(t){
 const all=t.chapters.reduce((a,b)=>a+b,0),done=state.completed.filter(id=>id.startsWith(t.id+':')).length;
 return {all,done,pct:Math.round(done/all*100)};
}
function progress(done,all){return '<progress max="'+all+'" value="'+done+'" aria-label="'+done+' מתוך '+all+' משניות"></progress>';}
function art(t){return '<img class="art" src="/static/assets/'+t+'.webp" alt="'+({yoma:'בית המקדש באור של בוקר',sukkah:'סוכה וארבעת המינים','rosh-hashanah':'שופר ואווירת ראש השנה'}[t])+'" width="600" height="400">';}
function home(){
 const done=state.completed.length;
 main('<section class="panel intro"><p class="eyebrow">'+(state.round.number===1?'המסע המשותף שלנו':state.round.number===2?'🌟 סיבוב הבונוס':'סבב '+state.round.number)+'</p><h1>לומדים יחד – משלימים יחד</h1><p class="dedication">הלימוד מוקדש לעילוי נשמת הקדושים שנרצחו על קידוש ה׳ בשמחת תורה תשפ״ד, במלחמת חרבות ברזל.</p><div class="row spread"><div><span class="big">'+done+'</span> מתוך '+state.total+' משניות</div><strong>'+Math.round(done/state.total*100)+'% מהמשימה הושלמה</strong></div>'+progress(done,state.total)+'<div class="row spread"><span>נותרו '+(state.total-done)+' משניות</span><span>🎟️ הכרטיסים שלי: '+state.my_tickets+'</span></div>'+(state.round.finished_at?'<p class="stat">יחד השלמנו שלוש מסכתות!</p>':'<button class="cta" data-action="learn">📖 תנו לי משנה ללמוד</button>')+'</section><div class="grid">'+state.structure.map(t=>{const p=stats(t);return '<section class="panel">'+art(t.id)+'<h2>מסכת '+E(t.name)+'</h2><p class="stat">'+(p.done===p.all?'✓ המסכת הושלמה!':p.pct+'%')+'</p>'+progress(p.done,p.all)+'<p class="muted">'+p.done+' מתוך '+p.all+' משניות</p><button class="quiet" data-view="map">למפת המסכתות</button></section>';}).join('')+'</div>');
}
function map(){
 main('<h1>מפת המסכתות</h1><p class="muted">כל משנה היא חלק מהלימוד המשותף שלנו.</p>'+state.structure.map(t=>{
 const p=stats(t);
 return '<section class="panel">'+art(t.id)+'<h2>מסכת '+E(t.name)+'</h2><p>'+p.done+' נלמדו · '+(p.all-p.done)+' נותרו · '+p.all+' בסך הכול · '+p.pct+'%</p>'+progress(p.done,p.all)+(p.done===p.all?'<p class="stat">✓ המסכת הושלמה!</p>':'')+t.chapters.map((count,c)=>'<details open><summary>פרק '+letters[c+1]+' · '+count+' משניות</summary><div class="tiles">'+Array.from({length:count},(_,m)=>{
 const id=t.id+':'+(c+1)+':'+(m+1),done=state.completed.includes(id),ready=state.statuses[id]==='ready';
 if(done)return '<span class="tile done" aria-label="'+E(title(id))+' הושלמה">✓</span>';
 return '<button class="tile '+(ready?'':'soon')+'" '+(ready?'data-learn="'+id+'"':'disabled')+' aria-label="'+E(title(id))+(ready?' ללימוד':' בקרוב')+'">'+letters[m+1]+(ready?'':'<small>בקרוב</small>')+'</button>';
 }).join('')+'</div></details>').join('')+'</section>';
 }).join(''));
}
async function navigate(v){
 notify();view=v;nav();
 if(v==='home'||v==='map'){state=await api('state');v==='home'?home():map();}
 if(v==='board')await board();
 if(v==='admin')await admin();
}
async function learn(mid){
 if(me.role!=='student'){await chooseStudent();return;}
 lease=await api('learn',mid?{id:mid}:{});
 lease=await api('reread',{id:lease.id});
 showStudy();
}
function showStudy(){
 view='study';nav();notify();
 main('<section class="panel study">'+art(lease.mishnah_id.split(':')[0])+'<p class="eyebrow">עוד משנה. עוד אור.</p><h1>'+E(title(lease.mishnah_id))+'</h1><div class="mishnah">'+E(lease.text)+'</div><button class="cta" data-action="question">למדתי – אפשר לשאול אותי!</button><p><button class="quiet" data-action="release">חזרה ושחרור המשנה</button></p></section>');
}
async function reread(){lease=await api('reread',{id:lease.id});showStudy();}
async function question(){
 const q=await api('question',{id:lease.id});view='question';
 main('<section class="panel study">'+art(lease.mishnah_id.split(':')[0])+'<p class="eyebrow">'+E(title(lease.mishnah_id))+'</p><h1>'+E(q.prompt)+'</h1>'+(q.hint?'<details class="hint"><summary>רמז קטן שיעזור לי</summary><p>'+E(q.hint)+'</p></details>':'')+'<div class="options">'+q.options.map(o=>'<button data-answer="'+o.id+'">'+E(o.text)+'</button>').join('')+'</div><p><button class="quiet" data-action="reread">📖 חזרה לקריאת המשנה</button></p></section>');
}
async function submitAnswer(option){
 const illustration=art(lease.mishnah_id.split(':')[0]);
 document.querySelectorAll('[data-answer]').forEach(b=>b.disabled=true);
 let r;try{r=await api('answer',{id:lease.id,option});}catch(e){document.querySelectorAll('[data-answer]').forEach(b=>b.disabled=false);throw e;}
 view='result';
 let html;
 if(r.result==='correct'){
 html='<div class="seal">✓</div><h1>כל הכבוד! 🎉</h1><p>בזכותך הושלמה משנה נוספת!</p><p class="stat">✓ המשנה נלמדה</p><div class="ticket">זכית בכרטיס הגרלה! 🎟️</div>';
 if(r.tractate_completed)html+='<h2>כל הכבוד לחמדת השקד!<br>✓ מסכת '+names[r.tractate_completed]+' הושלמה!</h2>';
 if(r.all_completed)html+='<h2>יחד השלמנו שלוש מסכתות!</h2><p>ממ״ד חמדת השקד השלים את מסכתות ראש השנה, יומא וסוכה לעילוי נשמת הקדושים.</p>';
 if(r.bonus_round)html+='<h2>🌟 סיבוב הבונוס נפתח! 🌟</h2>';
 }else if(r.result==='wrong'){
 main('<section class="panel study">'+illustration+'<h1>ממשיכים ללמוד יחד</h1><p>נחזור לקרוא את המשנה, ואז ננסה את השאלה השנייה.</p><div class="answer-feedback" role="status"><div class="answer-wrong"><strong>✗ התשובה שבחרת</strong><p>'+E(r.selected.text)+'</p></div><div class="answer-correct"><strong>✓ התשובה הנכונה</strong><p><strong>'+E(r.correct.text)+'</strong></p></div></div><button class="cta" data-action="reread">📖 חזרה למשנה ולניסיון נוסף</button></section>');
 return;
 }else html='<h1>הלימוד של כולנו מצטרף יחד</h1><p>מישהו בדיוק הקדים אותך והשלים את המשנה! כל הכבוד על הלימוד – בואו נמצא לך משנה נוספת.</p>';
 lease=null;
 main('<section class="panel narrow success">'+illustration+html+'<button class="cta" data-action="learn">📖 למשנה נוספת</button><p><button class="quiet" data-view="home">לבית שלנו</button></p></section>');
}
function table(headers,rows){
 return '<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+E(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
async function board(){
 const b=await api('board');state=await api('state');
 main('<h1>כולנו שותפים</h1><p>כל כרטיס מספר על משנה שנלמדה. כל כיתה מוסיפה אור.</p><section class="panel"><h2>התרומה של הכיתות</h2><p class="muted">בכל הסבבים יחד</p>'+b.classes.map(c=>'<h3>'+E(c.name)+' – תרמה '+c.contribution+' משניות</h3>'+progress(c.contribution,Math.max(1,...b.classes.map(x=>x.contribution)))).join('')+'</section><section class="panel"><h2>כרטיסי הגרלה</h2><p class="muted">לפי סדר הכיתות והשמות</p>'+table(['שם','כיתה','כרטיסים'],b.students.map(s=>[E(s.name),E(s.class_name),s.tickets]))+'</section><section class="panel"><h2>פעילות אחרונה</h2>'+b.recent.map(r=>'<p>תלמיד/ה מ'+E(r.class_name)+' השלימו משנה במסכת '+names[r.tractate]+'</p>').join('')+(b.recent.length?'':'<p>המסע מתחיל במשנה הראשונה.</p>')+'</section>');
}
async function admin(){
 adminData=await api('admin/data');
 const d=adminData,settings=Object.fromEntries(d.settings.map(s=>[s.key,s.value]));
 main('<h1>ניהול המיזם</h1><div class="row"><button data-view="home">התקדמות כללית</button><button data-view="map">מפת המשניות</button><button data-view="board">כרטיסים ותרומת כיתות</button></div><section class="panel"><h2>תלמידים וכרטיסים</h2><div class="filters"><input id="search" aria-label="חיפוש תלמיד" placeholder="חיפוש תלמיד"><select id="class-filter" aria-label="סינון כיתה"><option value="">כל הכיתות</option>'+d.classes.map(c=>'<option value="'+E(c.id)+'">'+E(c.name)+'</option>').join('')+'</select></div><div id="student-table"></div><h3>תיקון כרטיס</h3><form id="ticket-form"><label for="ticket-student">תלמיד/ה</label><select id="ticket-student">'+d.students.map(s=>'<option value="'+E(s.id)+'">'+E(s.name)+'</option>').join('')+'</select><label for="delta">פעולה</label><select id="delta"><option value="1">הוספת כרטיס אחד</option><option value="-1">הסרת כרטיס אחד</option></select><label for="reason">סיבת התיקון</label><input id="reason" required maxlength="300"><button class="cta">שמירת תיקון</button></form></section><section class="panel"><h2>זמן נעילת משנה</h2><p>אחרי טעות חוזרים לקריאה ולשאלה השנייה, ללא השהיה.</p><form id="settings-form"><label for="lease-seconds">נעילת לימוד, בשניות</label><input id="lease-seconds" type="number" min="60" max="3600" value="'+settings.lease_seconds+'" required><button class="cta">שמירת זמנים</button></form></section><section class="panel"><h2>ייבוא ועדכון תוכן ותלמידים</h2><p>תחילה בודקים את הקובץ. לאחר בדיקה מוצלחת ניתן לשמור. ייבוא תוכן אינו משנה השלמות או כרטיסים.</p><label for="import-kind">סוג קובץ</label><select id="import-kind"><option value="content">תוכן משניות ושאלות – Excel או JSON</option><option value="students">תלמידים וכיתות – Excel, CSV או JSON</option></select><label for="import-file">בחירת קובץ</label><input id="import-file" type="file" accept=".json,.csv,.xlsx"><label><input id="full" type="checkbox"> בדיקת מאגר תוכן מלא (149 משניות)</label><label for="import-text">תוכן הקובץ / עריכה ידנית</label><textarea id="import-text" dir="ltr" spellcheck="false"></textarea><div class="row"><button data-action="validate">בדיקת קובץ</button><button id="apply-import" data-action="import" disabled>שמירת הייבוא</button><a class="button quiet" href="/api/admin/export?kind=content">הורדת תבנית התוכן המלאה</a></div><pre id="import-report" role="status"></pre></section><section class="panel"><h2>משניות שהושלמו</h2>'+table(['משנה','תלמיד/ה','כיתה','סבב','מועד','מצב'],d.completions.map(x=>[E(title(x.mishnah_id)),E(d.students.find(s=>s.id===x.student_id)?.name||x.student_id),E(d.classes.find(c=>c.id===x.class_id)?.name||x.class_id),x.round_id,E(new Date(x.completed_at*1000).toLocaleString('he-IL')),x.revoked_at?'בוטלה':'<button class="danger" data-revoke="'+x.id+'">ביטול השלמה וכרטיס</button>']))+'</section><section class="panel"><h2>סבבים</h2>'+table(['סבב','התחלה','סיום'],d.rounds.map(r=>[r.number,E(new Date(r.started_at*1000).toLocaleString('he-IL')),r.finished_at?E(new Date(r.finished_at*1000).toLocaleString('he-IL')):'פעיל']))+'<p>הסבב השני נפתח אוטומטית. סבבים נוספים נפתחים כאן לאחר סיום הסבב הפעיל.</p><button data-action="new-round">פתיחת סבב נוסף</button></section><section class="panel"><h2>ייצוא</h2><div class="row">'+[['tickets','כרטיסים'],['raffle','רשימה מוכנה להגרלה'],['completions','השלמות והיסטוריה'],['classes','תרומת כיתות'],['students','תלמידים וכיתות']].map(([k,n])=>'<a class="button" href="/api/admin/export?kind='+k+'">'+n+' – CSV</a>').join('')+'</div></section><section class="panel"><details><summary>יומן שינויים אחרונים</summary>'+table(['זמן','פעולה','פרטים'],d.audit.map(a=>[E(new Date(a.at*1000).toLocaleString('he-IL')),E(a.action),E(a.details)]))+'</details></section>');
 mainAppendBackup();
 studentTable();
}
function studentTable(){
 const term=$('#search').value.toLocaleLowerCase(),cls=$('#class-filter').value,d=adminData;
 $('#student-table').innerHTML=table(['שם','כיתה','כרטיסים','מצב'],d.students.filter(s=>(!cls||s.class_id===cls)&&s.name.toLocaleLowerCase().includes(term)).map(s=>[E(s.name),E(d.classes.find(c=>c.id===s.class_id)?.name),d.tickets.filter(t=>t.student_id===s.id).reduce((a,t)=>a+t.delta,0),'<button class="quiet" data-student="'+E(s.id)+'" data-active="'+(s.active?0:1)+'">'+(s.active?'השבתת חשבון':'הפעלת חשבון')+'</button>']));
}
function parseCSV(text){
 const rows=[];let row=[],field='',quoted=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field='';}else field+=c;}
 if(quoted)throw new Error('מרכאות לא סגורות בקובץ CSV');
 row.push(field);if(row.some(x=>x.trim()))rows.push(row);
 const headers=rows.shift()||[];
 if(new Set(headers).size!==headers.length)throw new Error('כותרות CSV כפולות');
 return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h.trim(),r[i]||''])));
}
function importRows(){const text=$('#import-text').value.trim();return text.startsWith('[')?JSON.parse(text):parseCSV(text);}
async function doImport(apply){
 const report=await api('admin/import',{kind:$('#import-kind').value,rows:importRows(),full:$('#full').checked,apply});
 $('#import-report').textContent=(report.applied?'הייבוא נשמר בהצלחה.\n':'')+'נבדקו '+(report.count||0)+' רשומות.\n'+(report.errors.length?report.errors.join('\n'):'לא נמצאו שגיאות.')+(report.missing?.length?'\nלא נכללו בקובץ '+report.missing.length+' משניות:\n'+report.missing.join(', '):'');
 $('#apply-import').disabled=report.errors.length>0||!!report.applied;
}
document.addEventListener('submit',async event=>{
 event.preventDefault();const form=event.target,button=form.querySelector('button');if(button)button.disabled=true;notify();
 try{
 if(form.id==='login-form'){me=await api('login',{role:$('#role').value,password:$('#password').value});if(me.role==='admin')await navigate('admin');else await chooseStudent();}
 if(form.id==='select-form'){me=await api('select',{student_id:$('#student').value});await navigate('home');}
 if(form.id==='ticket-form'){await api('admin/ticket',{student_id:$('#ticket-student').value,delta:+$('#delta').value,reason:$('#reason').value});await admin();notify('תיקון הכרטיס נשמר.');}
 if(form.id==='settings-form'){await api('admin/settings',{lease_seconds:+$('#lease-seconds').value});notify('הזמנים נשמרו.');}
 }catch(e){notify(e.message);}finally{if(button)button.disabled=false;}
});
document.addEventListener('click',async event=>{
 const b=event.target.closest('button');if(!b||b.type==='submit'&&b.closest('form'))return;
 if(b.disabled)return;b.disabled=true;
 try{
 if(b.dataset.view)await navigate(b.dataset.view);
 if(b.dataset.learn)await learn(b.dataset.learn);
 if(b.dataset.answer)await submitAnswer(b.dataset.answer);
 if(b.dataset.revoke){if(confirm('לבטל את ההשלמה ואת הכרטיס שהוענק עבורה? הפעולה תתועד.')){await api('admin/revoke',{id:+b.dataset.revoke});await admin();}}
 if(b.dataset.student){await api('admin/student',{id:b.dataset.student,active:+b.dataset.active});await admin();}
 switch(b.dataset.action){
 case 'admin-login':login(true);break;
 case 'student-login':login();break;
 case 'learn':await learn();break;
 case 'question':await question();break;
 case 'reread':await reread();break;
 case 'release':await api('release',{id:lease.id});lease=null;await navigate('home');break;
 case 'validate':await doImport(false);break;
 case 'import':await doImport(true);break;
 case 'restore':await restoreBackup();break;
 case 'new-round':await api('admin/round',{});await admin();break;
 }
 }catch(e){notify(e.message);}finally{if(b.isConnected)b.disabled=false;}
});
document.addEventListener('change',async event=>{
 try{
 if(event.target.id==='class'){
 const students=roster.students.filter(s=>s.class_id===event.target.value);
 $('#student').disabled=!students.length;
 $('#student').innerHTML='<option value="">בחרו שם</option>'+students.map(s=>'<option value="'+E(s.id)+'">'+E(s.name)+'</option>').join('');
 }
 if(event.target.id==='class-filter')studentTable();
 if(event.target.id==='import-file'){
 const file=event.target.files[0];if(!file)return;if(file.size>4*1024*1024)throw new Error('הקובץ גדול מדי');
 $('#import-text').value=file.name.toLowerCase().endsWith('.xlsx')?JSON.stringify(await window.readGameWorkbook(file,$('#import-kind').value),null,2):await file.text();$('#apply-import').disabled=true;
 }
 if(['import-kind','full'].includes(event.target.id))$('#apply-import').disabled=true;
 }catch(e){notify(e.message);}
});
document.addEventListener('input',event=>{if(event.target.id==='search')studentTable();if(event.target.id==='import-text')$('#apply-import').disabled=true;});
$('#logout').addEventListener('click',async()=>{try{await api('logout',{});me=null;lease=null;login();}catch(e){notify(e.message);}});
setInterval(async()=>{if(me&&['home','map'].includes(view)&&!document.hidden){try{const old=JSON.stringify(state);state=await api('state');if(old!==JSON.stringify(state)){view==='home'?home():map();}}catch(e){notify(e.message);}}},15000);
(async()=>{try{me=await api('me');if(me.role==='school')await chooseStudent();else await navigate('home');}catch(e){login();}})();

function mainAppendBackup(){
 $('#main').insertAdjacentHTML('beforeend','<section class="panel"><h2>גיבוי ושחזור</h2><p>הגיבוי כולל את התוכן, התלמידים, הסבבים, ההשלמות והכרטיסים. שמרו אותו במקום פרטי.</p><a class="button" href="/api/admin/backup">הורדת גיבוי מלא</a><details><summary>שחזור מגיבוי</summary><p>השחזור יחליף את נתוני המשחק בנתוני הגיבוי וינתק את המשתמשים. הורידו גיבוי עדכני לפני השחזור.</p><label for="restore-file">קובץ הגיבוי</label><input id="restore-file" type="file" accept=".json"><button class="danger" data-action="restore">שחזור הנתונים</button></details></section>');
}
async function restoreBackup(){const file=$('#restore-file').files[0];if(!file)throw Error('בחרו קובץ גיבוי');if(file.size>4*1024*1024)throw Error('הקובץ גדול מדי');const backup=JSON.parse(await file.text());if(!confirm('להחליף את כל נתוני המשחק בנתוני הגיבוי? השינוי ישפיע על כל התלמידים.'))return;await api('admin/restore',{backup,confirm:'שחזור'});me=null;login(true);notify('הגיבוי שוחזר. היכנסו מחדש לניהול.');}
