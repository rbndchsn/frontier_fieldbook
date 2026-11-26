#!/usr/bin/env python3
"""Optional content rebuild. Requires mistune. Keep stable mission ordering when changing source docs."""
from pathlib import Path
import json,re,mistune
base=Path(__file__).resolve().parent
src=base/'content'
md=mistune.create_markdown(escape=True,plugins=['table','url','task_lists'])
strategy=(src/'RDR2_strategy_v2.md').read_text()
sections=[]; missions={}; readiness=[]
for match in re.finditer(r'^## (\d+)\. ([^\n]+)\n(.*?)(?=^## \d+\. |\Z)',strategy,re.M|re.S):
    n,title,body=match.groups(); sid='s'+n
    sections.append(dict(id=sid,title=title,html=md(body),plain=body))
    if n=='1': readiness=[dict(id=f'ready-{j}',title=t) for j,t in enumerate(re.findall(r'^- \[ \] (.+)$',body,re.M))]
    if n in ('2','3','4'):
        ch=int(n)-1; rows=[]
        for line in body.splitlines():
            if not line.startswith('|') or re.match(r'^\|[- :]+\|',line):continue
            cells=[c.strip() for c in line.strip('|').split('|')]
            if cells[0] in ('Mission','Priority','Mission / strand'):continue
            if len(cells)==3: pri,title,desc=cells
            elif len(cells)==2: title,desc=cells;pri='Optional' if 'optional' in desc.lower() else ('Boundary' if 'stop boundary' in desc.lower() or 'late chapter' in desc.lower() or 'chapter transition' in desc.lower() else 'Story')
            else:continue
            rows.append(dict(id=f'ch{ch}-{len(rows)+1}',title=title,desc=desc.replace('**',''),priority=pri,chapter=ch))
        missions[str(ch)]=rows
other=[]
for f,id,title in [('RDR2_gameplay_guide.md','field','Field guide · original'),('RDR2_controls.md','controls','Xbox controls'),('RDR2_strategy.md','original','Strategy · original'),('RDR2_personal_journal.md','template','Journal template')]:
    txt=(src/f).read_text(); other.append(dict(id=id,title=title,html=md(txt),plain=txt))
(base/'content.js').write_text('window.GUIDE = '+json.dumps(dict(sections=sections,other=other,missions=missions,readiness=readiness),ensure_ascii=False)+';\n')
print(len(sections),{k:len(v) for k,v in missions.items()},len(readiness))
