"""Read an XLSX content database without altering the workbook. Stdlib only."""
import json, sys, zipfile, hashlib
from pathlib import Path
from xml.etree import ElementTree as ET
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def convert(path):
    with zipfile.ZipFile(path) as z:
        strings=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            strings=[''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        rows=[]
        for row in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//s:sheetData/s:row',NS):
            values=['']*21
            for cell in row:
                letters=''.join(c for c in cell.attrib['r'] if c.isalpha()); col=0
                for c in letters: col=col*26+ord(c)-64
                v=cell.find('s:v',NS); value=v.text if v is not None else ''
                if cell.get('t')=='s': value=strings[int(value)]
                elif cell.get('t')=='inlineStr': value=''.join(cell.find('s:is',NS).itertext())
                if col<=21: values[col-1]=value or ''
            if values[1] and values[1]!='מסכת': rows.append(values)
    heb=['א','ב','ג','ד','ה','ו','ז','ח','ט','י','יא','יב','יג','יד','טו']
    names={'סוכה':'sukkah','ראש השנה':'rosh-hashanah','יומא':'yoma'}
    output=[]
    for r in rows:
        key=f'{names[r[1]]}:{heb.index(r[2])+1}:{heb.index(r[3])+1}'
        qs=[{'prompt':r[q],'options':r[q+1:q+5],'correct':r[q+5],'hint':r[q+6]} for q in (5,12)]
        output.append({'id':key,'status':'ready' if r[20]=='נבדק' else 'review','text':r[4],'questions':qs,'source':r[19]})
    structure=json.loads((Path(__file__).resolve().parents[1]/'data/structure.json').read_text())
    expected={f"{t['id']}:{c}:{m}" for t in structure for c,n in enumerate(t['chapters'],1) for m in range(1,n+1)}
    assert len(output)==len(expected)==149 and {r['id'] for r in output}==expected
    for r in output:
        assert r['text'] and all(q['prompt'] and len(set(q['options']))==4 and q['correct'] in q['options'] for q in r['questions']),r['id']
    return output
if __name__=='__main__':
    rows=convert(sys.argv[1]); Path(sys.argv[2]).write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
    print(f'Validated {len(rows)} unique Mishnayot and {len(rows)*2} questions; source SHA256: {hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest()}')
