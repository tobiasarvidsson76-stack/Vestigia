"""GPS reconciliation against the same inventory and discovery domain as the fixture."""
import math
from pedestrian import candidates, distance, edge_components, project, route, unproject

MAX_GAP = 45
MAX_SPEED = 2.5

# Matches the point-up grid in mobile/hexMap.ts. Coordinates are local metres.
HEX_RADIUS = 39
DISCOVERY_DISTANCE = 10
HEX_X = math.sqrt(3)*HEX_RADIUS/2
HEX_Y = HEX_RADIUS/2
HEX_CORNERS = ((0,-2),(1,-1),(1,1),(0,2),(-1,1),(-1,-1))

def hex_cell(x,y):
    row=y/(3*HEX_Y)
    col=x/(2*HEX_X)-row/2
    third=-col-row
    i,j,k=(math.floor(value+.5) for value in (col,row,third))
    a,b,c=abs(i-col),abs(j-row),abs(k-third)
    if a>b and a>c:
        i=-j-k
    elif b>c:
        j=-i-k
    return i,j

def hex_center(i,j):
    return (2*i+j)*HEX_X,3*j*HEX_Y

def hex_corners(cell):
    cx,cy=hex_center(*cell)
    return [(cx+col*HEX_X,cy+row*HEX_Y) for col,row in HEX_CORNERS]

def neighboring_hexes_within_discovery_range(x,y,cell):
    i,j=cell
    for di,dj in ((1,0),(0,1),(-1,1),(-1,0),(0,-1),(1,-1)):
        neighbor=i+di,j+dj
        corners=hex_corners(neighbor)
        for (px,py),(qx,qy) in zip(corners,corners[1:]+corners[:1]):
            dx,dy=qx-px,qy-py
            t=max(0,min(1,((x-px)*dx+(y-py)*dy)/(dx*dx+dy*dy)))
            if math.hypot(x-px-t*dx,y-py-t*dy)<=DISCOVERY_DISTANCE:
                yield neighbor
                break

def hex_entries(edge, first, last):
    a,b=edge['p'],edge['q']
    def position(t):
        return a['x']+(b['x']-a['x'])*t,a['y']+(b['y']-a['y'])*t
    x,y=position(first)
    u,v=position(last)
    entries=[]
    for j in range(math.ceil((min(y,v)-HEX_RADIUS)/(3*HEX_Y)),
                   math.floor((max(y,v)+HEX_RADIUS)/(3*HEX_Y))+1):
        for i in range(math.ceil((min(x,u)/HEX_X-j-1)/2),
                       math.floor((max(x,u)/HEX_X-j+1)/2)+1):
            corners=hex_corners((i,j))
            lo,hi=0.,1.
            for (px,py),(qx,qy) in zip(corners,corners[1:]+corners[:1]):
                start=(qx-px)*(y-py)-(qy-py)*(x-px)
                end=(qx-px)*(v-py)-(qy-py)*(u-px)
                if start<0 and end<0:
                    break
                if start<0:
                    lo=max(lo,start/(start-end))
                if end<0:
                    hi=min(hi,start/(start-end))
            else:
                if lo<=hi:
                    t=first+(last-first)*(lo+hi)/2
                    ax,ay=position(t)
                    entries.append((lo,(i,j),dict(x=ax,y=ay,t=t)))
    return sorted(entries,key=lambda entry:entry[0])

def cell_neighborhood(cell):
    i,j=cell
    center=hex_center(i,j)
    return {(i+di,j+dj) for di in range(-3,4) for dj in range(-3,4)
            if math.dist(center,hex_center(i+di,j+dj))<=155}

def mapped_anchors(graph,components,root,cell):
    area=cell_neighborhood(cell)
    x,y=hex_center(*cell)
    anchors={}
    for key,edge in graph['edges'].items():
        if components[key]!=root:
            continue
        a,b=edge['p'],edge['q']
        extent=155+HEX_RADIUS
        if (max(a['x'],b['x'])<x-extent or min(a['x'],b['x'])>x+extent or
                max(a['y'],b['y'])<y-extent or min(a['y'],b['y'])>y+extent):
            continue
        for _,mapped,anchor in hex_entries(edge,0,1):
            if mapped not in area or hex_cell(anchor['x'],anchor['y'])!=mapped:
                continue
            existing=anchors.get(mapped)
            if existing is None or math.dist(hex_center(*mapped),(anchor['x'],anchor['y']))<math.dist(
                    hex_center(*mapped),(existing['x'],existing['y'])):
                anchors[mapped]=dict(anchor,edge=key)
    return anchors

def remember_access(g,cell,anchors):
    scanned=g.setdefault('scanned_hex_access',[])
    if list(cell) in scanned:
        return
    scanned.append(list(cell))
    blocked={tuple(item) for item in g.get('blocked_hexes',[])}
    blocked.update(cell_neighborhood(cell)-anchors.keys())
    g['blocked_hexes']=[list(item) for item in sorted(blocked)]

def restore_access(g):
    matched=g.get('matched')
    town=g['tiles'].get(g.get('town_store'))
    if 'blocked_hexes' in g or not matched or not town:
        return
    graph=g['graph']
    components=edge_components(graph)
    root=components[town['edge']]
    if components.get(matched['edge'])==root:
        cell=hex_cell(matched['x'],matched['y'])
        remember_access(g,cell,mapped_anchors(graph,components,root,cell))

def valid_sample(sample,received):
    lat,lon,accuracy,at=(float(sample[key]) for key in ('latitude','longitude','accuracy','at'))
    if all(map(math.isfinite,(lat,lon,accuracy,at))) and (
            -90<=lat<=90 and -180<=lon<=180 and 0<=accuracy<=30 and received-86400<=at<=received+5):
        return lat,lon,accuracy,at

def reconcile_access(g):
    if not g.get('blocked_hexes') or not g.get('town_store'):
        return
    blocked={tuple(cell) for cell in g['blocked_hexes']}
    graph=g['graph']
    components=edge_components(graph)
    root=components[g['tiles'][g['town_store']]['edge']]
    for key,edge in graph['edges'].items():
        if components[key]!=root:
            continue
        for _,cell,anchor in hex_entries(edge,0,1):
            if hex_cell(anchor['x'],anchor['y'])==cell:
                blocked.discard(cell)
    g['blocked_hexes']=[list(cell) for cell in sorted(blocked)]
    g.pop('scanned_hex_access',None)

def apply_samples(g, samples, received, discover):
    if not isinstance(samples,list) or not 1<=len(samples)<=180:
        raise ValueError('Submit 1–180 location samples')
    graph=g['graph']
    if not graph['edges']:
        return
    components=edge_components(graph)
    saved_anchors={}
    for sample in samples:
        validated=valid_sample(sample,received)
        if validated is None:
            continue
        lat,lon,accuracy,at=validated
        previous=g.get('matched')
        last=g.get('presence') or previous
        if last and at<=last['at']:
            continue
        raw=project(graph['origin'],lat,lon)
        cell=hex_cell(raw['x'],raw['y'])
        options=candidates(graph,raw,min(24,max(8,accuracy)))
        nearest=options[0] if options else None
        found=nearest
        path=None
        elapsed=at-previous['at'] if previous else None
        if previous and found and elapsed<=MAX_GAP and distance(previous,found)>=2:
            feasible=[]
            for option in options[:8]:
                result=route(graph,previous,option)
                if result and result[0]<=MAX_SPEED*elapsed:
                    feasible.append((option,result))
            if feasible:
                found,path=min(feasible,key=lambda option:option[0]['gap']+.04*option[1][0])
            else:
                found=None
        walking=g['walking'] and at>=g['walk_started']
        if found:
            sample_fix=dict(found,at=min(received,at))
            if path and path[0]>=2 and walking:
                wear(g,path[1])
                for key,first,last_t in path[1]:
                    if first!=last_t:
                        for _,crossed,anchor in hex_entries(graph['edges'][key],first,last_t):
                            discover(g,dict(anchor,edge=key),crossed)
            elif elapsed is not None and elapsed>MAX_GAP:
                g['road_track']=None
            g['matched']=sample_fix
            g['fix']=dict(x=found['x'],y=found['y'],at=sample_fix['at'])
            if not g['tiles']:
                discover(g,found,hex_cell(found['x'],found['y']))
        else:
            g['road_track']=None
        town=g['tiles'].get(g.get('town_store'))
        if not town:
            continue
        root=components[town['edge']]
        anchor=None
        if nearest is None or components[nearest['edge']]==root:
            if found and components[found['edge']]==root and hex_cell(found['x'],found['y'])==cell:
                anchor=found
            if anchor is None or list(cell) not in g.get('scanned_hex_access',[]):
                if cell not in saved_anchors:
                    saved_anchors[cell]=mapped_anchors(graph,components,root,cell)
                mapped=saved_anchors[cell]
                anchor=anchor or mapped.get(cell)
                if anchor:
                    mapped.setdefault(cell,anchor)
                    remember_access(g,cell,mapped)
            if walking:
                if anchor:
                    discover(g,anchor,cell)
                for neighbor in neighboring_hexes_within_discovery_range(raw['x'],raw['y'],cell):
                    if f'hex:{neighbor[0]},{neighbor[1]}' in g['tiles']:
                        continue
                    if cell not in saved_anchors:
                        saved_anchors[cell]=mapped_anchors(graph,components,root,cell)
                    neighbor_anchor=saved_anchors[cell].get(neighbor)
                    if neighbor_anchor:
                        discover(g,neighbor_anchor,neighbor)
        g['presence']=dict(raw,at=min(received,at),accessible=anchor is not None)

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
        length=abs(a-b)*e['length']
        if length<1e-6:
            continue
        key=e['canonical']
        road_metres[key]=road_metres.get(key,0)+length
    return metres,road_metres
