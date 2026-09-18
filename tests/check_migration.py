import sqlite3,pathlib,json
c=sqlite3.connect(':memory:')
files=sorted(pathlib.Path('drizzle').glob('*.sql'))
for f in files[:-1]: c.executescript(f.read_text())
c.execute("insert into classes values('demo-a','בדיקה')")
c.execute("insert into students(id,class_id,name) values('demo-1','demo-a','בדיקה')")
c.execute("insert into rounds(id,number,started_at) values(1,1,1)")
for t in json.loads(pathlib.Path('data/structure.json').read_text()):
 c.execute('insert into tractates values(?,?)',(t['id'],t['name']))
 for ch,n in enumerate(t['chapters'],1):
  for m in range(1,n+1): c.execute('insert into mishnayot values(?,?,?,?)',(f"{t['id']}:{ch}:{m}",t['id'],ch,m))
# Existing live-like history: one pupil already has 115 tickets.
for mid, in c.execute('select id from mishnayot limit 115').fetchall():
 c.execute("insert into completions(round_id,mishnah_id,student_id,class_id,completed_at,content_revision) values(1,?,'demo-1','demo-a',unixepoch(),1)",(mid,))
before={t:c.execute('select * from '+t+' order by id').fetchall() for t in ['completions','tickets','rounds']}
assert len(before['tickets'])==115
c.executescript(files[-1].read_text())
for t,rows in before.items(): assert c.execute('select * from '+t+' order by id').fetchall()==rows,t
print('Migration preserved all 115 tickets, completions and round history exactly.')
