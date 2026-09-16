"""Extract names only from staff XLSX. Keep generated JSON outside the repository."""
import argparse,hashlib,json,sys,zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

def convert(path,exclude_rows=(),remove_suffix=""):
 skipped=set(exclude_rows)
 ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 with zipfile.ZipFile(path) as z:
  strings=[''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in z.namelist() else []
  rows=ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//s:sheetData/s:row',ns)
  def names(row):
   result={}
   for c in row:
    col=''.join(x for x in c.get('r','') if x.isalpha())
    if col not in ('A','B'):continue
    v=c.find('s:v',ns);v=v.text if v is not None else ''
    result[col]=strings[int(v)] if c.get('t')=='s' else ''.join(c.find('s:is',ns).itertext()) if c.get('t')=='inlineStr' else v
   return result
  assert names(rows[0])=={'A':'שם פרטי','B':'שם משפחה'},'Unexpected name columns'
  output=[];seen=set()
  for r in rows[1:]:
   if int(r.get('r')) in skipped:continue
   vals=names(r)
   if not any(vals.values()):continue
   name=' '.join((vals.get('A','')+' '+vals.get('B','')).split())
   if remove_suffix and name.endswith(' '+remove_suffix):name=name[:-(len(remove_suffix)+1)].strip()
   assert name not in seen,'Duplicate full name requires review'
   seen.add(name);output.append({'id':'staff-'+hashlib.sha256(name.encode()).hexdigest()[:20],'name':name})
  return output
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('source');parser.add_argument('output');parser.add_argument('--exclude-rows',default='');parser.add_argument('--remove-suffix',default='');args=parser.parse_args()
 rows=convert(args.source,[int(x) for x in args.exclude_rows.split(',') if x],args.remove_suffix);Path(args.output).write_text(json.dumps(rows,ensure_ascii=False));print(json.dumps({'staff':len(rows),'fields':['id','name']}))
