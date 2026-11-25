import unittest

import game
import save_format
from pedestrian import import_elements, project, route, snap, unproject

ORIGIN=(59.0,18.0)

def sample(x,y,at,accuracy=5):
    return dict(unproject(ORIGIN,x,y),at=at,accuracy=accuracy)

def node(number,x,y):
    p=unproject(ORIGIN,x,y)
    return dict(type='node',id=number,lat=p['latitude'],lon=p['longitude'])

def way(number,nodes,**tags):
    return dict(type='way',id=number,nodes=nodes,tags={'highway':'footway',**tags})

def sample_graph():
    return import_elements(dict(elements=[
        node(1,0,0),node(2,60,0),node(3,120,0),node(4,60,24),node(5,120,24),
        node(9,30,0),node(14,90,0),
        node(6,0,12),node(7,120,12),node(8,180,0),
        way(10,[1,9,2,14,3]),way(11,[4,5]),way(12,[6,7],access='private'),
        way(13,[3,8],highway='motorway'),
    ]),ORIGIN)

class Pedestrian(unittest.TestCase):
    def test_built_tile_path_follows_turns_and_uses_current_road_levels(self):
        graph=import_elements(dict(elements=[
            node(1,0,0),node(2,30,0),node(3,30,15),node(4,80,15),
            way(10,[1,2]),way(11,[2,3]),way(12,[3,4]),
        ]),ORIGIN)
        g=game.new_game('bent-path',0,graph)
        for x,y in ((10,0),(65,15)):
            game.discover_live(g,snap(graph,dict(x=x,y=y)),game.live_world.hex_cell(x,y))
        start,end='hex:0,0','hex:1,0'
        game.command(g,dict(op='build path',site=start,destination=end))
        g['roads']['10/1/2/0']=dict(passages=1,paid=0)
        g['roads']['12/3/4/0']=dict(passages=1,paid=4)
        connection=game.view(g)['tile_paths'][0]
        self.assertEqual([section['level'] for section in connection['sections']],[1,0,4])
        projected=[project(ORIGIN,**point) for point in connection['line']]
        self.assertEqual([(round(point['x']),round(point['y'])) for point in projected],
                         [(10,0),(30,0),(30,15),(65,15)])
        g['roads']['11/2/3/0']=dict(passages=3,paid=0)
        self.assertEqual(game.view(g)['tile_paths'][0]['sections'][1]['level'],2)
        for road in g['roads'].values():
            road['paid']=max(road['paid'],3)
        self.assertEqual(game.quote(g,start,end)['capacity'],18)

    def test_disconnected_gps_tiles_do_not_charge_for_path(self):
        graph=sample_graph()
        g=game.new_game('disconnected-path',0,graph)
        start=game.world_tile(g,0,0)
        start.update(snap(graph,dict(x=10,y=0)))
        game.begin_city(g,start)
        end=game.world_tile(g,1,0)
        end.update(snap(graph,dict(x=60,y=24)))
        with self.assertRaisesRegex(game.RuleError,'No mapped walking route'):
            game.command(g,dict(op='build path',site=start['id'],destination=end['id']))
        self.assertEqual(g['coins'],30)

    def test_overpass_connects_approaches_and_reopens_saved_hexes(self):
        graph=import_elements(dict(elements=[
            node(1,0,0),node(2,30,0),node(3,70,0),node(4,100,0),node(5,160,0),
            node(6,70,-60),node(7,70,60),node(8,70,0),
            way(10,[1,2]),way(11,[2,3,4],bridge='yes',layer='1'),way(12,[4,5]),
            way(13,[6,7],highway='motorway'),way(14,[6,8,7]),
        ]),ORIGIN)
        self.assertIsNotNone(route(graph,snap(graph,dict(x=0,y=0)),snap(graph,dict(x=135,y=0))))
        # Simulate the layer-specific junctions stored in cities before the fix.
        for edge in graph['edges'].values():
            for end in ('a','b'):
                edge[end]+=f"@{edge['layer']}"
        g=game.new_game('overpass',100,graph)
        g['format']=3
        game.command(g,dict(op='gps samples',samples=[sample(0,0,100)]))
        self.assertIn([1,0],g['blocked_hexes'])

        save_format.upgrade(g)
        self.assertNotIn([1,0],g['blocked_hexes'])
        start=snap(graph,dict(x=0,y=0))
        self.assertIsNone(route(graph,start,snap(graph,dict(x=70,y=50))))
        self.assertNotIn('13/6/7/0',graph['edges'])

        game.command(g,dict(op='walk',enabled=True,session='walk'))
        game.advance(g,170)
        game.command(g,dict(op='gps samples',session='walk',
                            samples=[sample(70,0,130),sample(135,0,160)]))
        self.assertEqual(set(g['tiles']),{'hex:0,0','hex:1,0','hex:2,0'})

    def test_import_exclusions_and_disconnected_routes(self):
        graph=sample_graph()
        self.assertEqual({key.split('/')[0] for key in graph['edges']},{'10','11'})
        a=snap(graph,project(ORIGIN,**sample_location(0,0)))
        b=snap(graph,project(ORIGIN,**sample_location(60,0)))
        c=snap(graph,project(ORIGIN,**sample_location(60,24)))
        self.assertAlmostEqual(route(graph,a,b)[0],60)
        self.assertIsNone(route(graph,b,c))

    def test_sidewalk_pairing_does_not_connect_routes_or_parallel_streets(self):
        nodes=[node(1,0,0),node(2,60,0),node(3,0,8),node(4,60,8),node(5,0,16),node(6,60,16)]
        graph=import_elements(dict(elements=nodes+[
            way(10,[1,2],footway='sidewalk',street='Oak Street'),
            way(11,[4,3],footway='sidewalk',street='Oak Street'),
            way(12,[5,6],footway='sidewalk',street='Pine Street'),
        ]),ORIGIN)
        edges=list(graph['edges'].values())
        self.assertEqual(edges[0]['canonical'],edges[1]['canonical'])
        self.assertNotEqual(edges[0]['canonical'],edges[2]['canonical'])
        a=snap(graph,dict(x=30,y=0))
        b=snap(graph,dict(x=30,y=8))
        self.assertIsNone(route(graph,a,b))

    def test_replay_gap_and_connected_hauls(self):
        g=game.new_game('live',100,sample_graph())
        self.assertEqual(len(g['tiles']),0)
        game.command(g,dict(op='gps samples',samples=[sample(0,0,100)]))
        self.assertEqual(list(g['tiles']),['hex:0,0'])
        game.command(g,dict(op='walk',enabled=True,session='walk'))
        game.advance(g,170)
        action=dict(op='gps samples',session='walk',samples=[sample(60,0,130),sample(120,0,160)])
        game.command(g,action)
        self.assertEqual(set(g['tiles']),{'hex:0,0','hex:1,0','hex:2,0'})
        self.assertEqual(g['xp'],4)
        self.assertEqual(sum(r['passages'] for r in g['roads'].values()),4)
        self.assertEqual(game.quote(g,'hex:0,0','hex:1,0')['fee'],3)
        game.command(g,action)
        self.assertEqual(g['xp'],4)
        self.assertEqual(sum(r['passages'] for r in g['roads'].values()),4)
        game.advance(g,300)
        game.command(g,dict(op='gps samples',session='walk',samples=[sample(60,24,300)]))
        self.assertEqual(g['xp'],4)
        self.assertFalse(game.nearby(g,g['tiles']['hex:1,0']))
        with self.assertRaisesRegex(game.RuleError,'Fixture controls'):
            game.command(g,dict(op='step',dx=1,dy=0))
        with self.assertRaisesRegex(game.RuleError,'different walk'):
            game.command(g,dict(op='gps samples',session='another',samples=[sample(60,0,300)]))
        self.assertNotIn('graph',game.view(g))

    def test_reveal_starts_at_edge_and_includes_cells_between_fixes(self):
        g=game.new_game('live',100,sample_graph())
        game.command(g,dict(op='gps samples',samples=[sample(32,0,100)]))
        game.command(g,dict(op='walk',enabled=True,session='walk'))
        game.advance(g,102)
        game.command(g,dict(op='gps samples',session='walk',samples=[sample(34,0,102)]))
        self.assertIn('hex:1,0',g['tiles'])
        self.assertLess(g['tiles']['hex:1,0']['x'],36)

        graph=import_elements(dict(elements=[node(1,0,0),node(2,130,0),way(10,[1,2])]),ORIGIN)
        g=game.new_game('live',100,graph)
        game.command(g,dict(op='gps samples',samples=[sample(20,0,100)]))
        game.command(g,dict(op='walk',enabled=True,session='walk'))
        game.advance(g,142)
        game.command(g,dict(op='gps samples',session='walk',samples=[sample(115,0,142)]))
        self.assertEqual(set(g['tiles']),{'hex:0,0','hex:1,0','hex:2,0'})

    def test_walking_near_hex_reveals_it_before_entering(self):
        g=game.new_game('live',100,sample_graph())
        game.command(g,dict(op='gps samples',samples=[sample(0,0,100)]))
        game.command(g,dict(op='walk',enabled=True,session='walk'))
        game.advance(g,120)
        game.command(g,dict(op='gps samples',session='walk',samples=[sample(23,0,115)]))
        self.assertNotIn('hex:1,0',g['tiles'])
        game.command(g,dict(op='gps samples',session='walk',samples=[sample(24,0,120)]))
        tile=g['tiles']['hex:1,0']
        self.assertEqual(game.live_world.hex_cell(tile['x'],tile['y']),(1,0))
        self.assertFalse(game.nearby(g,tile))
        self.assertEqual(g['xp'],2)

    def test_existing_gps_tile_is_kept_after_entering_same_hex(self):
        g=game.new_game('live',100,sample_graph())
        fix=snap(g['graph'],dict(x=0,y=0))
        site=game.world_tile(g,0,0)
        site.update(fix)
        game.begin_city(g,site)
        game.command(g,dict(op='gps samples',samples=[sample(0,0,100)]))
        game.command(g,dict(op='walk',enabled=True,session='walk'))
        game.advance(g,102)
        game.command(g,dict(op='gps samples',session='walk',samples=[sample(4,0,102)]))
        self.assertEqual(list(g['tiles']),['0,0'])
        self.assertEqual(g['town_store'],'0,0')


    def test_off_path_inside_accessible_hex_reveals_and_allows_building(self):
        graph=import_elements(dict(elements=[
            node(1,-50,-25),node(2,420,-25),way(10,[1,2]),
        ]),ORIGIN)
        g=game.new_game('footprint',100,graph)
        game.command(g,dict(op='gps samples',samples=[sample(0,-25,100)]))
        game.command(g,dict(op='walk',enabled=True,session='walk'))
        game.advance(g,140)
        game.command(g,dict(op='gps samples',session='walk',samples=[sample(68,10,140)]))
        tile=g['tiles']['hex:1,0']
        self.assertTrue(game.nearby(g,tile))
        game.command(g,dict(op='plan',site=tile['id'],kind='sawmill'))
        game.command(g,dict(op='build',site=tile['id']))
        self.assertFalse(g['sites'][tile['id']]['built'])
        game.advance(g,g['sites'][tile['id']]['construction']['at'])
        self.assertTrue(g['sites'][tile['id']]['built'])
        self.assertNotIn([1,0],g['blocked_hexes'])

    def test_unreachable_mark_survives_walking_away(self):
        graph=import_elements(dict(elements=[
            node(1,-50,0),node(2,420,0),way(10,[1,2]),
        ]),ORIGIN)
        g=game.new_game('access-memory',100,graph)
        game.command(g,dict(op='gps samples',samples=[sample(0,0,100)]))
        unreachable=[0,1]
        first=game.view(g)['blocked_hexes']
        self.assertIn(unreachable,first)
        self.assertNotIn([0,0],first)
        game.command(g,dict(op='walk',enabled=True,session='walk'))
        game.advance(g,300)
        game.command(g,dict(op='gps samples',session='walk',samples=[sample(400,0,300)]))
        self.assertIn(unreachable,game.view(g)['blocked_hexes'])
        self.assertGreater(len(g['blocked_hexes']),len(first))

    def test_legacy_pine_in_city_center_moves_to_an_open_hex(self):
        g=game.new_game('legacy-center',100,sample_graph())
        for index,x in enumerate((0,15,60)):
            tile=game.world_tile(g,index,0)
            tile.update(snap(g['graph'],dict(x=x,y=0)))
            if index==0:
                game.begin_city(g,tile)
        overlap=g['tiles']['1,0']
        self.assertEqual(overlap['resource'],'pine')
        with self.assertRaisesRegex(game.RuleError,'city center is reserved'):
            game.command(g,dict(op='plan',site=overlap['id'],kind='lumberjack station'))
        game.advance(g,100)
        city=game.view(g)
        self.assertTrue(city['tiles']['0,0']['city_center'])
        self.assertNotIn('1,0',city['tiles'])
        self.assertEqual(city['tiles']['2,0']['resource'],'pine')
        self.assertIn('lumberjack station',city['tiles']['2,0']['eligible'])


def sample_location(x,y):
    return unproject(ORIGIN,x,y)
