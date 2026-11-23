"""GPS reconciliation against the same inventory and discovery domain as the fixture."""
import math
from pedestrian import candidates, distance, project, route, unproject

MAX_GAP = 45
MAX_SPEED = 2.5

def apply_samples(g, samples, received, discover):
    if not isinstance(samples,list) or not 1<=len(samples)<=180:
        raise ValueError('Submit 1–180 location samples')
    graph=g['graph']
    for sample in samples:
        lat,lon,accuracy,at=(float(sample[k]) for k in ('latitude','longitude','accuracy','at'))
        if not all(math.isfinite(v) for v in (lat,lon,accuracy,at)) or not (
                -90<=lat<=90 and -180<=lon<=180 and 0<=accuracy<=30 and received-86400<=at<=received+5):
            continue
        previous=g.get('matched')
        if previous and at<=previous['at']:
            continue
        raw=project(graph['origin'],lat,lon)
        options=candidates(graph,raw,min(24,max(8,accuracy)))
        if not options:
            g['road_track']=None
            continue
        found=options[0]
        path=None
        elapsed=at-previous['at'] if previous else None
        if previous and elapsed<=MAX_GAP and distance(previous,found)>=2:
            feasible=[]
            for option in options[:8]:
                result=route(graph,previous,option)
                if result and result[0]<=MAX_SPEED*elapsed:
                    feasible.append((option,result))
            if not feasible:
                g['road_track']=None
                continue
            found,path=min(feasible,key=lambda option:option[0]['gap']+.04*option[1][0])
        sample_fix=dict(found,at=min(received,at))
        if previous:
            if path and path[0]>=2 and g['walking'] and at>=g['walk_started']:
                wear(g,path[1])
                discover(g,found)
            elif elapsed>MAX_GAP:
                g['road_track']=None
        if not g['tiles']:
            discover(g,found)
        g['matched']=sample_fix
        g['fix']=dict(x=found['x'],y=found['y'],at=sample_fix['at'])

def wear(g,path):
    for edge,lo,hi in path:
        if abs(lo-hi)<1e-9:
            continue
        data=g['graph']['edges'][edge]
        section=data['canonical']
        direction=1 if hi>lo else -1
        track=g['road_track']
        if not track or track['id']!=section or track['edge']!=edge:
            track=g['road_track']=dict(id=section,edge=edge,start=lo,direction=direction,credited=False)
        if direction!=track['direction'] and not track['credited']:
            track.update(start=lo,direction=direction)
        if abs(hi-track['start'])>=.7 and not track['credited']:
            road=g['roads'].setdefault(section,dict(passages=0,paid=0,
                anchor=dict({k:(data['p'][k]+data['q'][k])/2 for k in ('x','y')},edge=edge,t=.5),
                line=[unproject(g['graph']['origin'],**p) for p in (data['p'],data['q'])]))
            road['passages']+=1
            track['credited']=True
        if hi in (0,1):
            g['road_track']=None

def path_quote(g,source,destination):
    result=route(g['graph'],source,destination)
    if not result or result[0]<=0:
        raise ValueError('No connected pedestrian route between sites')
    metres,path=result
    road_metres={}
    for edge,a,b in path:
        e=g['graph']['edges'][edge]
        key=e['canonical']
        road_metres[key]=road_metres.get(key,0)+abs(a-b)*e['length']
    return metres,road_metres
