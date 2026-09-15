"""Convert one-class-per-sheet school XLSX to validated import JSON; never commit output."""
import hashlib,json,re,sys,zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
def convert(path):
 ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 with zipfile.ZipFile(path) as z:
  strings=[''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in z.namelist() else []
  rels={r.get('Id'):r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
  output=[]; counts={}; seen=set()
  for sheet in ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',ns):
   match=re.match(r'^([א-ו])\s*-\s*(\d+)',sheet.get('name',''))
   if not match: raise ValueError('Unrecognized class sheet')
   grade,group=match.groups(); cid=f'class-{ord(grade)-ord("א")+1}-{group}'; cname=f'{grade}׳{group}'
   target=rels[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
   target=target.lstrip('/') if target.startswith('/') else 'xl/'+target
   counts[cname]=0
   for row in ET.fromstring(z.read(target)).findall('.//s:sheetData/s:row',ns):
    values={}
    for c in row:
     col=re.sub(r'\d','',c.get('r'));v=c.find('s:v',ns);v=v.text if v is not None else ''
     values[col]=strings[int(v)] if c.get('t')=='s' else ''.join(c.find('s:is',ns).itertext()) if c.get('t')=='inlineStr' else v
    name=' '.join((values.get('B') or '').split());number=values.get('A') or ''
    if not name or name=='שם תלמיד': continue
    if not re.fullmatch(r'\d+',number): raise ValueError('Named row without student number')
    key=cid+'|'+name
    if key in seen: raise ValueError('Duplicate name within class; needs clarification')
    seen.add(key);counts[cname]+=1
    output.append({'id':'school-'+hashlib.sha256(key.encode()).hexdigest()[:20],'name':name,'class_id':cid,'class_name':cname})
 return output,counts
if __name__=='__main__':
 rows,counts=convert(sys.argv[1]);Path(sys.argv[2]).write_text(json.dumps(rows,ensure_ascii=False));print(json.dumps({'students':len(rows),'classes':counts},ensure_ascii=False))
