import {Miniflare} from 'miniflare';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist/client');
const mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',host:'0.0.0.0',port:4173,compatibilityDate:'2025-09-06',d1Databases:['DB'],d1Persist:'.wrangler/dev-db',bindings:{ADMIN_PASSWORD:'local-demo-admin-2026',SCHOOL_CODE:'local-demo',STAFF_CODE:'local-demo-staff',DEV_HTTP:true},serviceBindings:{ASSETS:async req=>{const p=path.resolve(root,'.'+new URL(req.url).pathname);if(!p.startsWith(root+'/'))return new Response('Not found',{status:404});try{const b=await fs.readFile(p);return new Response(b,{headers:{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.svg':'image/svg+xml'})[path.extname(p)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}}}});
const db=await mf.getD1Database('DB');await db.prepare('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)').run();
for(const f of (await fs.readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()){if(await db.prepare('SELECT 1 FROM local_migrations WHERE name=?').bind(f).first())continue;const statements=(await fs.readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s));statements.push(db.prepare('INSERT INTO local_migrations VALUES(?)').bind(f));await db.batch(statements);}
console.log('Development preview ready at '+await mf.ready);
