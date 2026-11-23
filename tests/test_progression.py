import copy
import json
import unittest
from unittest.mock import patch

import game
import save_format
import server
import test_acceptance

def constructed(g,coordinate,kind,worker=None):
    tile=game.world_tile(g,coordinate,0)
    site=game.make_site(tile,kind,[],g['now'])
    site.update(built=True,worker=worker)
    g['sites'][site['id']]=site
    return site

class Progression(unittest.TestCase):
    def test_research_staffing_and_mid_cycle_site_upgrade(self):
        g=game.new_game('progression',0)
        s=constructed(g,1,'workshop',1)
        g['citizens'][1]['assignment']=['work',s['id']]
        s['recipe']='workshop / 1 tool'
        g['technologies']+=['Smelting','Craft production']
        for good in ('copper bar','iron bar'):
            game.add(s['input'],good,2,88)
        game.begin_batch(g,s)
        self.assertIsNone(s['batch'])
        game.command(g,dict(op='research',name='Metalworking'))
        game.advance(g,7200)
        self.assertEqual(g['coins'],20)
        before=s['batch']['at']
        for qty,goods in game.upgrade_cost(s):
            game.add(s['upgrade'],'pine plank' if goods[0]=='plank' else goods[0],qty,55)
        g['fix']=dict(x=60,y=0,at=g['now'])
        game.command(g,dict(op='upgrade',site=s['id'],level=2))
        self.assertEqual(s['batch']['at'],before)
        game.advance(g,before)
        self.assertEqual(s['batch']['at']-before,720)
        game.command(g,dict(op='staff',site=s['id'],citizen=None))
        game.advance(g,before+720)
        self.assertIsNone(s['batch']['at'])
        self.assertEqual(game.count(s['output']),1)

    def test_college_to_university_fellowship(self):
        g=game.new_game('school',0)
        school=constructed(g,1,'primary school',1)
        college=constructed(g,2,'technical college')
        university=constructed(g,3,'university')
        university['visiting']=True
        g['citizens'][1]['assignment']=['work',school['id']]
        game.add(school['input'],'writing slates',1,55)
        game.command(g,dict(op='enrol',site=school['id'],students=[0],slates=True))
        game.advance(g,10800)
        self.assertEqual(g['citizens'][0]['education'],1)
        game.command(g,dict(op='staff',site=college['id'],citizen=1))
        game.command(g,dict(op='enrol',site=college['id'],students=[0]))
        game.advance(g,10800+28800)
        self.assertEqual(g['citizens'][0]['education'],2)
        game.command(g,dict(op='enrol',site=university['id'],students=[0]))
        game.advance(g,10800+28800+57600)
        self.assertEqual(g['citizens'][0]['education'],3)
        self.assertEqual(university['worker'],0)
        self.assertFalse(university['visiting'])

    def test_48_hours_matches_hourly_with_reserved_stock_and_survey(self):
        g=game.new_game('overnight',0)
        logger=constructed(g,1,'lumberjack station',0)
        logger['recipe']='lumberjack station / 1 pine log'
        game.add(logger['output'],'pine log',9,58)
        mill=constructed(g,2,'sawmill',1)
        mill['recipe']='sawmill / 1 pine plank'
        game.add(mill['output'],'pine plank',11,52)
        field=constructed(g,3,'field')
        field['crop']=dict(name='wheat',at=900,qty=4,q=72,pollinated=False)
        game.world_tile(g,4,0)
        prospect=game.world_tile(g,5,0)
        game.command(g,dict(op='survey',site=prospect['id'],tier=3))
        game.command(g,dict(op='haul',site=logger['id'],destination=mill['id'],buffer='input',good='pine log',qty=3))
        self.assertEqual(game.reserve(g,mill,'input'),3)
        hourly=json.loads(json.dumps(g))
        once=copy.deepcopy(hourly)
        for h in range(1,49):
            game.advance(hourly,h*3600)
        game.advance(once,48*3600)
        self.assertEqual(once,hourly)
        self.assertEqual(game.count(once['sites']['2,0']['output']),12)
        self.assertEqual(game.count(once['sites']['2,0']['input']),2)
        self.assertEqual(once['tiles'][prospect['id']]['report']['mineral'],'copper ore')
        self.assertEqual(once['sites'][field['id']]['crop']['name'],'wheat')

    def test_migrated_batch_and_untyped_stock_survive(self):
        g=game.new_game('legacy',0)
        mill=constructed(g,1,'sawmill',0)
        mill['recipe']='sawmill / 1 pine plank'
        game.add(mill['input'],'pine log',1,65)
        game.begin_batch(g,mill)
        g.pop('town_store')
        mill.pop('conversion')
        g['cargo']=[dict(good='plank',qty=1)]
        before=mill['batch'].copy()
        save_format.upgrade(g)
        save_format.upgrade(g)
        self.assertEqual(g['cargo'],[dict(good='pine plank',qty=1,q=50)])
        self.assertEqual(mill['batch'],before)
        game.advance(g,before['at'])
        self.assertEqual(mill['output'][0]['q'],before['q'])

class BillingLedger(unittest.TestCase):
    def setUp(self):
        # Share only the temporary database setup, not the base test methods.
        test_acceptance.Acceptance.setUp(self)

    def test_platform_entitlement_is_global_and_survives_city_deletion(self):
        another=server.create()['token']
        with patch('server.billing.verify',return_value='verified-platform-transaction'):
            purchase=dict(platform='apple',receipt='example')
            state=server.city(self.token,purchase=purchase)
            self.assertEqual(state['vouchers'],5)
            self.assertEqual(server.city(self.token,purchase=purchase)['vouchers'],5)
            with self.assertRaisesRegex(game.RuleError,'already redeemed'):
                server.city(another,purchase=purchase)
            server.city(self.token,delete=True)
            with self.assertRaisesRegex(game.RuleError,'already redeemed'):
                server.city(another,purchase=purchase)
