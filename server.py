"""Development HTTP service. Each mutation and its replay key commit together."""
import hashlib
import json
import os
import secrets
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from catalog import CROPS, PRICES, RECIPES, SITES, TECH, VERSION
import billing
import save_format
from database import connect
from pedestrian import unproject
from game import CONSUMERS, RuleError, advance, command, new_game, planning_route, quote, view

ROOT = Path(__file__).resolve().parent
DATABASE = os.environ.get('VESTIGIA_DB', str(ROOT / 'vestigia.sqlite3'))
DATABASE_URL = os.environ.get('VESTIGIA_DATABASE_URL')
GRAPH_FILE = os.environ.get('VESTIGIA_PEDESTRIAN_GRAPH')
SUPABASE_URL = os.environ.get('VESTIGIA_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('VESTIGIA_SUPABASE_KEY')
CATALOG = dict(version=VERSION,crops=CROPS,prices=PRICES,recipes=RECIPES,sites=SITES,
               technologies=TECH,consumers=CONSUMERS)

def initialize():
    with connect(DATABASE,DATABASE_URL) as conn, conn:
        if DATABASE_URL:
            conn.execute((ROOT/'migrations/001_postgres.sql').read_text())
        else:
            conn.execute('PRAGMA journal_mode = WAL')
            conn.executescript((ROOT/'migrations/001.sql').read_text())
        conn.execute((ROOT/'migrations/002_entitlements.sql').read_text())

def postgis_anchors(conn,owner,g,old_points):
    if 'graph' not in g:
        return
    for tile in g['tiles'].values():
        if old_points.get(tile['id'])==(tile['x'],tile['y']):
            continue
        p=unproject(g['graph']['origin'],tile['x'],tile['y'])
        conn.execute(
            "INSERT INTO city_anchors VALUES (?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326)) "
            "ON CONFLICT (owner,tile) DO UPDATE SET position=excluded.position",
            (owner,tile['id'],p['longitude'],p['latitude']))

def auth_ticket(body,refresh=False):
    if not SUPABASE_URL:
        raise RuleError('Sign-in is unavailable on this server')
    keys=('refresh_token',) if refresh else ('email','password')
    if not all(isinstance(body.get(k),str) and 0<len(body[k])<4096 for k in keys):
        raise RuleError('Required sign-in information is missing')
    grant='refresh_token' if refresh else 'password'
    headers={'apikey':SUPABASE_KEY,'Content-Type':'application/json'}
    request=Request(SUPABASE_URL.rstrip('/')+'/auth/v1/token?grant_type='+grant,
                    data=json.dumps({key:body[key] for key in keys}).encode(),headers=headers,method='POST')
    try:
        with urlopen(request,timeout=8) as response:
            result=json.load(response)
    except HTTPError as exc:
        if 400<=exc.code<500:
            raise PermissionError('Email, password or session was rejected') from exc
        raise ConnectionError('Authentication provider unavailable') from exc
    except URLError as exc:
        raise ConnectionError('Authentication provider unavailable') from exc
    return dict(token=result['access_token'],refresh_token=result['refresh_token'])

def owner_id(token):
    if SUPABASE_URL:
        if not token:
            raise PermissionError('Sign in to Vestigia first')
        request=Request(SUPABASE_URL.rstrip('/')+'/auth/v1/user',
                        headers={'apikey':SUPABASE_KEY,'Authorization':'Bearer '+token})
        try:
            with urlopen(request,timeout=5) as response:
                user=json.load(response)
        except HTTPError as exc:
            if exc.code in (401,403):
                raise PermissionError('Invalid Vestigia session') from exc
            raise ConnectionError('Authentication provider unavailable') from exc
        except URLError as exc:
            raise ConnectionError('Authentication provider unavailable') from exc
        if not user.get('id'):
            raise PermissionError('Invalid Vestigia session')
        return 'supabase:'+user['id']
    return hashlib.sha256(token.encode()).hexdigest()

def create(token=None):
    token=token if SUPABASE_URL else secrets.token_urlsafe(32)
    owner=owner_id(token)
    graph=json.loads(Path(GRAPH_FILE).read_text()) if GRAPH_FILE else None
    g=new_game('vestigia-world-v1' if graph else 'vestigia-fixture-v1',int(time.time()),graph)
    g['format']=save_format.CURRENT
    g['wall_at']=g['now']
    with connect(DATABASE,DATABASE_URL) as conn, conn:
        conn.execute('INSERT INTO cities VALUES (?,?) ON CONFLICT (owner) DO NOTHING',(owner,json.dumps(g)))
        row=conn.execute('SELECT state FROM cities WHERE owner=?',(owner,)).fetchone()
    saved=json.loads(row[0])
    save_format.upgrade(saved)
    return dict(token=token,city=view(saved))

def city(token, action=None, key=None, delete=False, quote_request=None, purchase=None, planner=None):
    owner=owner_id(token)
    receipt=billing.verify(owner,purchase) if purchase is not None else None
    with connect(DATABASE,DATABASE_URL) as conn, conn:
        if not DATABASE_URL:
            conn.execute('BEGIN IMMEDIATE')
        lock=' FOR UPDATE' if DATABASE_URL else ''
        row=conn.execute('SELECT state FROM cities WHERE owner=?'+lock,(owner,)).fetchone()
        if not row:
            raise PermissionError('Unknown city token')
        if delete:
            conn.execute('DELETE FROM cities WHERE owner=?',(owner,))
            return {'deleted':True}
        g=json.loads(row[0])
        save_format.upgrade(g)
        old_points={t['id']:(t['x'],t['y']) for t in g['tiles'].values()} if DATABASE_URL else {}
        wall=max(g.get('wall_at',g['now']),int(time.time()))
        advance(g,g['now']+wall-g.get('wall_at',g['now']))
        g['wall_at']=wall
        if receipt:
            inserted=conn.execute(
                'INSERT INTO voucher_entitlements VALUES (?,?,?,?) ON CONFLICT (receipt_hash) DO NOTHING',
                (receipt,owner,5,wall)).rowcount
            if inserted:
                g['vouchers']+=5
            else:
                existing=conn.execute('SELECT owner FROM voucher_entitlements WHERE receipt_hash=?',(receipt,)).fetchone()
                if existing[0]!=owner:
                    raise RuleError('Store entitlement was already redeemed')
        if action is not None:
            if not isinstance(key,str) or not 1<=len(key)<=128:
                raise RuleError('Supply an Idempotency-Key header')
            payload=json.dumps(action,sort_keys=True,separators=(',',':'))
            remembered=hashlib.sha256(payload.encode()).hexdigest()
            past=conn.execute('SELECT payload FROM commands WHERE owner=? AND id=?',(owner,key)).fetchone()
            if past and past[0]!=remembered:
                raise RuleError('Idempotency key already belongs to another command')
            if not past:
                command(g,action)
                # Fixture coordinates live only in the latest state, never in command history.
                conn.execute('INSERT INTO commands VALUES (?,?,?)',(owner,key,remembered))
        if DATABASE_URL:
            postgis_anchors(conn,owner,g,old_points)
        conn.execute('UPDATE cities SET state=? WHERE owner=?',(json.dumps(g,allow_nan=False),owner))
        if planner is not None:
            return planning_route(g,planner)
        if quote_request is not None:
            require_sites=quote_request['source'] in g['sites'] and quote_request['destination'] in g['sites']
            if not require_sites:
                raise RuleError('Choose a valid source and destination')
            return quote(g,quote_request['source'],quote_request['destination'])
        return view(g)

class Handler(BaseHTTPRequestHandler):
    def answer(self,status,body,kind='application/json'):
        data=json.dumps(body,allow_nan=False).encode() if kind=='application/json' else body
        self.send_response(status)
        self.send_header('Content-Type',kind)
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(data)

    def input(self):
        size=int(self.headers.get('Content-Length','0'))
        if not 0<size<=32768:
            raise RuleError('Invalid request size')
        value=json.loads(self.rfile.read(size))
        if not isinstance(value,dict):
            raise RuleError('Expected a JSON object')
        return value

    def dispatch(self):
        try:
            method,path=self.command,self.path
            if method=='GET' and path in ('/','/app.js','/style.css'):
                filename,kind={
                    '/':('index.html','text/html; charset=utf-8'),
                    '/app.js':('app.js','text/javascript; charset=utf-8'),
                    '/style.css':('style.css','text/css; charset=utf-8'),
                }[path]
                self.answer(200,(ROOT/'static'/filename).read_bytes(),kind)
                return
            if method=='GET' and path=='/api/catalog':
                self.answer(200,CATALOG)
                return
            if method=='POST' and path in ('/api/login','/api/refresh'):
                self.answer(200,auth_ticket(self.input(),refresh=path.endswith('refresh')))
                return
            if method=='POST' and path=='/api/city':
                auth=self.headers.get('Authorization','')
                self.answer(201,create(auth[7:] if auth.startswith('Bearer ') else None))
                return
            authorization=self.headers.get('Authorization','')
            if not authorization.startswith('Bearer ') or len(authorization)>8192:
                raise PermissionError('A city token is required')
            token=authorization[7:]
            if path=='/api/city' and method in ('GET','DELETE'):
                self.answer(200,city(token,delete=method=='DELETE'))
            elif path=='/api/command' and method=='POST':
                self.answer(200,city(token,self.input(),self.headers.get('Idempotency-Key')))
            elif path=='/api/billing/config' and method=='GET':
                owner=owner_id(token)
                self.answer(200,dict(product=billing.PRODUCT,account=billing.account_id(owner),
                    apple=bool(os.environ.get('VESTIGIA_APPLE_ROOT_CERTS')),
                    google=bool(os.environ.get('VESTIGIA_GOOGLE_PLAY_BILLING'))))
            elif path=='/api/billing/redeem' and method=='POST':
                self.answer(200,city(token,purchase=self.input()))
            elif path=='/api/planner/route' and method=='POST':
                self.answer(200,city(token,planner=self.input()['site']))
            elif path=='/api/quote' and method=='POST':
                body=self.input()
                self.answer(200,city(token,quote_request=body))
            else:
                self.answer(HTTPStatus.NOT_FOUND,{'error':'Unknown endpoint'})
        except ConnectionError as exc:
            self.answer(503,{'error':str(exc)})
        except PermissionError as exc:
            self.answer(401,{'error':str(exc)})
        except (ValueError,TypeError,KeyError,OverflowError) as exc:
            self.answer(422,{'error':str(exc)})

    do_GET=do_POST=do_DELETE=dispatch

if __name__=='__main__':
    if bool(SUPABASE_URL)!=bool(SUPABASE_KEY):
        raise SystemExit('Set both VESTIGIA_SUPABASE_URL and VESTIGIA_SUPABASE_KEY')
    initialize()
    port=int(os.environ.get('PORT','8080'))
    with ThreadingHTTPServer(('0.0.0.0',port),Handler) as http:
        mode='GPS' if GRAPH_FILE else 'fixture'
        print(f'Vestigia {mode} listening on http://127.0.0.1:{port}',flush=True)
        http.serve_forever()
