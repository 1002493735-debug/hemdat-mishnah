import {unzipSync,strFromU8} from 'fflate';
function xml(bytes){const doc=new DOMParser().parseFromString(strFromU8(bytes),'application/xml');if(doc.querySelector('parsererror'))throw Error('קובץ Excel לא תקין');return doc;}
function cells(bytes){const z=unzipSync(new Uint8Array(bytes));const shared=z['xl/sharedStrings.xml']?[...xml(z['xl/sharedStrings.xml']).getElementsByTagName('si')].map(e=>e.textContent):[];
 const sheet=z['xl/worksheets/sheet1.xml'];if(!sheet)throw Error('הגיליון הראשון לא נמצא');
 return [...xml(sheet).getElementsByTagName('row')].map(row=>{const values=[];for(const c of row.getElementsByTagName('c')){let i=0;for(const a of c.getAttribute('r').replace(/\d/g,''))i=i*26+a.charCodeAt(0)-64;const v=c.getElementsByTagName('v')[0]?.textContent||'';values[i-1]=c.getAttribute('t')==='s'?shared[+v]:c.getAttribute('t')==='inlineStr'?c.getElementsByTagName('is')[0]?.textContent||'':v;}return values;}).filter(r=>r.some(v=>v));
}
window.readGameWorkbook=async(file,kind)=>{const rows=cells(await file.arrayBuffer()),headers=rows.shift().map(v=>v?.trim());
 if(kind==='staff'){
  const first=headers.indexOf('שם פרטי'),last=headers.indexOf('שם משפחה');
  if(first<0||last<0)throw Error('נדרשות עמודות שם פרטי ושם משפחה');
  return Promise.all(rows.map(async r=>{
   const name=[r[first],r[last]].map(v=>String(v||'').trim()).join(' ').replace(/\s+/g,' ').trim();
   if(!r[first]||!r[last])throw Error('חסר שם פרטי או שם משפחה ברשימת הצוות');
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(name));
   const id='staff-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('').slice(0,20);
   return {id,name};
  }));
 }
 if(kind==='students'){const aliases={'מזהה תלמיד':'id','שם':'name','שם תלמיד':'name','מזהה כיתה':'class_id','כיתה':'class_name'};const keys=headers.map(h=>aliases[h]||h);if(!['id','name','class_id','class_name'].every(k=>keys.includes(k)))throw Error('נדרשות עמודות id, name, class_id, class_name');return rows.map(r=>Object.fromEntries(keys.map((k,i)=>[k,String(r[i]||'')])));}
 if(headers[1]!=='מסכת'||headers[4]!=='טקסט המשנה המלא')throw Error('מבנה הקובץ אינו תואם למאגר המשניות. השתמשו בקובץ המאגר המקורי או בתבנית JSON.');
 const heb=['','א','ב','ג','ד','ה','ו','ז','ח','ט','י','יא','יב','יג','יד','טו'],names={'סוכה':'sukkah','יומא':'yoma','ראש השנה':'rosh-hashanah'};
 const n=v=>/^\d+$/.test(v)?+v:heb.indexOf(String(v).replace(/[׳״'"\s]/g,''));
 return rows.map(r=>({id:`${names[r[1]]||r[1]}:${n(r[2])}:${n(r[3])}`,text:r[4]||'',questions:[5,12].map(i=>({prompt:r[i]||'',options:Array.from({length:4},(_,j)=>r[i+1+j]||''),correct:r[i+5]||'',hint:r[i+6]||''})),source:r[19]||'',status:['נבדק','מוכן','ready'].includes(r[20])?'ready':['חסר','missing'].includes(r[20])?'missing':'review'}));
};
