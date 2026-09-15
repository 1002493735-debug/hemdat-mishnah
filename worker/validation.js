import structure from '../data/structure.json' with {type:'json'};
export {structure};
export const canon=new Set(structure.flatMap(t=>t.chapters.flatMap((n,c)=>Array.from({length:n},(_,m)=>`${t.id}:${c+1}:${m+1}`))));
export function validateContent(rows,full=false){
 const errors=[],seen=new Set();
 if(!Array.isArray(rows)||rows.length>149)return {errors:['הקובץ חייב להכיל מערך של עד 149 רשומות'],missing:[...canon]};
 rows.forEach((r,i)=>{
  if(!r||!canon.has(r.id)){errors.push(`שורה ${i+1}: מזהה לא תקין`);return;}
  if(seen.has(r.id))errors.push(`${r.id}: משנה כפולה`);seen.add(r.id);
  if(!['ready','review','missing'].includes(r.status))errors.push(`${r.id}: סטטוס לא תקין`);
  if(typeof r.text!=='string'||r.text.length>20000)errors.push(`${r.id}: טקסט לא תקין`);
  if(typeof (r.source||'')!=='string'||(r.source||'').length>4000)errors.push(`${r.id}: מקור לא תקין`);
  if(!Array.isArray(r.questions)){errors.push(`${r.id}: שאלות חסרות`);return;}
  if(r.questions.length>2||(r.status==='ready'&&(!r.text?.trim()||r.questions.length!==2)))errors.push(`${r.id}: טקסט או שאלה חסרים; נדרשות שתי שאלות`);
  for(const q of r.questions){
   if(!q||typeof q.prompt!=='string'||!q.prompt.trim()){errors.push(`${r.id}: שאלה חסרה`);continue;}
   if(!Array.isArray(q.options)||q.options.length!==4||q.options.some(o=>typeof o!=='string'||!o.trim()))errors.push(`${r.id}: נדרשות ארבע תשובות לא ריקות`);
   else if(new Set(q.options).size!==4)errors.push(`${r.id}: תשובות כפולות`);
   else if(!q.options.includes(q.correct))errors.push(`${r.id}: התשובה הנכונה אינה בין האפשרויות`);
   if(q.hint!==undefined&&typeof q.hint!=='string')errors.push(`${r.id}: רמז לא תקין`);
  }
 });
 const missing=[...canon].filter(id=>!seen.has(id));if(full&&missing.length)errors.push(`חסרות ${missing.length} משניות בייבוא מלא`);
 return {errors,missing,count:seen.size};
}
export function validateStudents(rows){
 const errors=[],ids=new Set(),classes=new Map();
 if(!Array.isArray(rows)||rows.length>2000)return {errors:['ניתן לייבא עד 2000 תלמידים בכל קובץ']};
 rows.forEach((r,i)=>{
  if(!r||!['id','name','class_id','class_name'].every(k=>typeof r[k]==='string'&&r[k].trim()&&r[k].length<=120)){errors.push(`שורה ${i+1}: חסרים שם או מזהה תלמיד וכיתה`);return;}
  if(ids.has(r.id))errors.push(`שורה ${i+1}: תלמיד כפול`);ids.add(r.id);
  if(classes.has(r.class_id)&&classes.get(r.class_id)!==r.class_name)errors.push(`שורה ${i+1}: שמות סותרים לכיתה`);
  if([...classes].some(([id,name])=>id!==r.class_id&&name===r.class_name))errors.push(`שורה ${i+1}: שם כיתה עם מזהים שונים`);
  classes.set(r.class_id,r.class_name);
 });return {errors,count:rows.length};
}
