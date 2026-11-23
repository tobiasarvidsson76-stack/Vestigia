"""Development HTTP service. Each mutation and its replay key commit together."""
import hashlib
import json
import os
import secrets
import sqlite3
import time
from contextlib import closing
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from catalog import CROPS, PRICES, RECIPES, SITES, TECH, VERSION
from game import CONSUMERS, RuleError, advance, command, new_game, quote, view

ROOT = Path(__file__).resolve().parent
DATABASE = os.environ.get('VESTIGIA_DB', str(ROOT / 'vestigia.sqlite3'))
CATALOG = dict(version=VERSION,crops=CROPS,prices=PRICES,recipes=RECIPES,sites=SITES,
               technologies=TECH,consumers=CONSUMERS)

def connection():
    conn=sqlite3.connect(DATABASE,timeout=15,isolation_level=None)
    conn.execute('PRAGMA foreign_keys = ON')
    return conn

def initialize():
    with closing(connection()) as conn:
        conn.execute('PRAGMA journal_mode = WAL')
        conn.executescript((ROOT/'migrations/001.sql').read_text())

def owner_id(token):
    return hashlib.sha256(token.encode()).hexdigest()

def create():
    token=secrets.token_urlsafe(32)
    g=new_game('vestigia-fixture-v1',int(time.time()))
    g['wall_at']=g['now']
    with closing(connection()) as conn:
        conn.execute('INSERT INTO cities VALUES (?,?)',(owner_id(token),json.dumps(g)))
    return dict(token=token,city=view(g))

def city(token, action=None, key=None, delete=False):
    owner=owner_id(token)
    with closing(connection()) as conn, conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute('SELECT state FROM cities WHERE owner=?',(owner,)).fetchone()
        if not row:
            raise PermissionError('Unknown city token')
        if delete:
            conn.execute('DELETE FROM cities WHERE owner=?',(owner,))
            return {'deleted':True}
        g=json.loads(row[0])
        wall=max(g.get('wall_at',g['now']),int(time.time()))
        advance(g,g['now']+wall-g.get('wall_at',g['now']))
        g['wall_at']=wall
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
        conn.execute('UPDATE cities SET state=? WHERE owner=?',(json.dumps(g,allow_nan=False),owner))
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
            if method=='POST' and path=='/api/city':
                self.answer(201,create())
                return
            authorization=self.headers.get('Authorization','')
            if not authorization.startswith('Bearer ') or len(authorization)>128:
                raise PermissionError('A city token is required')
            token=authorization[7:]
            if path=='/api/city' and method in ('GET','DELETE'):
                self.answer(200,city(token,delete=method=='DELETE'))
            elif path=='/api/command' and method=='POST':
                self.answer(200,city(token,self.input(),self.headers.get('Idempotency-Key')))
            elif path=='/api/quote' and method=='POST':
                body=self.input()
                g=city(token)
                self.answer(200,quote(g,body['source'],body['destination']))
            else:
                self.answer(HTTPStatus.NOT_FOUND,{'error':'Unknown endpoint'})
        except PermissionError as exc:
            self.answer(401,{'error':str(exc)})
        except (ValueError,TypeError,KeyError,OverflowError) as exc:
            self.answer(422,{'error':str(exc)})

    do_GET=do_POST=do_DELETE=dispatch

if __name__=='__main__':
    initialize()
    port=int(os.environ.get('PORT','8080'))
    print(f'Vestigia fixture listening on http://127.0.0.1:{port}',flush=True)
    ThreadingHTTPServer(('0.0.0.0',port),Handler).serve_forever()
