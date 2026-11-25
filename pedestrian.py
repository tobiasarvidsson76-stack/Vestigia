"""A local metric graph built from pedestrian ways and their real junctions."""
import heapq
import math

RADIUS = 6371008.8
WAYS = {'footway','path','pedestrian','steps','living_street','residential','service',
        'unclassified','track','tertiary','secondary','primary','cycleway'}
BLOCKED = {'no','private','customers','permit','military'}

def distance(a,b):
    return math.hypot(a['x']-b['x'],a['y']-b['y'])

def project(origin,latitude,longitude):
    return dict(x=RADIUS*math.radians(longitude-origin[1])*math.cos(math.radians(origin[0])),
                y=RADIUS*math.radians(origin[0]-latitude))

def unproject(origin,x,y):
    return dict(latitude=origin[0]-math.degrees(y/RADIUS),
                longitude=origin[1]+math.degrees(x/(RADIUS*math.cos(math.radians(origin[0])))))

def allowed(tags):
    foot=tags.get('foot')
    return (tags.get('highway') in WAYS and foot not in BLOCKED and
            tags.get('access') not in BLOCKED and
            (tags.get('highway') not in ('primary','secondary','tertiary') or
             foot in ('yes','designated','permissive') or tags.get('sidewalk') in ('yes','both','left','right')) and
            (tags.get('highway')!='cycleway' or foot in ('yes','designated','permissive')))

def restore_osm_junctions(graph):
    """Restore shared node IDs in graphs imported with layer-specific junctions."""
    changed=False
    for edge in graph['edges'].values():
        for end in ('a','b'):
            node,sep,layer=edge[end].partition('@')
            if sep and node.lstrip('-').isdigit() and layer==edge.get('layer'):
                edge[end]=node
                changed=True
    return changed

def import_elements(data, origin):
    """Accept Overpass JSON containing ways and their referenced nodes."""
    nodes={str(e['id']):e for e in data['elements'] if e['type']=='node'}
    edges={}
    sidewalks={}
    for way in sorted(data['elements'],key=lambda e:e['id']):
        tags=way.get('tags',{})
        if way['type']!='way' or not allowed(tags):
            continue
        layer=tags.get('layer') or ('1' if tags.get('bridge')=='yes' else '-1' if tags.get('tunnel')=='yes' else '0')
        ids=[str(i) for i in way['nodes']]
        for a,b in zip(ids,ids[1:]):
            if a not in nodes or b not in nodes:
                continue
            p,q=(project(origin,nodes[k]['lat'],nodes[k]['lon']) for k in (a,b))
            length=distance(p,q)
            if length<.1:
                continue
            pieces=math.ceil(length/80)
            def split(i):
                if i in (0,pieces):
                    # OSM joins bridge approaches with shared nodes. Ways that
                    # only intersect in projection have distinct node IDs.
                    return a if i==0 else b
                return f"{way['id']}/{a}/{b}/{i}"
            for i in range(pieces):
                mid=lambda n: {k:p[k]+(q[k]-p[k])*n/pieces for k in ('x','y')}
                key=f"{way['id']}/{a}/{b}/{i}"
                edges[key]=dict(a=split(i),b=split(i+1),p=mid(i),q=mid(i+1),length=length/pieces,
                                layer=layer,crossing=tags.get('crossing'),grade=tags.get('incline'),
                                canonical=(f"{tags['vestigia:section']}/{i}" if pieces>1 else tags['vestigia:section'])
                                    if 'vestigia:section' in tags else key)
                street=tags.get('street') or tags.get('addr:street') or tags.get('name')
                if street and tags.get('footway')=='sidewalk' and 'vestigia:section' not in tags:
                    sidewalks.setdefault((street.casefold(),layer),[]).append(key)
    pair_sidewalks(edges,sidewalks)
    return dict(origin=origin,edges=edges)

def pair_sidewalks(edges,sidewalks):
    """Group aligned sidewalk pieces where both carry the same street and layer."""
    for keys in sidewalks.values():
        for index,key in enumerate(keys):
            first=edges[key]
            if first['canonical']!=key:
                continue
            for other_key in keys[index+1:]:
                other=edges[other_key]
                if other['canonical']!=other_key or abs(first['length']-other['length'])>12:
                    continue
                p,q=first['p'],first['q']
                a,b=other['p'],other['q']
                if distance(p,a)+distance(q,b)>distance(p,b)+distance(q,a):
                    a,b=b,a
                if not 2<=distance(p,a)<=22 or not 2<=distance(q,b)<=22:
                    continue
                dx,dy=q['x']-p['x'],q['y']-p['y']
                norm=first['length']*other['length']
                parallel=(dx*(b['x']-a['x'])+dy*(b['y']-a['y']))/norm
                if parallel<.98:
                    continue
                along=abs((a['x']-p['x'])*dx+(a['y']-p['y'])*dy)/first['length']
                if along>8:
                    continue
                common='sidewalk:'+min(key,other_key)
                first['canonical']=other['canonical']=common
                break

def edge_components(graph):
    parents={}
    def root(node):
        parents.setdefault(node,node)
        while parents[node]!=node:
            parents[node]=parents[parents[node]]
            node=parents[node]
        return node
    for edge in graph['edges'].values():
        parents[root(edge['a'])]=root(edge['b'])
    return {key:root(edge['a']) for key,edge in graph['edges'].items()}

def candidates(graph,position,radius=24,excluded=()):
    options=[]
    for key,e in graph['edges'].items():
        if key in excluded:
            continue
        p,q=e['p'],e['q']
        t=max(0,min(1,((position['x']-p['x'])*(q['x']-p['x'])+
            (position['y']-p['y'])*(q['y']-p['y']))/e['length']**2))
        candidate={k:p[k]+(q[k]-p[k])*t for k in ('x','y')}
        gap=distance(candidate,position)
        if gap<=radius:
            options.append(dict(candidate,edge=key,t=t,gap=gap))
    return sorted(options,key=lambda match:(match['gap'],match['edge']))

def snap(graph,position,radius=24,excluded=()):
    return next(iter(candidates(graph,position,radius,excluded)),None)

def route(graph,st,en):
    edges=graph['edges']
    start,end=edges[st['edge']],edges[en['edge']]
    best=(abs(st['t']-en['t'])*start['length'],[(st['edge'],st['t'],en['t'])]) if start is end else None
    adjacency={}
    for k,e in edges.items():
        adjacency.setdefault(e['a'],[]).append((e['b'],k,0,1))
        adjacency.setdefault(e['b'],[]).append((e['a'],k,1,0))
    queue=[]
    for i,k in enumerate(('a','b')):
        heapq.heappush(queue,(abs(i-st['t'])*start['length'],start[k],[(st['edge'],st['t'],i)]))
    visited=set()
    while queue:
        length,node,path=heapq.heappop(queue)
        if node in visited or (best and length>=best[0]):
            continue
        visited.add(node)
        for i,k in enumerate(('a','b')):
            if node==end[k]:
                next_length=length+abs(i-en['t'])*end['length']
                if best is None or next_length<best[0]:
                    best=(next_length,path+[(en['edge'],i,en['t'])])
        for other,key,lo,hi in adjacency[node]:
            if other not in visited:
                heapq.heappush(queue,(length+edges[key]['length'],other,path+[(key,lo,hi)]))
    return best
