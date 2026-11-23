import unittest

import game
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
        self.assertEqual(list(g['tiles']),['0,0'])
        game.command(g,dict(op='walk',enabled=True,session='walk'))
        game.advance(g,170)
        action=dict(op='gps samples',session='walk',samples=[sample(60,0,130),sample(120,0,160)])
        game.command(g,action)
        self.assertEqual(set(g['tiles']),{'0,0','1,0','2,0'})
        self.assertEqual(g['xp'],4)
        self.assertEqual(sum(r['passages'] for r in g['roads'].values()),4)
        self.assertEqual(game.quote(g,'0,0','1,0')['fee'],3)
        game.command(g,action)
        self.assertEqual(g['xp'],4)
        self.assertEqual(sum(r['passages'] for r in g['roads'].values()),4)
        game.advance(g,300)
        game.command(g,dict(op='gps samples',session='walk',samples=[sample(60,24,300)]))
        self.assertEqual(g['xp'],4)
        self.assertFalse(game.nearby(g,g['tiles']['1,0']))
        with self.assertRaisesRegex(game.RuleError,'Fixture controls'):
            game.command(g,dict(op='step',dx=1,dy=0))
        with self.assertRaisesRegex(game.RuleError,'different walk'):
            game.command(g,dict(op='gps samples',session='another',samples=[sample(60,0,300)]))
        self.assertNotIn('graph',game.view(g))

def sample_location(x,y):
    return unproject(ORIGIN,x,y)
