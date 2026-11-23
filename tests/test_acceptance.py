import concurrent.futures
import copy
import json
import tempfile
import io
import unittest
from pathlib import Path

import catalog
import game
import server

class Acceptance(unittest.TestCase):
    def setUp(self):
        folder=tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        old_db=server.DATABASE
        self.addCleanup(setattr,server,'DATABASE',old_db)
        server.DATABASE=str(Path(folder.name)/'game.db')
        server.initialize()
        self.token=server.create()['token']
        self.sequence=0

    def act(self,op,**params):
        self.sequence+=1
        return server.city(self.token,dict(op=op,**params),str(self.sequence))

    def step(self,dx=1,dy=0):
        return self.act('step',dx=dx,dy=dy)

    def opening(self):
        self.assertEqual(len(server.city(self.token)['tiles']),1)
        self.act('walk',enabled=True)
        self.step()
        self.act('plan',site='1,0',kind='lumberjack station')
        self.step()
        self.act('plan',site='2,0',kind='sawmill')
        with self.assertRaisesRegex(game.RuleError,'40 m'):
            self.act('build',site='1,0')
        self.act('build',site='2,0')
        self.step(-1)
        self.act('build',site='1,0')
        self.act('pickup',site='1,0',buffer='output',qty=1,good='pine log')
        self.step()
        state=self.act('deliver',site='2,0',buffer='input',qty=1,good='pine log')
        self.assertEqual(state['capacity'],1)
        self.assertEqual(state['sites']['2,0']['batch']['at']-state['now'],180)
        self.act('advance',seconds=900)
        self.step(-1)
        self.act('pickup',site='1,0',buffer='output',qty=1,good='pine log')
        self.step()
        self.act('deliver',site='2,0',buffer='input',qty=1,good='pine log')
        self.step()
        self.act('plan',site='3,0',kind='cottage')
        for _ in range(2):
            self.act('advance',seconds=180)
            self.step(-1)
            self.act('pickup',site='2,0',buffer='output',qty=1,good='pine plank')
            self.step()
            self.act('deliver',site='3,0',buffer='materials',qty=1,good='pine plank')
        return self.act('build',site='3,0')

    def test_first_cottage_and_offline_rent(self):
        state=self.opening()
        self.assertEqual(len(state['citizens']),6)
        self.act('advance',seconds=48*3600)
        state=self.act('tax',site='3,0')
        self.assertEqual(state['coins'],42)
        self.assertEqual(game.count(state['sites']['1,0']['output']),12)

    def test_survey_hidden_and_duplicate_concurrent(self):
        self.act('walk',enabled=True)
        for _ in range(5):
            self.step()
        self.assertNotIn('truth',server.city(self.token)['tiles']['5,0'])
        action=dict(op='survey',site='5,0',tier=1)
        with concurrent.futures.ThreadPoolExecutor() as pool:
            results=list(pool.map(lambda _:server.city(self.token,action,'survey-retry'),range(8)))
        self.assertEqual({g['coins'] for g in results},{27})
        state=self.act('advance',seconds=300)
        self.assertIsNone(state['tiles']['5,0']['report']['mineral'])
        self.assertNotIn('grade',state['tiles']['5,0'])
        self.act('survey',site='5,0',tier=3)
        self.act('advance',seconds=1800)
        server.initialize()
        self.assertEqual(server.city(self.token)['tiles']['5,0']['report']['mineral'],'copper ore')

    def test_reserved_haul_restarts_production(self):
        self.act('walk',enabled=True)
        self.step()
        self.act('plan',site='1,0',kind='lumberjack station')
        self.act('build',site='1,0')
        self.step()
        self.act('plan',site='2,0',kind='sawmill')
        self.act('build',site='2,0')
        state=self.act('haul',site='1,0',destination='2,0',buffer='input',good='pine log',qty=1)
        self.assertEqual(state['coins'],27)
        self.assertFalse(state['jobs'][0]['done'])
        self.assertFalse(state['sites']['2,0']['batch'])
        state=self.act('advance',seconds=360)
        self.assertTrue(state['jobs'][0]['done'])
        self.assertEqual(game.count(state['sites']['2,0']['output']),1)
        receipt=dict(op='purchase',receipt='sandbox-retry')
        server.city(self.token,receipt,'purchase-1')
        state=server.city(self.token,receipt,'purchase-2')
        self.assertEqual(state['vouchers'],5)
        with self.assertRaisesRegex(game.RuleError,'another command'):
            server.city(self.token,dict(op='walk',enabled=False),'purchase-2')

    def test_housing_offline_equivalence_and_variety(self):
        g=game.new_game('test',0)
        tile=game.world_tile(g,1,0)
        s=game.make_site(tile,'cottage',[],0)
        g['sites'][tile['id']]=s
        s['built']=True
        for _ in range(4):
            game.resident(g,s,0)
        for good,qty in [('potatoes',4),('goat milk',4),('shirts',1)]:
            game.add(s['pantry'],good,qty,50)
        hourly=copy.deepcopy(g)
        for hour in range(1,49):
            game.advance(hourly,hour*3600)
        game.advance(g,48*3600)
        self.assertEqual(g,hourly)
        self.assertTrue(game.household(g,s)['ready'])
        self.assertEqual(game.household(g,s)['families'],['dairy','vegetables'])
        self.assertGreater(s['wear']['clothing'],0)

    def test_roads_return_parallel_and_jitter(self):
        self.act('walk',enabled=True)
        self.step()
        state=self.step(-1)
        self.assertEqual(state['roads']['0,0']['passages'],2)
        self.step(0,1)
        state=self.step()
        self.assertEqual(state['roads']['0,1']['passages'],1)
        self.assertEqual(state['roads']['0,0']['passages'],2)
        self.act('advance',seconds=1)
        state=self.act('fix',x=60.5,y=60,accuracy=5)
        self.assertEqual(state['roads']['0,1']['passages'],1)
        state=self.act('road',road='0,1',tier=2)
        self.assertEqual(state['coins'],26)

    def test_export_exact_floor_and_replay(self):
        g=game.new_game('export',0)
        tile=game.world_tile(g,1,0)
        depot=game.make_site(tile,'export depot',[],0)
        depot['built']=True
        g['sites'][tile['id']]=depot
        offer=dict(id='0/1',tier=1,good='pine plank',qty=6,floor=65,multiplier=1.75)
        g['offer_board']=[0,[offer]]
        game.command(g,dict(op='accept export',order='0/1'))
        game.add(depot['shared'],'pine plank',5,75)
        game.add(depot['shared'],'pine plank',1,60)
        action=dict(op='ship export',order='0/1',site='1,0')
        with self.assertRaises(game.RuleError):
            game.command(g,action)
        self.assertEqual(game.count(depot['shared']),6)
        game.add(depot['shared'],'pine plank',1,75)
        game.advance(g,86400)
        game.command(g,action)
        self.assertEqual(g['coins'],53)
        self.assertEqual(depot['shared'],[dict(good='pine plank',qty=1,q=60)])
        with self.assertRaises(game.RuleError):
            game.command(g,action)

    def test_http_entry_points(self):
        class MemoryRequest:
            def __init__(self, request):
                self.input=io.BytesIO(request)
                self.output=io.BytesIO()
            def makefile(self,*_):
                return self.input
            def sendall(self,data):
                self.output.write(data)

        def request(line, token=None):
            data=line+' HTTP/1.0\r\n'
            if token:
                data+=f'Authorization: Bearer {token}\r\n'
            sock=MemoryRequest((data+'\r\n').encode())
            server.Handler(sock,('127.0.0.1',0),None)
            headers,body=sock.output.getvalue().split(b'\r\n\r\n',1)
            return headers.splitlines()[0],body

        status,body=request('GET /')
        self.assertIn(b'200',status)
        self.assertIn(b'<title>Vestigia</title>',body)
        status,body=request('POST /api/city')
        self.assertIn(b'201',status)
        created=json.loads(body)
        self.assertEqual(len(created['city']['tiles']),1)
        self.assertIn(b'401',request('GET /api/city')[0])
        self.assertIn(b'200',request('GET /api/city',created['token'])[0])

class Catalog(unittest.TestCase):
    def test_catalog_and_technology_dependencies(self):
        self.assertEqual((len(catalog.CROPS),len(catalog.ANIMALS)),(55,12))
        reached=set(catalog.RAW)|{'log'}
        known={'Settlement basics'}
        while True:
            more={name for name,(_,req) in catalog.TECH.items() if set(req)<=known}
            if more<=known:
                break
            known |= more
        self.assertEqual(known,set(catalog.TECH))
        while True:
            next_items=reached | {n for r in catalog.RECIPES.values()
                if all(any(k in reached for k in ns) for _,ns in r['inputs'])
                for _,n in r['outputs']}
            if any(name.endswith(' plank') for name in reached):
                next_items.add('plank')
            if next_items==reached:
                break
            reached=next_items
        self.assertEqual(reached,set(catalog.PRICES))
        for name,site in catalog.SITES.items():
            for _,alternatives in site['cost']:
                self.assertTrue(set(alternatives)<=reached,name)
        for recipe in catalog.RECIPES.values():
            self.assertIn(recipe['site'],catalog.SITES)
            self.assertIn(recipe['tech'],known)

    def test_every_batch_respects_whole_output_capacity(self):
        for key,recipe in catalog.RECIPES.items():
            with self.subTest(recipe=key):
                g=game.new_game('batch',0)
                tile=game.world_tile(g,1,0)
                site=game.make_site(tile,recipe['site'],[],0)
                site.update(built=True,worker=0,recipe=key)
                g['sites']['1,0']=site
                g['technologies']=list(catalog.TECH)
                output_size=sum(q for q,_ in recipe['outputs'])
                for qty,goods in recipe['inputs']:
                    good=goods[0]
                    if good in ('log','plank'):
                        good='pine '+good
                    game.add(site['input'],good,qty,70)
                game.add(site['output'],'pine log',13-output_size,35)
                game.begin_batch(g,site)
                self.assertIsNone(site['batch'])
                game.take(site['output'],'pine log',1)
                game.begin_batch(g,site)
                self.assertIsNotNone(site['batch'])
                finish=site['batch']['at']
                grade=site['batch']['q']
                game.advance(g,finish)
                self.assertEqual(game.count(site['output']),12)
                self.assertEqual([(l['qty'],l['good']) for l in site['output'] if l['q']==grade],
                                 [tuple(o) for o in recipe['outputs']])

if __name__=='__main__':
    unittest.main()
