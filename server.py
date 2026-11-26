#!/usr/bin/env python3
"""Frontier Fieldbook: local-only static server and atomic JSON persistence. Python 3.9+."""
import argparse, json, os, re, shutil, tempfile, threading, webbrowser
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote
ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
STATE = DATA / 'state.json'
PREV = DATA / 'state.previous.json'
LOCK = threading.Lock()
MAX_BYTES = 40 * 1024 * 1024

def initial():
    return {'schema':1, 'revision':0, 'profile': {'chapter':'1','horse':'','breed':'','cash':'','honor':'Not recorded','base':'','protectedSave':'','activeSave':'','next':''},'checks':{},'journal':[],'notes':[],'tasks':[],'photos':[],'settings':{'spoilerSafe':True}}

def valid(s):
    if not isinstance(s,dict) or s.get('schema') != 1 or type(s.get('revision')) is not int or s['revision'] < 0: raise ValueError('Invalid backup schema or revision.')
    if not isinstance(s.get('profile'),dict) or not isinstance(s.get('checks'),dict) or not isinstance(s.get('settings'),dict): raise ValueError('Invalid profile, settings or progress.')
    if any(not isinstance(k,str) or type(v) is not bool for k,v in s['checks'].items()): raise ValueError('Invalid progress values.')
    if any(not isinstance(v,str) for v in s['profile'].values()): raise ValueError('Invalid profile values.')
    for name,fields in {'journal':['id','title','date','category','text'],'notes':['id','title','text'],'tasks':['id','title','chapter'],'photos':['id','title','image']}.items():
        items=s.get(name)
        if not isinstance(items,list) or len(items)>10000: raise ValueError('Invalid '+name+' collection.')
        ids=set()
        for item in items:
            if not isinstance(item,dict) or any(not isinstance(item.get(f),str) for f in fields) or any(not isinstance(v,str) for v in item.values()): raise ValueError('Invalid '+name+' item.')
            if not item['id'] or item['id'] in ids: raise ValueError('Duplicate or missing item ID.')
            ids.add(item['id'])
            if name=='photos' and (not re.fullmatch(r'data:image/jpeg;base64,[A-Za-z0-9+/=]+',item['image']) or len(item['image'])>3_000_000): raise ValueError('Invalid screenshot data.')
    return s

def load():
    if not STATE.exists(): return initial()
    try: return valid(json.loads(STATE.read_text(encoding='utf-8')))
    except (OSError,ValueError,TypeError) as e: raise ValueError('Local state could not be read. Keep the file intact and restore from a backup. '+str(e)) from e

def atomic_write(path,data):
    fd, name = tempfile.mkstemp(prefix='.fieldbook-',dir=DATA)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        os.replace(name,path)
    finally:
        if os.path.exists(name): os.unlink(name)

def save(next_state):
    current=load()
    if current['revision'] != next_state['revision']: raise RuntimeError('Another tab changed this fieldbook. Refresh and retry; your existing data is unchanged.')
    next_state['revision'] += 1
    DATA.mkdir(exist_ok=True)
    if STATE.exists(): atomic_write(PREV,STATE.read_text(encoding='utf-8'))
    atomic_write(STATE,json.dumps(next_state,ensure_ascii=False,indent=2))
    return next_state

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw): super().__init__(*a,directory=str(ROOT),**kw)
    def respond(self,code,payload):
        raw=json.dumps(payload,ensure_ascii=False).encode('utf-8'); self.send_response(code); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(raw))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(raw)
    def allowed_host(self): return self.headers.get('Host','') in {f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
    def do_GET(self):
        if not self.allowed_host(): return self.respond(403,{'error':'Local connections only.'})
        path=unquote(urlsplit(self.path).path)
        if path=='/api/state':
            try:
                with LOCK: s=load()
                return self.respond(200,s)
            except ValueError as e: return self.respond(500,{'error':str(e)})
        # Explicit static allowlist. Never serve private data, Python code or backups.
        if path in ('/','/index.html','/style.css','/app.js','/content.js') or re.fullmatch(r'/assets/[A-Za-z0-9_.-]+',path): return super().do_GET()
        return self.respond(404,{'error':'Not found.'})
    def do_HEAD(self):
        if not self.allowed_host(): return self.send_error(403)
        path=unquote(urlsplit(self.path).path)
        if path in ('/','/index.html','/style.css','/app.js','/content.js') or re.fullmatch(r'/assets/[A-Za-z0-9_.-]+',path): return super().do_HEAD()
        return self.send_error(404)
    def do_POST(self):
        if not self.allowed_host() or urlsplit(self.path).path!='/api/state': return self.respond(403,{'error':'Local connections only.'})
        origin=self.headers.get('Origin')
        if origin and origin not in {f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}'}: return self.respond(403,{'error':'Invalid origin.'})
        if self.headers.get_content_type() != 'application/json': return self.respond(415,{'error':'JSON required.'})
        try:
            n=int(self.headers.get('Content-Length','0'))
            if n<=0 or n>MAX_BYTES: return self.respond(413,{'error':'Backup exceeds 40 MB. Export your data and reduce stored screenshots.'})
            next_state=valid(json.loads(self.rfile.read(n)))
            with LOCK: s=save(next_state)
            return self.respond(200,s)
        except RuntimeError as e: return self.respond(409,{'error':str(e)})
        except (ValueError,TypeError,UnicodeError) as e: return self.respond(400,{'error':str(e)})
        except OSError as e: return self.respond(500,{'error':'Could not write the local data file: '+str(e)})
    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Referrer-Policy','no-referrer'); self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        super().end_headers()

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--port',type=int,default=8765); ap.add_argument('--no-browser',action='store_true'); args=ap.parse_args()
    DATA.mkdir(exist_ok=True)
    try: server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    except OSError as e: raise SystemExit(f'Could not open port {args.port}: {e}. Close the other instance or choose --port 8766.')
    url=f'http://127.0.0.1:{server.server_port}/'; print('Frontier Fieldbook · '+url+'\nLeave this window open while using the site. Ctrl+C to stop.',flush=True)
    if not args.no_browser: threading.Timer(.6,lambda:webbrowser.open(url)).start()
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
