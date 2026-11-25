import copy
import json
import unittest
from unittest.mock import patch

import catalog
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
    def test_gps_production_caps_offline_batches_and_resets_on_return(self):
        g=game.new_game('offline-production',0,{'edges':{}})
        game.begin_city(g,game.world_tile(g,0,0))
        logger=constructed(g,1,'lumberjack station',0)
        g['citizens'][0]['assignment']=['work',logger['id']]
        logger['recipe']='lumberjack station / 1 pine log'
        game.set_production_presence(g,True)
        self.assertIsNotNone(logger['batch'])

        game.advance(g,3600)
        self.assertEqual(game.count(logger['output']),4)
        self.assertIsNone(logger['batch'])
        game.set_production_presence(g,False)
        game.advance(g,5400)
        self.assertEqual(game.count(logger['output']),4)

        game.set_production_presence(g,True)
        self.assertGreater(logger['batch']['at'],5400)
        game.set_production_presence(g,False)
        game.advance(g,9000)
        self.assertEqual(game.count(logger['output']),8)
        self.assertIsNone(logger['batch'])

    def test_research_staffing_and_mid_cycle_site_upgrade(self):
        g=game.new_game('progression',0)
        s=constructed(g,1,'workshop',1)
        g['citizens'][1]['assignment']=['work',s['id']]
        for coordinate,kind in ((3,'primary school'),(4,'high school'),(5,'technical college')):
            constructed(g,coordinate,kind)
        for _ in range(36):
            game.resident(g,g['sites'][g['town_store']],3)
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
        for coordinate in range(6,40):
            constructed(g,coordinate,'primary school')
        game.command(g,dict(op='staff priority',site=s['id'],priority=0))
        game.advance(g,before+720)
        self.assertIsNone(s['worker'])
        self.assertIsNone(s['batch'] and s['batch']['at'])
        self.assertEqual(game.count(s['output']),1)

    @patch('game.passes_course',return_value=True)
    def test_college_to_university_fellowship(self,_passes):
        g=game.new_game('school',0)
        school=constructed(g,1,'primary school',1)
        high_school=constructed(g,2,'high school')
        college=constructed(g,3,'technical college')
        university=constructed(g,4,'university')
        university['visiting']=True
        g['citizens'][1]['assignment']=['work',school['id']]
        game.add(school['input'],'writing slates',1,55)
        game.command(g,dict(op='enrol',site=school['id'],slates=True))
        game.advance(g,16200)
        self.assertEqual(g['citizens'][0]['education'],1)
        game.command(g,dict(op='staff priority',site=high_school['id'],priority=2))
        game.command(g,dict(op='enrol',site=high_school['id']))
        game.advance(g,g['now']+21600)
        self.assertEqual(g['citizens'][0]['education'],2)
        game.command(g,dict(op='staff priority',site=high_school['id'],priority=1))
        game.command(g,dict(op='staff priority',site=college['id'],priority=2))
        game.command(g,dict(op='enrol',site=college['id']))
        college_graduates=college['course']['students'][:]
        game.advance(g,g['now']+28800)
        self.assertTrue(all(g['citizens'][i]['education']==3 for i in college_graduates))
        game.command(g,dict(op='enrol',site=university['id']))
        graduates=university['course']['students'][:]
        self.assertEqual(graduates,college_graduates)
        game.advance(g,g['now']+57600)
        self.assertTrue(all(g['citizens'][i]['education']==4 for i in graduates))
        self.assertIn(university['worker'],graduates)
        self.assertFalse(university['visiting'])

    def test_failed_student_cannot_retry_and_visiting_teacher_stays(self):
        g=game.new_game('visiting-teacher',0)
        home=g['sites'][g['town_store']]
        school=constructed(g,1,'high school')
        g['citizens'][1]['education']=1
        game.advance(g,0)
        self.assertTrue(school['visiting'])
        self.assertIsNone(school['worker'])
        game.command(g,dict(op='enrol',site=school['id']))
        with patch('game.passes_course',return_value=False):
            game.advance(g,school['course']['at'])
        self.assertEqual(school['last_class'],dict(graduated=0,failed=1))
        self.assertEqual(g['citizens'][1]['education'],1)
        self.assertEqual(g['citizens'][1]['education_limit'],1)
        self.assertTrue(school['visiting'])
        with self.assertRaisesRegex(game.RuleError,'No eligible residents'):
            game.command(g,dict(op='enrol',site=school['id']))
        game.resident(g,home,1)
        game.command(g,dict(op='enrol',site=school['id']))
        self.assertEqual(school['course']['students'],[2])
        with patch('game.passes_course',return_value=True):
            game.advance(g,school['course']['at'])
        self.assertEqual(school['last_class'],dict(graduated=1,failed=0))
        self.assertFalse(school['visiting'])
        self.assertEqual(school['worker'],2)

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

    def test_fields_are_constructed_on_plain_land_and_old_fields_survive(self):
        g=game.new_game('fields',0)
        game.world_tile(g,1,0)
        land=game.world_tile(g,2,0)
        self.assertEqual(land['resource'],'land')
        self.assertIn('field',game.view(g)['tiles'][land['id']]['eligible'])
        game.command(g,dict(op='plan',site=land['id'],kind='field'))
        field=g['sites'][land['id']]
        self.assertFalse(field['built'])
        game.fix_position(g,land)
        with self.assertRaisesRegex(game.RuleError,'Construction materials missing'):
            game.command(g,dict(op='build',site=land['id']))
        game.add(field['materials'],'pine plank',2,50)
        game.command(g,dict(op='build',site=land['id']))
        game.advance(g,field['construction']['at'])

        land['resource']='field'
        g['format']=2
        save_format.upgrade(g)
        self.assertEqual(land['resource'],'land')
        self.assertTrue(field['built'])
        self.assertEqual(field['kind'],'field')

    def test_fish_pond_can_only_be_built_on_pond_terrain(self):
        g=game.new_game('ponds',0)
        for x in range(1,9):
            game.world_tile(g,x,0)
        land,pond=g['tiles']['2,0'],g['tiles']['8,0']
        self.assertEqual(pond['resource'],'pond')
        with self.assertRaisesRegex(game.RuleError,'No eligible footprint'):
            game.command(g,dict(op='plan',site=land['id'],kind='fish pond'))
        self.assertEqual(game.view(g)['tiles'][pond['id']]['eligible'],['fish pond'])
        game.command(g,dict(op='plan',site=pond['id'],kind='fish pond'))
        game.fix_position(g,pond)
        game.add(g['sites'][pond['id']]['materials'],'pine plank',3,50)
        game.command(g,dict(op='build',site=pond['id']))
        game.advance(g,g['sites'][pond['id']]['construction']['at'])
        self.assertTrue(g['sites'][pond['id']]['built'])

    def test_crop_blueprint_plan_and_growth_progress(self):
        g=game.new_game('crop-plan',0)
        first=game.world_tile(g,2,0)
        second=game.world_tile(g,3,0)
        first['resource']=second['resource']='land'
        with self.assertRaisesRegex(game.RuleError,'different plot'):
            game.command(g,dict(op='plan',site=first['id'],kind='field',crop='latex'))
        game.command(g,dict(op='plan',site=first['id'],kind='field',crop='beans'))
        game.command(g,dict(op='move blueprint',site=first['id'],destination=second['id']))
        site=g['sites'][second['id']]
        self.assertEqual(site['planned_crop'],'beans')
        progress=game.view(g)['tiles'][second['id']]['tasks'][0]
        self.assertEqual((progress['collected'],progress['required']),(0,2))
        game.add(site['materials'],'pine plank',2,50)
        game.fix_position(g,second)
        game.command(g,dict(op='build',site=second['id']))
        game.advance(g,site['construction']['at'])
        game.fix_position(g,second)
        self.assertEqual(site['planned_crop'],'beans')
        game.command(g,dict(op='plant',site=second['id'],name='wheat'))
        self.assertNotIn('planned_crop',site)
        task=game.view(g)['tiles'][second['id']]['tasks'][0]
        self.assertEqual((task['kind'],task['at']-g['now'],task['duration']),
                         ('crop',catalog.CROPS['wheat']['seconds'],catalog.CROPS['wheat']['seconds']))

    def test_tile_paths_only_connect_neighbors_and_charge_once(self):
        g=game.new_game('paths',0)
        game.world_tile(g,1,0)
        game.world_tile(g,2,0)
        game.command(g,dict(op='build path',site='0,0',destination='1,0'))
        with self.assertRaisesRegex(game.RuleError,'already have a path'):
            game.command(g,dict(op='build path',site='1,0',destination='0,0'))
        with self.assertRaisesRegex(game.RuleError,'neighboring'):
            game.command(g,dict(op='build path',site='0,0',destination='2,0'))
        self.assertEqual(g['coins'],30-game.TILE_PATH_COST)
        state=game.view(g)
        self.assertEqual(state['tile_paths'],[dict(a='0,0',b='1,0',line=[])])
        self.assertEqual(state['tiles']['1,0']['path_targets'],['2,0'])

    def test_paid_road_levels_raise_hired_haul_capacity_along_the_whole_route(self):
        g=game.new_game('haul-capacity',0)
        destination=constructed(g,2,'warehouse')
        g['coins']=100
        g['roads']={key:dict(passages=40,paid=0) for key in ('0,0','1,0')}
        self.assertEqual(game.road_tier(g['roads']['0,0']),2)
        game.command(g,dict(op='road',road='0,0',tier=3))
        self.assertEqual(g['coins'],88)
        source=g['town_store']
        self.assertEqual(game.quote(g,source,destination['id'])['capacity'],12)
        game.command(g,dict(op='road',road='1,0',tier=3))
        self.assertEqual(game.quote(g,source,destination['id'])['capacity'],18)
        game.add(g['sites'][source]['shared'],'pine plank',24,55)
        haul=dict(op='haul',site=source,destination=destination['id'],buffer='shared',
                  source_buffer='shared',good='pine plank',qty=24)
        with self.assertRaisesRegex(game.RuleError,'up to 18 units'):
            game.command(g,haul)
        self.assertEqual(game.count(g['sites'][source]['shared']),24)
        for road in g['roads']:
            game.command(g,dict(op='road',road=road,tier=4))
        self.assertEqual(game.quote(g,source,destination['id'])['capacity'],24)
        game.command(g,haul)
        self.assertEqual(game.count(g['jobs'][0]['lots']),24)
        self.assertEqual(game.capacity(g),1)

    def test_staffing_priority_rebalances_qualified_workers(self):
        g=game.new_game('workforce',0)
        sawmill=constructed(g,1,'sawmill',1)
        workshop=constructed(g,2,'workshop')
        g['citizens'][1]['assignment']=['work',sawmill['id']]
        game.fill_jobs(g)
        self.assertEqual((sawmill['worker'],workshop['worker']),(0,1))
        school=constructed(g,3,'primary school')
        game.command(g,dict(op='staff priority',site=school['id'],priority=2))
        self.assertEqual(school['worker'],1)
        self.assertIsNone(workshop['worker'])
        self.assertEqual(sawmill['worker'],0)
        game.command(g,dict(op='staff priority',site=school['id'],priority=0))
        self.assertEqual(workshop['worker'],1)
        self.assertIsNone(school['worker'])

    def test_quarrying_unlock_and_research_progress(self):
        g=game.new_game('quarrying',0)
        tile=game.world_tile(g,1,0)
        tile['resource']='sand'
        self.assertNotIn('sand',game.producible(g)[0])
        with self.assertRaisesRegex(game.RuleError,'prerequisites'):
            game.command(g,dict(op='research',name='Quarrying'))
        g['technologies'].append('Prospecting')
        with self.assertRaisesRegex(game.RuleError,'Learning buildings'):
            game.command(g,dict(op='research',name='Quarrying'))
        constructed(g,2,'primary school')
        constructed(g,3,'high school')
        with self.assertRaisesRegex(game.RuleError,'Residents with education'):
            game.command(g,dict(op='research',name='Quarrying'))
        for _ in range(14):
            game.resident(g,g['sites'][g['town_store']],2)
        game.command(g,dict(op='research',name='Quarrying'))
        task=game.view(g)['tiles'][g['town_store']]['tasks'][0]
        self.assertEqual(task['kind'],'research')
        self.assertEqual(task['duration'],task['at']-g['now'])
        game.advance(g,task['at'])
        self.assertIn('sand',game.producible(g)[0])

    def test_industrial_alloys_requires_seventy_two_university_graduates(self):
        g=game.new_game('alloys-education',0)
        home=g['sites'][g['town_store']]
        for coordinate,kind in enumerate(game.SCHOOLS,1):
            constructed(g,coordinate,kind)
        g['technologies']+=['Deep mining','Metalworking']
        for _ in range(71):
            game.resident(g,home,4)
        game.resident(g,home,3)

        action=dict(op='research',name='Industrial alloys')
        with self.assertRaisesRegex(game.RuleError,r'Residents with education 4\+ \(71/72\)'):
            game.command(g,action)
        self.assertEqual(g['coins'],30)
        self.assertIsNone(g['research'])
        g['citizens'][-1]['education']=4
        game.command(g,action)
        self.assertEqual(g['research']['name'],'Industrial alloys')

    def test_local_market_and_school_gates_keep_household_needs(self):
        g=game.new_game('services',0)
        home=constructed(g,4,'cottage')
        constructed(g,9,'local marketplace')
        constructed(g,5,'primary school')
        for qty,goods in game.upgrade_cost(home):
            game.add(home['upgrade'],'pine plank' if goods[0]=='plank' else goods[0],qty,55)
        g['fix']=dict(x=240,y=0,at=g['now'])
        upgrade=dict(op='upgrade',site=home['id'],level=2)
        with self.assertRaisesRegex(game.RuleError,'Marketplace within 180 m'):
            game.command(g,upgrade)
        constructed(g,6,'local marketplace')
        with self.assertRaisesRegex(game.RuleError,'Household needs'):
            game.command(g,upgrade)
        demand=dict.fromkeys(game.NEEDS,1)
        home['history']=[[hour*3600,demand,demand,{'dairy':.5,'vegetables':.5}] for hour in range(1,25)]
        g['now']=24*3600
        g['fix']['at']=g['now']
        game.command(g,upgrade)
        self.assertEqual(home['level'],2)
        missing={row['label'] for row in game.service_coverage(g,home) if not row['covered']}
        self.assertEqual(missing,{'High school','Police station'})

    def test_city_center_and_branches_share_market_offerings(self):
        g=game.new_game('market-branches',0)
        home=constructed(g,2,'cottage')
        self.assertTrue(game.service_coverage(g,home)[0]['covered'])
        branch=constructed(g,5,'local marketplace')
        center=g['sites'][g['town_store']]
        for market in (center,branch):
            game.command(g,dict(op='buy supplies',site=market['id'],good='pine plank',qty=1))
            self.assertEqual(game.count(market['shared']),1)
        self.assertEqual(g['coins'],22)
        offer=dict(id='starter-order',sequence=0,good='pine plank',qty=1,payout=6,active=True)
        g['market']={center['id']:offer}
        sale=dict(op='fill market order',slot=center['id'],order=offer['id'],site=branch['id'])
        game.command(g,sale)
        self.assertEqual(game.count(branch['shared']),0)
        self.assertEqual(game.count(center['shared']),1)
        with self.assertRaisesRegex(game.RuleError,'Market order is unavailable'):
            game.command(g,{**sale,'site':center['id']})

    def test_second_university_relaxes_coverage_cap(self):
        g=game.new_game('education-coverage',0)
        campus=constructed(g,1,'university')
        homes=[constructed(g,x,'apartment house') for x in (14,15,16)]
        for home in homes:
            home['level']=7
        covered,nearby,capacity=game.school_allocations(g,'university')
        self.assertEqual(len(covered),2)
        self.assertEqual(len(nearby),3)
        self.assertEqual(capacity[campus['id']],dict(used=96,capacity=96))
        waiting=next(home for home in homes if home['id'] not in covered)
        self.assertTrue(next(row for row in game.service_coverage(g,waiting)
                             if row['label']=='University')['at_capacity'])
        constructed(g,17,'university')
        covered,_,_=game.school_allocations(g,'university')
        self.assertEqual(covered,{home['id'] for home in homes})

    def test_emergency_stations_need_education_to_upgrade(self):
        g=game.new_game('station-coverage',0)
        for coordinate,kind in ((1,'police station'),(2,'fire station')):
            station=constructed(g,coordinate,kind)
            for qty,goods in game.upgrade_cost(station):
                game.add(station['upgrade'],'pine plank' if goods[0]=='plank' else goods[0],qty,55)
            g['fix']=dict(x=coordinate*60,y=0,at=g['now'])
            with self.assertRaisesRegex(game.RuleError,'Primary school within 300 m'):
                game.command(g,dict(op='upgrade',site=station['id'],level=2))
        constructed(g,3,'primary school')
        for coordinate in (1,2):
            g['fix']['x']=coordinate*60
            game.command(g,dict(op='upgrade',site=f'{coordinate},0',level=2))
            self.assertEqual(g['sites'][f'{coordinate},0']['level'],2)

    def test_legacy_degrees_keep_their_place_in_the_school_ladder(self):
        g=game.new_game('legacy-education',0)
        g['format']=4
        home=g['sites'][g['town_store']]
        game.resident(g,home,2)
        game.resident(g,home,3)
        save_format.upgrade(g)
        save_format.upgrade(g)
        self.assertEqual([citizen['education'] for citizen in g['citizens']],[0,2,3,4])

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
