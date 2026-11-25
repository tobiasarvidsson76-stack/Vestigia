"""Deterministic fixture world and transactional command domain."""
import hashlib
import heapq
import math
import random

import live_world
from pedestrian import distance, route, unproject

from catalog import ANIMALS, CROPS, EXTRACTORS, MINERALS, PRICES, RECIPES, RESOURCE_TECH, SITES, SPEED, STORAGE, SURFACE, TECH, WOODS, matches, quantities

HOMES = {'cottage':(4,1), 'townhouse':(8,2), 'apartment house':(16,4), 'town store':(2,0)}
SCHOOLS = {
    'primary school':(0,2,4,21600),
    'high school':(1,2,4,21600),
    'technical college':(2,2,3,28800),
    'university':(3,4,2,57600),
}
MAX_EDUCATION = len(SCHOOLS)
GRADUATION_RATES = (45,65,65,65)
VISITING_INSTRUCTORS = {'high school':'high_school_fellowship','university':'fellowship'}
SCHOOL_COVERAGE = {
    'primary school':(2,300,24),
    'high school':(3,450,40),
    'technical college':(5,650,64),
    'university':(8,1500,96),
}
RESEARCH = ((0,0),(2,900),(5,2700),(10,7200),(20,14400))
LEARNING_SITES = (*SCHOOLS,'library')
RESEARCH_EDUCATION = ((0,0),(1,6),(2,15),(3,36),(4,72))
RESEARCH_INSTITUTIONS = (None,'primary school','high school','technical college','university')
MARKETPLACES = ('town store','local marketplace','market hall')
HOME_SERVICES = (
    (2,'Marketplace',MARKETPLACES,180),
    (3,'Police station',('police station',),300),
    (4,'Fire station',('fire station',),300),
)
EMERGENCY_SERVICES = ('police station','fire station')
SURVEY = ((3,300),(8,900),(18,1800))
STARTING_SKILL = 40
STARTER_CONSTRUCTION_SECONDS = 180
PRODUCTION_LEASE_SECONDS = 30
OFFLINE_BATCH_LIMIT = 3
TILE_PATH_COST = 4
ROAD_UPGRADE_COSTS = {3:12,4:30}
HAUL_CAPACITY = {0:12,1:12,2:12,3:18,4:24}
SUPPLY_PRICES = {'pine plank':4,'pine log':2}

class RuleError(ValueError):
    pass

def require(condition, message):
    if not condition:
        raise RuleError(message)

def count(stock):
    return sum(lot['qty'] for lot in stock)

def add(stock, good, qty, q):
    stock.append(dict(good=good,qty=qty,q=q))

def take(stock, good, qty, floor=0, highest=False, exact=None):
    candidates = [lot for lot in stock if matches(good,lot['good']) and lot['q']>=floor and (exact is None or lot['q']==exact)]
    if highest:
        candidates.sort(key=lambda lot:-lot['q'])
    require(count(candidates)>=qty, f'Need {qty} {good} at Q{floor}+')
    moved = []
    for lot in candidates:
        amount = min(qty,lot['qty'])
        if amount:
            add(moved,lot['good'],amount,lot['q'])
            if lot.get('xp'):
                moved[-1]['xp']=True
            lot['qty'] -= amount
            qty -= amount
    stock[:] = [lot for lot in stock if lot['qty']]
    return moved

def make_site(tile, kind, cost, now):
    return dict(id=tile['id'],kind=kind,built=False,cost=cost,level=1,
                input=[],output=[],shared=[],materials=[],upgrade=[],conversion=[],pantry=[],wear={},history=[],
                since=now,tax=0,tax_at=now,skill=STARTING_SKILL,batches=0,worker=None,recipe=None,
                choices=[],batch=None,crop=None,course=None,visiting=False)

def point(i,j):
    return f'{i},{j}'

def world_tile(g,i,j,opportunity=True,key=None):
    key = key or point(i,j)
    rng = random.Random(int.from_bytes(hashlib.sha256(f"{g['seed']}/{key}".encode()).digest()[:8]))
    rank = g.get('opportunities',len(g['tiles']))
    grade_roll = rng.random()
    band = (35,64) if grade_roll<.6 else (65,84) if grade_roll<.9 else (85,100)
    grade = rng.randint(*band)
    soil = rng.choice(['loam','sandy','heavy'])
    assigned = {1:'pine',3:'stone',4:'clay'}
    g['tiles'][key] = tile = dict(id=key,x=i*60,y=j*60,grade=grade,soil=soil,
        resource=assigned.get(rank,'land') if opportunity else 'land',truth=None,difficulty=None,report=None,survey=None)
    g['opportunities']=rank+int(opportunity)
    if not opportunity:
        return tile
    if 5<=rank<=48 and (rank-5)%7==0 and (rank-5)//7<len(MINERALS[:5]):
        tile.update(resource='prospect',truth=MINERALS[(rank-5)//7],difficulty=3 if rank==5 else rng.choices([1,2,3],[50,35,15])[0])
    elif rank>=49:
        # Leave every third late discovery outside the resource schedule.
        late_rank=rank-49
        offset=late_rank-late_rank//3
        group=offset%24 if late_rank%3!=2 else -1
        schedules=(
            ((0,6,12,18),SURFACE[2:9],False),
            ((1,7,13,19),MINERALS[5:16],True),
            ((2,10,16),SURFACE[9:],False),
            ((3,11,17),MINERALS[16:],True),
            ((4,8,14,20),WOODS[1:],False),
        )
        for slots,materials,hidden in schedules:
            if group not in slots:
                continue
            index=(offset//24)*len(slots)+slots.index(group)
            bag=list(materials)
            random.Random(f"{g['seed']}/{materials[0]}/{index//len(bag)}").shuffle(bag)
            material=bag[index%len(bag)]
            if hidden:
                tile.update(resource='prospect',truth=material,difficulty=rng.choices([1,2,3],[50,35,15])[0])
            else:
                tile['resource']=material
            break
        else:
            if group in (5,15):
                tile.update(resource='prospect')
            elif group in (9,21):
                tile['resource']=rng.choice(['land','stone','clay'])
    elif rank>4 and rank%7==3:
        tile.update(resource='prospect')
    elif rank>4 and rank%7==6:
        index=(rank-6)//7
        woods=list(WOODS[1:])
        random.Random(f"{g['seed']}/early woods/{index//4}").shuffle(woods)
        tile['resource']=woods[index%4]
    elif rank>4 and rank%7==0:
        tile['resource']=rng.choice(['land','stone','clay'])
    if tile['resource']=='land' and rank>=8 and (rank-8)%19==0:
        tile['resource']='pond'
    return tile

def new_game(seed, now, graph=None):
    g = dict(seed=seed,now=now,coins=30,xp=0,cargo=[],tiles={},sites={},citizens=[],
             technologies=['Settlement basics'],research=None,walking=False,walk_started=None,
             fix=None,road_track=None,roads={},jobs=[],vouchers=0,receipts=[],grants=[],
             orders={},truck_kit=False)
    if graph is not None:
        g['graph']=graph
    else:
        begin_city(g,world_tile(g,0,0))
    return g

def begin_city(g,tile):
    tile['resource']='land'
    g['town_store']=tile['id']
    g['sites'][tile['id']]=home=make_site(tile,'town store',[],g['now'])
    home['built']=True
    resident(g,home,0)
    resident(g,home,2)

def discover_live(g,fix,cell):
    i,j=cell
    key=f'hex:{i},{j}'
    sites=g['tiles']
    if key in sites or any(live_world.hex_cell(tile['x'],tile['y'])==cell
                           for old,tile in sites.items() if not old.startswith('hex:')):
        return
    if sites and not route(g['graph'],sites[g['town_store']],fix):
        return
    edges=g.setdefault('explored_edges',[])
    opportunity=fix['edge'] not in edges
    if opportunity:
        edges.append(fix['edge'])
    tile=world_tile(g,i,j,opportunity=opportunity,key=key)
    tile.update({k:fix[k] for k in ('x','y','edge','t')})
    tile['map_x'],tile['map_y']=live_world.hex_center(i,j)
    if len(g['tiles'])==1:
        begin_city(g,tile)
    else:
        g['xp']+=2

def resident(g,home,education):
    n=len(g['citizens'])
    g['citizens'].append(dict(id=n,home=home['id'],education=education,assignment=None))

def education(g):
    return 100*sum(c['education'] for c in g['citizens'])/(MAX_EDUCATION*max(1,len(g['citizens'])))

def research_requirements(g):
    built={kind:0 for kind in LEARNING_SITES}
    for site in g['sites'].values():
        if site['built'] and site['kind'] in built:
            built[site['kind']]+=1
    total=sum(built.values())
    requirements=[[]]
    for tier,(level,count) in enumerate(RESEARCH_EDUCATION[1:],1):
        institution=RESEARCH_INSTITUTIONS[tier]
        rows=[
            dict(label='Learning buildings',actual=total,required=tier),
            dict(label=f'Residents with education {level}+',required=count,
                 actual=sum(citizen['education']>=level for citizen in g['citizens'])),
        ]
        if institution:
            rows.append(dict(label=institution.capitalize(),actual=built[institution],required=1))
        requirements.append(rows)
    return requirements

def service_distance(g,source,destination,radius):
    origin,tile=(g['tiles'][key] for key in (source,destination))
    if distance(origin,tile)>radius:
        return None
    graph=g.get('graph')
    if graph is None:
        metres=abs(origin['x']-tile['x'])+abs(origin['y']-tile['y'])
    elif origin.get('edge') in graph['edges'] and tile.get('edge') in graph['edges']:
        path=route(graph,origin,tile)
        metres=path[0] if path else math.inf
    else:
        return None
    return metres if metres<=radius else None

def school_allocations(g,kind,converted=None):
    level,radius,base_capacity=SCHOOL_COVERAGE[kind]
    limits={s['id']:int(base_capacity*SPEED[s['level']-1])
            for s in g['sites'].values() if s['built'] and s['kind']==kind}
    used=dict.fromkeys(limits,0)
    nearby_sites=set()
    covered=set()
    if not limits:
        return covered,nearby_sites,{}
    applicants=sorted((s for s in g['sites'].values() if s['built'] and s['level']+1>=level
                       and (s['kind'] in HOMES and s['kind']!='town store' or s['kind'] in EMERGENCY_SERVICES)),
                      key=lambda s:(-s['level'],s['id']))
    for site in applicants:
        key=site['id']
        if key==converted:
            demand=home_places({**site,'kind':CONVERSIONS[site['kind']][0]})
        else:
            demand=home_places(site,min(10,site['level']+1)) if site['kind'] in HOMES else 1
        options=[]
        for school in limits:
            metres=service_distance(g,key,school,radius)
            if metres is not None:
                nearby_sites.add(key)
                if limits[school]-used[school]>=demand:
                    options.append((metres,school))
        if options:
            school=min(options)[1]
            used[school]+=demand
            covered.add(key)
    return covered,nearby_sites,{key:dict(used=used[key],capacity=limit) for key,limit in limits.items()}

def service_coverage(g,s,schools=None,converted=None):
    kind=s['kind']
    housing=kind in HOMES and kind!='town store'
    if not housing and kind not in EMERGENCY_SERVICES:
        return []
    target=min(10,s['level']+1)
    coverage=[dict(label=label,radius=radius,covered=any(
        provider['built'] and provider['kind'] in kinds
        and service_distance(g,s['id'],provider['id'],radius) is not None
        for provider in g['sites'].values())) for level,label,kinds,radius in HOME_SERVICES
        if housing and level<=target]
    for school,(level,radius,_) in SCHOOL_COVERAGE.items():
        if level<=target:
            covered,nearby_sites,_=schools[school] if schools is not None else school_allocations(g,school,converted)
            coverage.append(dict(label=school.capitalize(),radius=radius,covered=s['id'] in covered,
                                 at_capacity=s['id'] in nearby_sites and s['id'] not in covered))
    return coverage

def require_services(g,s,converted=None):
    missing=[f"{row['label']} capacity" if row.get('at_capacity') else f"{row['label']} within {row['radius']} m"
             for row in service_coverage(g,s,converted=converted) if not row['covered']]
    require(not missing,'Nearby services needed: '+', '.join(missing))

def capacity(g):
    return min(40,1+g['xp']//100)+int(g['truck_kit'])

def home_places(s,level=None):
    return math.floor(HOMES[s['kind']][0]*SPEED[(level or s['level'])-1]) if s['kind']!='town store' else 2

def cap(s, buffer):
    scale = STORAGE[s['level']-1]
    if buffer=='pantry':
        return max(40,10*home_places(s))
    if buffer=='shared':
        return math.floor(SITES[s['kind']]['shared']*scale)
    return math.floor(12*scale)

def reserve(g,s,buffer):
    return sum(count(j['lots']) for j in g['jobs'] if not j['done'] and j['dst']==s['id'] and j['buffer']==buffer)

def staffing_requirement(site):
    kind=site['kind']
    return SCHOOLS[kind][1] if kind in SCHOOLS else SITES.get(kind,{}).get('credential')

def staffing_priority(site):
    return site.get('staff_priority',1)

def fill_jobs(g):
    positions=[]
    for site in g['sites'].values():
        credential=staffing_requirement(site)
        if site['built'] and not site.get('visiting') and credential is not None:
            positions.append((credential,site))
    if all(site['worker'] is not None for _,site in positions):
        return
    current={site['worker'] for _,site in positions if site['worker'] is not None}
    held={site['worker'] for site in g['sites'].values() if site['worker'] is not None}-current
    available={c['id']:c['education'] for c in g['citizens']
               if c['id'] not in held and (c['assignment'] is None or (
                   c['assignment'][0]=='work' and c['id'] in current))}
    pools=[[] for _ in range(MAX_EDUCATION+1)]
    for worker,education_level in available.items():
        heapq.heappush(pools[education_level],worker)
    assignments=[]
    previous_score=[0,0,0]
    next_score=[0,0,0]
    for credential,site in sorted(positions,key=lambda entry:(-staffing_priority(entry[1]),-entry[0],entry[1]['id'])):
        priority=staffing_priority(site)
        incumbent=site['worker']
        previous_score[2-priority]+=incumbent is not None
        for education_level in range(credential,MAX_EDUCATION+1):
            pool=pools[education_level]
            while pool and pool[0] not in available:
                heapq.heappop(pool)
            if not pool:
                continue
            worker=incumbent if available.get(incumbent)==education_level else heapq.heappop(pool)
            del available[worker]
            assignments.append((site,worker,credential))
            next_score[2-priority]+=1
            break
    if next_score<=previous_score:
        return
    target={site['id']:worker for site,worker,_ in assignments}
    for credential,site in positions:
        if site['worker'] is not None and site['worker']!=target.get(site['id']):
            staff(g,site,None,credential)
    for site,worker,credential in assignments:
        if site['worker']!=worker:
            staff(g,site,worker,credential)

def rounded_quality(g,local):
    return min(100,max(0,math.floor(.9*local+.1*education(g)+.5)))

def selected_inputs(r,choices):
    return [(q,choices[idx] if idx<len(choices) else names[0]) for idx,(q,names) in enumerate(r['inputs'])]

def set_production_presence(g,active):
    if 'graph' not in g:
        return
    g['production_inactive']=not active
    if active:
        g['production_active_until']=g['now']+PRODUCTION_LEASE_SECONDS
        for site in g['sites'].values():
            begin_batch(g,site)

def begin_batch(g,s):
    lease=g.get('production_active_until',0)
    offline='graph' in g and (g.get('production_inactive') or g['now']>=lease)
    usage=s.get('offline_batches',{})
    used=usage.get('count',0) if usage.get('lease')==lease else 0
    if offline and (not lease or used>=OFFLINE_BATCH_LIMIT):
        return
    if not s['built'] or s['worker'] is None or s['batch'] or not s['recipe']:
        return
    r=RECIPES[s['recipe']]
    if r['tech'] not in g['technologies']:
        return
    if count(s['output'])+sum(q for q,_ in r['outputs'])>cap(s,'output'):
        return
    stock=[lot.copy() for lot in s['input']]
    lots=[]
    try:
        for index,(q,good) in enumerate(selected_inputs(r,s['choices'])):
            floors=s.get('floors',[])
            floor=floors[index] if index<len(floors) else s.get('minimum',0)
            lots.extend(take(stock,good,q,floor,s.get('highest',False)))
    except RuleError:
        return
    skill=s['skill']
    if lots:
        mean=sum(l['qty']*l['q'] for l in lots)/count(lots)
        if r['outputs'][0][1]=='survey scopes':
            mean=sum(l['q']*(.7 if l['good']=='optical glass' else .3) for l in lots)
        weight=.4 if s['kind'] in ('instrument maker','machine works') else .55 if s['kind'] in (
            'foundry','alloy works','glassworks','workshop','print shop','jeweller') else .7
    else:
        mean=g['tiles'][s['id']]['grade']
        weight=.85
    s['input']=stock
    if offline:
        s['offline_batches']=dict(lease=lease,count=used+1)
    duration=r['seconds']/SPEED[s['level']-1]
    s['batch']=dict(at=g['now']+duration,duration=duration,recipe=s['recipe'],
                     q=rounded_quality(g,weight*mean+(1-weight)*skill),remaining=None)

def practice(s):
    s['batches']+=1
    if s['batches']%5==0:
        s['skill']=min(100,s['skill']+1)

NEEDS = dict(nutrition=1,clothing=.1,essentials=.1,comfort=.05,leisure=.025)
WEIGHTS = dict(nutrition=40,clothing=20,essentials=15,comfort=15,leisure=10)
FOOD = {}
for family,entries in {
    'grains':('bread','dark bread','porridge','cherry pies','flatbreads','rice bowls','saffron rice','noodles','almond cakes'),
    'vegetables':('potatoes','carrots','cabbage','turnips','tomatoes','onions','cucumbers','leeks','spinach','beetroot','garlic','pickles','mushrooms'),
    'pulses/nuts':('beans','peas','lentils','chickpeas','peanuts','almonds','walnuts','soup','falafel','tahini','peanut butter'),
    'fruit':('strawberries','apples','pears','plums','cherries','grapes','peaches','lemons','figs','blackberries','berries','jam','marmalade','dried fruit'),
    'dairy':('cow milk','goat milk','buffalo milk','goat cheese','mozzarella'),
    'eggs':('eggs',),'meat':('pork','cured pork'),'fish':('trout','smoked fish'),
}.items():
    for good in entries:
        FOOD[good]=('nutrition',family,2 if good in ('dark bread','porridge','cherry pies','flatbreads',
            'rice bowls','saffron rice','noodles','almond cakes','pickles','soup','falafel','jam','marmalade',
            'dried fruit','goat cheese','mozzarella','cured pork','smoked fish') else 1)
CONSUMERS=FOOD.copy()
for category,goods in {
    'clothing':{'shirts':1,'boots':1,'coats':2,'linen':.5,'cotton cloth':.5,'wool cloth':.5},
    'essentials':{'scented soap':1,'candles':1,'baskets':1,'crockery':1,'cutlery sets':2},
    'comfort':{'quilts':2,'chairs':2,'beds':2,'polished cabinets':3},
    'leisure':{'finished tea':1,'roasted coffee':1,'books':1,'cider':1,'clocks':3,'jewellery':3,'diamond':3},
}.items():
    CONSUMERS.update({good:(category,category,value) for good,value in goods.items()})
THRESHOLDS = [
    (.8,2,.25,0,0,37),(.85,2,.4,0,0,44),(.85,2,.5,.2,0,50),(.9,3,.55,.3,0,56),
    (.9,3,.6,.4,.1,62),(.9,3,.65,.5,.15,67),(.95,3,.7,.6,.25,73),
    (.95,4,.75,.65,.35,79),(.95,4,.8,.7,.45,85),
]

def consume(g,s):
    occupants=sum(c['home']==s['id'] for c in g['citizens'])
    demand={k:v*occupants/24 for k,v in NEEDS.items()}
    earned={k:0. for k in NEEDS}
    families={}
    for category,needed in demand.items():
        while needed>1e-12:
            options=list(dict.fromkeys([k for k,v in s['wear'].items() if v>1e-12 and
                (k==category or category=='nutrition' and k in {x[1] for x in FOOD.values()})]+[
                CONSUMERS[l['good']][1] for l in s['pantry'] if CONSUMERS[l['good']][0]==category]))
            if not options:
                break
            family=next((x for x in options if x!=s.get('last_food')),options[0]) if category=='nutrition' else options[0]
            if s['wear'].get(family,0)<=1e-12:
                lot=next(l for l in s['pantry'] if CONSUMERS[l['good']][1]==family)
                _,_,uses=CONSUMERS[lot['good']]
                s['wear'][family]=uses if category=='nutrition' else uses*(.75+lot['q']/200)
                lot['qty']-=1
                if not lot['qty']:
                    s['pantry'].remove(lot)
            used=min(needed,s['wear'][family])
            needed-=used
            s['wear'][family]-=used
            earned[category]+=used
            if category=='nutrition':
                families[family]=families.get(family,0)+used
                s['last_food']=family
    s['history']=(s['history']+[[g['now'],demand,earned,families]])[-24:]

def household(g,s,target=None):
    history=[r for r in s['history'] if r[0]>g['now']-86400 and r[0]>s['since']]
    demand={k:sum(r[1][k] for r in history) for k in NEEDS}
    coverage={k:min(1,sum(r[2][k] for r in history)/v) if v else 0 for k,v in demand.items()}
    families={family for _,family,_ in FOOD.values() if demand['nutrition'] and
              sum(r[3].get(family,0) for r in history)>=.15*demand['nutrition']-1e-12}
    score=sum(WEIGHTS[k]*v for k,v in coverage.items())
    n,f,c,e,t,minimum=THRESHOLDS[min(10,target or s['level']+1)-2]
    ready=len(history)>=24 and len(families)>=f and score+1e-12>=minimum and all(
        coverage[k]+1e-12>=v for k,v in zip(NEEDS,(n,c,e,t)))
    return dict(coverage=coverage,families=sorted(families),score=score,ready=ready,hours=len(history),
                minimums=dict(nutrition=n,families=f,clothing=c,essentials=e,comfort=t,score=minimum))

def passes_course(g,citizen,level):
    digest=hashlib.sha256(f"{g['seed']}/education/{citizen['id']}/{level}".encode()).digest()
    return int.from_bytes(digest[:2],'big')*100 < GRADUATION_RATES[level]*65536

def complete_course(g,s):
    course=s['course']
    level=SCHOOLS[s['kind']][0]
    graduated=0
    for identifier in course['students']:
        citizen=g['citizens'][identifier]
        citizen['assignment']=None
        if not course.get('selective') or passes_course(g,citizen,level):
            citizen['education']=level+1
            graduated+=1
        else:
            citizen['education_limit']=level
    s['last_class']=dict(graduated=graduated,failed=len(course['students'])-graduated)
    if graduated and s['visiting']:
        s['visiting']=False
    s['course']=None

def appoint_visiting_instructors(g):
    for school,fellowship in VISITING_INSTRUCTORS.items():
        if g.get(fellowship):
            continue
        campus=next((s for s in g['sites'].values()
                     if s['kind']==school and s['built'] and s['worker'] is None),None)
        if campus:
            campus['visiting']=True
            g[fellowship]=True

def advance(g, until):
    require(until>=g['now'],'Clock cannot go backwards')
    restore_center_terrain(g)
    if 'graph' in g:
        live_world.restore_access(g)
    fill_jobs(g)
    appoint_visiting_instructors(g)
    for site in g['sites'].values():
        begin_batch(g,site)
    for s in g['sites'].values():
        if s['kind'] in HOMES and s['tax']:
            g['coins']+=s['tax']
            s['tax']=0
    while True:
        times=[]
        if g['research']:
            times.append(g['research']['at'])
        times.extend(t['survey']['at'] for t in g['tiles'].values() if t['survey'])
        times.extend(j['at'] for j in g['jobs'] if not j['done'])
        for s in g['sites'].values():
            for key in ('batch','course','construction'):
                task=s.get(key)
                if task and task['at'] is not None:
                    times.append(task['at'])
            if s['built'] and s['kind'] in HOMES:
                times.append(s['tax_at']+3600)
        if not times or min(times)>until:
            g['now']=until
            return
        g['now']=now=min(times)
        project=g['research']
        if project and project['at']==now:
            g['technologies'].append(project['name'])
            g['research']=None
        for tile in g['tiles'].values():
            survey=tile['survey']
            if survey and survey['at']==now:
                found=tile['truth'] if survey['tier']>=(tile['difficulty'] or 4) else None
                tile['report']=dict(tier=survey['tier'],mineral=found,
                                    message=found or 'Resources could not be found')
                tile['survey']=None
        for j in g['jobs']:
            if not j['done'] and j['at']==now:
                g['sites'][j['dst']][j['buffer']].extend(j['lots'])
                j['done']=True
        for s in g['sites'].values():
            if s.get('construction') and s['construction']['at']==now:
                complete_construction(g,s)
        for s in g['sites'].values():
            course=s['course']
            if course and course['at']==now:
                complete_course(g,s)
            if s['built'] and s['kind'] in HOMES and s['tax_at']+3600==now:
                _,rate=HOMES[s['kind']]
                g['coins']+=rate*SPEED[s['level']-1]
                s['tax_at']=now
                consume(g,s)
        for s in g['sites'].values():
            batch=s['batch']
            if batch and batch['at']==now:
                for q,good in RECIPES[batch['recipe']]['outputs']:
                    add(s['output'],good,q,batch['q'])
                if s['kind']=='apiary':
                    s['pollinated']=now
                    for other in g['sites'].values():
                        crop=other['crop']
                        if crop and other['kind']=='orchard' and now<=crop['at'] and math.dist(
                            (g['tiles'][s['id']]['x'],g['tiles'][s['id']]['y']),
                            (g['tiles'][other['id']]['x'],g['tiles'][other['id']]['y']))<=120:
                            crop['pollinated']=True
                practice(s)
                s['batch']=None
        fill_jobs(g)
        for s in g['sites'].values():
            begin_batch(g,s)

def construction_duration(kind,cost):
    if not cost:
        return STARTER_CONSTRUCTION_SECONDS
    basic={'plank','stone','clay','sand','gravel','rope'}
    worked={'bricks','mortar','fittings','iron bar','glass','brass','paper'}
    minutes=2+2*(len(cost)-1)+3*(staffing_requirement({'kind':kind}) or 0)
    for qty,goods in cost:
        minutes+=qty*max(2 if good in basic else 3 if good in worked else 4 for good in goods)
    return minutes*60

def complete_construction(g,s):
    project=s.pop('construction')
    kind=s['kind']
    tile=g['tiles'][s['id']]
    s.update(built=True,since=g['now'],tax_at=g['now'])
    if not project['rebuilding']:
        g['xp']+=5
    if kind in HOMES:
        for _ in range(home_places(s)):
            resident(g,s,0)
    if kind in VISITING_INSTRUCTORS:
        fill_jobs(g)
        appoint_visiting_instructors(g)
    options=recipe_options(s,tile)
    if options and kind not in ('paddock','apiary','fish pond'):
        s['recipe']=options[0]
    if project['starter'] and not project['rebuilding'] and kind=='lumberjack station':
        add(s['output'],tile['resource']+' log',1,rounded_quality(g,.85*tile['grade']+.15*s['skill']))

def unlock_cost(g,kind,rope=False):
    if kind in ('lumberjack station','sawmill') and (kind not in g['grants'] or kind in g.get('starter_rebuilds',[])):
        return []
    if kind=='warehouse' and rope:
        return quantities('6 plank + 4 rope')
    return SITES[kind]['cost']

def eligible(tile,kind):
    t=tile['resource']
    if t=='pond' or kind=='fish pond':
        return t=='pond' and kind=='fish pond'
    if kind=='lumberjack station':
        return t in WOODS
    if kind=='mine':
        return bool(tile['report'] and tile['report']['mineral'])
    if kind in EXTRACTORS.values():
        return EXTRACTORS.get(t)==kind
    if kind=='field':
        return t=='land'
    return True

def nearby(g,tile):
    if 'graph' in g:
        presence=g.get('presence')
        if presence and 0<=g['now']-presence['at']<=60:
            if not presence['accessible']:
                return False
            if tile.get('id') in g['tiles'] and tile_cell(tile,True)==live_world.hex_cell(presence['x'],presence['y']):
                return True
    fix=g['fix']
    if not fix or not 0<=g['now']-fix['at']<=60 or distance(fix,tile)>40:
        return False
    if 'graph' in g and 'edge' in tile:
        path=route(g['graph'],g['matched'],tile)
        return bool(path and path[0]<=40)
    return True

def fix_position(g,a):
    x,y=float(a['x']),float(a['y'])
    accuracy=float(a.get('accuracy',5))
    require(math.isfinite(x) and math.isfinite(y) and max(abs(x),abs(y))<=60000,'Position outside fixture')
    require(0<=accuracy<=30,'GPS accuracy must be 30 m or better')
    require(min(abs(y-round(y/60)*60),abs(x-round(x/60)*60))<=8,
            'Position must be on a fixture pedestrian street')
    prior=g['fix']
    now=g['now']
    if prior:
        distance=math.dist((x,y),(prior['x'],prior['y']))
        gap=now-prior['at']
        horizontal=(round(y/60)==round(prior['y']/60) and
                    abs(y-round(y/60)*60)<=8 and abs(prior['y']-round(y/60)*60)<=8)
        vertical=(round(x/60)==round(prior['x']/60) and
                  abs(x-round(x/60)*60)<=8 and abs(prior['x']-round(x/60)*60)<=8)
        connected=horizontal or vertical
        valid=0<gap<=45 and 2<=distance<=2.5*gap and connected
        if g['walking'] and valid:
            i,j=round(x/60),round(y/60)
            key=point(i,j)
            if key not in g['tiles']:
                world_tile(g,i,j)
                g['xp']+=2
            if horizontal and abs(x-prior['x'])>=abs(y-prior['y']):
                update_road(g,prior['x'],x,j)
            elif vertical:
                update_road(g,prior['y'],y,i,vertical=True)
        elif distance>=2:
            g['road_track']=None
            if 0<=gap<=45:
                require(distance<=2.5*gap and connected,'Movement is too fast or crosses an inaccessible gap')
    g['fix']=dict(x=x,y=y,at=now)

def update_road(g,old,new,row,vertical=False):
    direction=1 if new>old else -1
    boundary=old
    while abs(boundary-new)>1e-9:
        index=math.floor((boundary if direction>0 else boundary-1e-9)/60)
        end=min(new,(index+1)*60) if direction>0 else max(new,index*60)
        key=point(row,index)+':v' if vertical else point(index,row)
        track=g['road_track']
        if not track or track['id']!=key or track['direction']!=direction:
            track=g['road_track']=dict(id=key,direction=direction,start=boundary,credited=False)
        if abs(end-track['start'])>=42 and not track['credited']:
            road=g['roads'].setdefault(key,dict(passages=0,paid=0))
            road['passages']+=1
            track['credited']=True
        if end in (index*60,(index+1)*60):
            g['road_track']=None
        boundary=end

def road_anchor(key):
    vertical=key.endswith(':v')
    x,y=map(int,key.removesuffix(':v').split(','))
    return dict(x=x*60+(0 if vertical else 30),y=y*60+(30 if vertical else 0))

def road_tier(road):
    return max(road['paid'],sum(road['passages']>=n for n in (1,3)))

def upgrade_cost(s):
    level=s['level']+1
    raw=f'{2*level} plank + {level} stone'
    if level>=4:
        raw+=f" + {level} {s.get('upgrade_stonework','bricks')}"
    if level>=7:
        raw+=f' + {level} iron bars'
    if level>=9:
        raw+=f' + {level} tools'
    return quantities(raw)

def meets(stock,cost):
    copy=[l.copy() for l in stock]
    try:
        for qty,alternatives in cost:
            take(copy,alternatives[0],qty)
    except RuleError:
        return False
    return True

def crop_metrics(g,skill,soil_match,compost_quality=None):
    suitability=80 if soil_match else 55
    land=min(100,suitability+(compost_quality or 0)*.1)
    return dict(suitability=suitability,qty=(4 if soil_match else 2)+2*(compost_quality is not None),
                q=rounded_quality(g,.75*land+.25*skill))

def crop_forecast(g,skill,compost_quality):
    forecast={}
    for label,soil_match in (('match',True),('mismatch',False)):
        metrics=crop_metrics(g,skill,soil_match)
        if compost_quality is not None:
            metrics['with_compost']=crop_metrics(g,skill,soil_match,compost_quality)
        forecast[label]=metrics
    return forecast

def planting(g,s,name,compost):
    definition=CROPS[name]
    require(s['worker'] is not None,'Assign a farmer first')
    require(definition['tech'] in g['technologies'],'Research '+definition['tech'])
    soil=g['tiles'][s['id']]['soil']==definition['soil']
    fertilizer=take(g['cargo'],'compost',1)[0]['q'] if compost else None
    metrics=crop_metrics(g,s['skill'],soil,fertilizer)
    duration=definition['seconds']/SPEED[s['level']-1]
    return dict(name=name,at=g['now']+duration,duration=duration,pollinated=False,
                qty=metrics['qty'],q=metrics['q'])

def plant_yield(crop):
    return crop['qty']+int(crop['pollinated'] and crop['name'] not in ('tea','coffee','olives'))

def recipe_options(s,tile):
    if not s['built'] and s['kind']=='mine' and not tile['report']:
        return []
    options=[k for k,r in RECIPES.items() if r['site']==s['kind']]
    if s['kind']=='lumberjack station':
        return [k for k in options if RECIPES[k]['outputs'][0][1]==tile['resource']+' log']
    if s['kind']=='mine':
        return [k for k in options if RECIPES[k]['outputs'][0][1]==tile['report']['mineral']]
    if s['kind'] in EXTRACTORS.values():
        return [k for k in options if RECIPES[k]['outputs'][0][1]==tile['resource']]
    return options

CONVERSIONS={'cottage':('townhouse','4 bricks + 2 mortar + 2 glass + 2 chairs'),
             'townhouse':('apartment house','4 steel + 4 plaster + 2 beds + 2 tools')}

def conversion_cost(s):
    return quantities(CONVERSIONS[s['kind']][1].replace('2 chairs','2 polished cabinets')
                      if s.get('cabinets') else CONVERSIONS[s['kind']][1])

def destination(g,s,buffer,good,qty):
    if buffer in ('materials','upgrade','conversion'):
        require(buffer!='conversion' or s['built'] and s['kind'] in CONVERSIONS,'No conversion available')
        cost=s['cost'] if buffer=='materials' else conversion_cost(s) if buffer=='conversion' else upgrade_cost(s)
        require((not s['built'] and not s.get('construction') if buffer=='materials' else s['built'] and not s.get('reclaim') and (buffer=='conversion' or s['level']<10)),'No eligible project')
        wanted=sum(q for q,names in cost if any(matches(n,good) for n in names))
        used=sum(l['qty'] for l in s[buffer] if any(matches(n,l['good']) for q,names in cost
                 for n in names if matches(n,good)))
        pending=sum(l['qty'] for j in g['jobs'] if not j['done'] and j['dst']==s['id'] and j['buffer']==buffer
                    for l in j['lots'] if any(matches(n,l['good']) for _,names in cost for n in names if matches(n,good)))
        require(wanted>=used+qty+pending,'Project does not need that quantity')
        return
    require(s['built'],'Finish construction first')
    if buffer=='pantry':
        require(s['kind'] in HOMES and good in CONSUMERS,'Household cannot consume this item')
    elif buffer=='shared':
        require(s['kind'] in SITES and SITES[s['kind']]['shared']>0 and not s.get('reclaim'),'No shared storage')
    elif buffer=='input':
        if s['kind'] in SCHOOLS:
            require(good=='writing slates' and s['kind']=='primary school','School accepts writing slates')
        else:
            require(s['recipe'] and any(matches(n,good) for _,n in selected_inputs(
                RECIPES[s['recipe']],s['choices'])),'Good is outside the active recipe')
    else:
        raise RuleError('Invalid delivery buffer')
    require(count(s[buffer])+reserve(g,s,buffer)+qty<=cap(s,buffer),'Destination is full')

def pay(g,fee):
    require(g['coins']>=fee,'Insufficient coins')
    g['coins']-=fee

def quote(g,source,dest):
    a,b=g['tiles'][source],g['tiles'][dest]
    if 'graph' in g:
        metres,sections=live_world.path_quote(g,a,b)
        levels={key:road_tier(g['roads'][key]) if key in g['roads'] else 0 for key in sections}
        paved=sum(m for key,m in sections.items() if levels[key]==4)
        return dict(metres=math.ceil(metres),fee=2+math.ceil((metres-.25*paved)/250),
                    seconds=120+60*math.ceil(metres/200),capacity=HAUL_CAPACITY[min(levels.values(),default=0)])
    metres=abs(a['x']-b['x'])+abs(a['y']-b['y'])
    require(metres>0,'Choose different sites')
    row=int(a['y']/60)
    low,high=sorted([int(a['x']/60),int(b['x']/60)])
    lo_y,hi_y=sorted([int(a['y']/60),int(b['y']/60)])
    column=int(b['x']/60)
    sections=[point(i,row) for i in range(low,high)]+[point(column,j)+':v' for j in range(lo_y,hi_y)]
    levels=[road_tier(g['roads'][key]) if key in g['roads'] else 0 for key in sections]
    paved=60*levels.count(4)
    return dict(metres=metres,fee=2+math.ceil((metres-.25*paved)/250),seconds=120+60*math.ceil(metres/200),
                capacity=HAUL_CAPACITY[min(levels,default=0)])

def planning_route(g,key):
    tile=g['tiles'].get(key)
    require(tile is not None,'Select a revealed tile')
    start=g.get('matched') or g['tiles'].get(g.get('town_store'))
    require(start is not None,'Locate the city first')
    if 'graph' not in g:
        start=g['fix'] or start
        return dict(metres=round(abs(start['x']-tile['x'])+abs(start['y']-tile['y'])),line=[])
    graph=g['graph']
    found=route(graph,start,tile)
    require(found is not None,'No connected pedestrian route to this tile')
    metres,legs=found
    points=[unproject(graph['origin'],start['x'],start['y'])]
    for edge,lo,hi in legs:
        if lo==hi:
            continue
        p,q=(graph['edges'][edge][name] for name in ('p','q'))
        tail={k:p[k]+(q[k]-p[k])*hi for k in ('x','y')}
        points.append(unproject(graph['origin'],**tail))
    return dict(metres=math.ceil(metres),line=points)

def positive(a,key='qty',maximum=1200):
    n=a.get(key)
    require(type(n) is int and 1<=n<=maximum,f'{key} must be an integer from 1 to {maximum}')
    return n

EXPORT_TIERS = ((8,16,40,1.25),(4,8,65,1.75),(2,5,80,2.5))

def producible(g):
    goods=set()
    sites=[s for s in g['sites'].values() if s['built']]
    for tile in g['tiles'].values():
        source=tile['resource']
        if source in WOODS:
            goods.add(source+' log')
        elif source in SURFACE and RESOURCE_TECH[source] in g['technologies']:
            goods.add(source)
        elif tile['report'] and tile['report']['mineral']:
            mineral=tile['report']['mineral']
            if RESOURCE_TECH.get(mineral,'Prospecting') in g['technologies']:
                goods.add(mineral)
    plots={s['kind'] for s in sites}
    goods.update(name for name,crop in CROPS.items() if crop['plot'] in plots and crop['tech'] in g['technologies'])
    recipes=[RECIPES[key] for s in sites for key in recipe_options(s,g['tiles'][s['id']])
             if RECIPES[key]['tech'] in g['technologies']]
    finished=set()
    while True:
        size=len(goods)
        for recipe in recipes:
            if all(any(matches(n,good) for n in names for good in goods)
                    for _,names in recipe['inputs']):
                outputs={good for _,good in recipe['outputs']}
                goods.update(outputs)
                if recipe['inputs']:
                    finished.update(outputs)
        if len(goods)==size:
            return goods,finished

def offers(g):
    window=int(g['now']//86400)
    known,_=producible(g)
    known=sorted(known or {'pine log'})
    result=[]
    for tier,(low,high,floor,multiplier) in enumerate(EXPORT_TIERS):
        rng=random.Random(f"{g['seed']}/exports/{window}/{tier}")
        if tier==0 and 'pine log' in known:
            good='pine log'
        else:
            good=rng.choice(known)
        result.append(dict(id=f'{window}/{tier}',tier=tier,good=good,
            qty=rng.randint(low,high),floor=floor,multiplier=multiplier))
    accepted=g.get('offer_board')
    if accepted and accepted[0]==window:
        return accepted[1]
    return result

def exchange(g,a,s):
    require(any(x['built'] and x['kind']=='export depot' for x in g['sites'].values()),'Build an export depot')
    history=g['orders']
    key=a['order']
    if a['op']=='accept export':
        offer=next((o for o in offers(g) if o['id']==key),None)
        require(offer and key not in history,'Offer unavailable or previously accepted')
        require(not any(o['tier']==offer['tier'] and o['status']=='active' and o['expires']>g['now']
                        for o in history.values()),'Finish or abandon the active contract in this tier')
        g['offer_board']=[int(g['now']//86400), offers(g)]
        history[key]=dict(offer,status='active',expires=g['now']+259200)
        return
    order=history.get(key)
    require(order and order['status']=='active' and order['expires']>g['now'],'Contract is inactive')
    if a['op']=='abandon export':
        order['status']='abandoned'
        return
    require(s and s['built'] and s['kind']=='export depot','Select an export depot')
    lots=take(s['shared'],order['good'],order['qty'],order['floor'],a.get('highest',False))
    mean=sum(l['qty']*l['q'] for l in lots)/order['qty']
    payout=math.floor(order['qty']*PRICES[order['good']]*order['multiplier']*(1+(mean-order['floor'])/100)+1e-9)
    order.update(status='shipped',payout=payout)
    g['coins']+=payout

CIVIC_SITES=('library','market hall','clock tower')

def market_slots(g):
    if not g.get('town_store'):
        return []
    return [g['town_store']]+[next(s['id'] for s in g['sites'].values() if s['kind']==kind and s['built'])
                   for kind in CIVIC_SITES
                   if any(s['kind']==kind and s['built'] for s in g['sites'].values())]

def market_choices(g):
    _,finished=producible(g)
    return sorted(good for good in finished if PRICES[good]>1)

def market_offer(g,slot):
    saved=g.get('market',{}).get(slot)
    if saved and saved['active']:
        return saved
    sequence=saved['sequence']+1 if saved else 0
    if saved and saved['refresh']>g['now']:
        return dict(refresh=saved['refresh'])
    goods=market_choices(g)
    if not goods:
        return None
    cycle,offset=divmod(sequence,len(goods))
    rng=random.Random(f"{g['seed']}/market/{slot}/{cycle}")
    rng.shuffle(goods)
    good=goods[offset]
    qty=rng.randint(2,6)
    level=g['sites'][slot]['level'] if slot!=g['town_store'] else 1
    payout=math.ceil(1.5*qty*PRICES[good]*(1+.02*(level-1))-1e-9)
    return dict(id=f'{slot}/{sequence}',sequence=sequence,good=good,qty=qty,payout=payout,active=True)

def available_supplies(g):
    has_sawmill=any(s['built'] and s['kind']=='sawmill' for s in g['sites'].values())
    return {good:price for good,price in SUPPLY_PRICES.items() if good!='pine log' or has_sawmill}

def market_command(g,a):
    market=g['sites'].get(a.get('site',g.get('town_store')))
    require(market and market['built'] and market['kind'] in MARKETPLACES,'Select a completed marketplace')
    slot=a['slot']
    require(slot in market_slots(g),'No market slot at this site')
    offer=market_offer(g,slot)
    require(offer and offer.get('id')==a['order'],'Market order is unavailable')
    if a['op']=='fill market order':
        take(market['shared'],offer['good'],offer['qty'])
        g['coins']+=offer['payout']
    g.setdefault('market',{})[slot]=dict(offer,active=False,refresh=g['now']+43200)

def reclaim(g,s):
    if s['materials']:
        s.pop('planned_crop',None)
        s.update(kind='warehouse',built=True,shared=s['materials'],materials=[],reclaim=True)
    else:
        del g['sites'][s['id']]

def demolish(g,s):
    require(s and s['built'] and s['kind']!='town store','Select a completed building other than the town store')
    require(nearby(g,g['tiles'][s['id']]),'Move within 40 m of the building to demolish it')
    require(not any(not job['done'] and job['dst']==s['id'] for job in g['jobs']),
            'Wait for incoming deliveries before demolishing')
    home=g['sites'][g['town_store']]
    for buffer in ('input','output','shared','materials','upgrade','conversion','pantry'):
        home['shared'].extend(s.get(buffer,[]))
    for citizen in g['citizens']:
        if citizen['home']==s['id']:
            citizen['home']=home['id']
        if citizen['assignment'] and citizen['assignment'][1]==s['id']:
            citizen['assignment']=None
    if s['kind'] in g['grants'] and not s['cost']:
        g.setdefault('starter_rebuilds',[]).append(s['kind'])
    if s.get('visiting') and s['kind'] in VISITING_INSTRUCTORS:
        g.pop(VISITING_INSTRUCTORS[s['kind']],None)
    del g['sites'][s['id']]

def tile_cell(tile,gps):
    if gps:
        return live_world.hex_cell(tile.get('map_x',tile['x']),tile.get('map_y',tile['y']))
    return round(tile['x']/60),round(tile['y']/60)

def adjacent_cells(cell,gps):
    x,y=cell
    offsets=((1,0),(-1,0),(0,1),(0,-1),(1,-1),(-1,1)) if gps else ((1,0),(-1,0),(0,1),(0,-1))
    return [(x+dx,y+dy) for dx,dy in offsets]

def center_reserved(g,tile):
    center=g['tiles'].get(g.get('town_store'))
    if not center:
        return False
    gps='graph' in g
    return tile_cell(tile,gps)==tile_cell(center,gps)

def restore_center_terrain(g):
    center=g['tiles'].get(g.get('town_store'))
    if not center or 'graph' not in g:
        return
    center_cell=tile_cell(center,True)
    neighbors=set(adjacent_cells(center_cell,True))
    occupied={tile_cell(g['tiles'][key],True) for key in g['sites']}
    land=[tile for tile in g['tiles'].values() if tile['resource']=='land' and
          tile_cell(tile,True) in neighbors-occupied]
    if not land:
        return
    for tile in g['tiles'].values():
        if tile['resource'] not in WOODS or tile_cell(tile,True)!=center_cell:
            continue
        if tile['id'] in g['sites'] and tile['id']!=center['id']:
            continue
        target=min(land,key=lambda candidate:(distance(candidate,tile),candidate['id']))
        target.update(resource=tile['resource'],grade=tile['grade'])
        tile['resource']='land'
        return

def tile_path_route(g,start,end):
    graph=g['graph']
    if start.get('edge') not in graph['edges'] or end.get('edge') not in graph['edges']:
        return None
    found=route(graph,start,end)
    return found if found and found[0]>0 else None

def tile_path_sections(g,start,end):
    found=tile_path_route(g,start,end)
    if not found:
        return []
    graph=g['graph']
    sections=[]
    for key,first,last in found[1]:
        if first==last:
            continue
        edge=graph['edges'][key]
        road=g['roads'].get(edge['canonical'])
        level=road_tier(road) if road else 0
        p,q=edge['p'],edge['q']
        if not sections or sections[-1]['road']!=edge['canonical']:
            head={axis:p[axis]+(q[axis]-p[axis])*first for axis in ('x','y')}
            sections.append(dict(road=edge['canonical'],level=level,upgrade_cost=ROAD_UPGRADE_COSTS.get(level+1),
                                 line=[unproject(graph['origin'],**head)]))
        tail={axis:p[axis]+(q[axis]-p[axis])*last for axis in ('x','y')}
        sections[-1]['line'].append(unproject(graph['origin'],**tail))
    return sections

def build_tile_path(g,start,end):
    gps='graph' in g
    require(start and end and tile_cell(end,gps) in adjacent_cells(tile_cell(start,gps),gps),
            'Choose two neighboring discovered tiles')
    links=g.setdefault('tile_paths',[])
    pair={tile_cell(start,gps),tile_cell(end,gps)}
    require(not any(pair=={tile_cell(g['tiles'][a],gps),tile_cell(g['tiles'][b],gps)} for a,b in links),
            'These tiles already have a path')
    if gps:
        require(tile_path_route(g,start,end),'No mapped walking route connects these tiles')
    pay(g,TILE_PATH_COST)
    links.append(sorted((start['id'],end['id'])))

def command(g,a):
    op=a['op']
    s=g['sites'].get(a.get('site'))
    tile=g['tiles'].get(a.get('site'))
    if 'graph' in g:
        require(op not in ('step','fix','advance','purchase'),'Fixture controls are unavailable in GPS mode')
    if op=='gps samples':
        require('graph' in g,'City uses simulated positions')
        if g['walking']:
            require(a.get('session')==g.get('walk_session'),'Location batch belongs to a different walk')
        live_world.apply_samples(g,a['samples'],g['now'],discover_live)
        restore_center_terrain(g)
    elif op in ('fill market order','dismiss market order'):
        market_command(g,a)
    elif op=='buy supplies':
        require(s and s['built'] and s['kind'] in MARKETPLACES,'Select a completed marketplace')
        good=a['good']
        require(good in SUPPLY_PRICES,'Unknown marketplace supply')
        prices=available_supplies(g)
        require(good in prices,'Build a sawmill to buy logs')
        qty=positive(a,maximum=12)
        require(count(s['shared'])+reserve(g,s,'shared')+qty<=cap(s,'shared'),'Marketplace stock is full')
        pay(g,qty*prices[good])
        add(s['shared'],good,qty,50)
    elif op in ('accept export','ship export','abandon export'):
        exchange(g,a,s)
    elif op=='walk':
        if 'graph' in g and a['enabled'] and g['walking']:
            require(a.get('session')==g.get('walk_session'),'Stop the existing walk first')
            return
        g['walking']=bool(a['enabled'])
        g['walk_started']=g['now'] if g['walking'] else None
        if 'graph' in g:
            session=a.get('session')
            require(not g['walking'] or isinstance(session,str) and 1<=len(session)<=100,'A walk session ID is required')
            g['walk_session']=session if g['walking'] else None
        g['road_track']=None
    elif op=='fix':
        fix_position(g,a)
    elif op=='step':
        dx,dy=a['dx'],a['dy']
        require(type(dx) is int and type(dy) is int and abs(dx)+abs(dy)<=1,'Invalid fixture direction')
        prior=g['fix'] or dict(x=0,y=0)
        if not g['fix'] or g['now']-g['fix']['at']>14:
            fix_position(g,prior)
        advance(g,g['now']+30)
        fix_position(g,dict(x=prior['x']+60*dx,y=prior['y']+60*dy))
    elif op=='advance':
        advance(g,g['now']+positive(a,'seconds',31*86400))
    elif op=='plan':
        kind=a['kind']
        require(not tile or not center_reserved(g,tile),'The city center is reserved for the town store')
        require(tile and kind in SITES and kind!='town store' and not s and eligible(tile,kind),'No eligible footprint')
        planned=a.get('crop')
        if planned is not None:
            require(planned in CROPS and CROPS[planned]['plot']==SITES[kind]['plot'],'Crop needs a different plot')
        g['sites'][tile['id']]=blueprint=make_site(tile,kind,unlock_cost(g,kind,a.get('rope')),g['now'])
        if planned is not None:
            blueprint['planned_crop']=planned
    elif op=='mark tile':
        if a.get('site') is None:
            g.pop('marked_tile',None)
        else:
            require(tile is not None,'Choose a discovered tile to mark')
            g['marked_tile']=tile['id']
    elif op=='build path':
        build_tile_path(g,tile,g['tiles'].get(a.get('destination')))
    elif op=='move blueprint':
        dst=g['tiles'].get(a['destination'])
        require(not dst or not center_reserved(g,dst),'The city center is reserved for the town store')
        require(s and not s['built'] and not s.get('construction') and dst and dst['id'] not in g['sites'] and
                eligible(dst,s['kind']) and not reserve(g,s,'materials'),'No eligible move for this blueprint')
        target=make_site(dst,s['kind'],s['cost'],g['now'])
        if s.get('planned_crop'):
            target['planned_crop']=s['planned_crop']
        g['sites'][dst['id']]=target
        reclaim(g,s)
    elif op=='cancel':
        require(s and not s['built'] and not s.get('construction'),'Select a blueprint before construction starts')
        require(not reserve(g,s,'materials'),'Wait for incoming delivery')
        reclaim(g,s)
    elif op=='demolish':
        demolish(g,s)
    elif op=='research':
        name=a['name']
        require(name in TECH and name not in g['technologies'] and not g['research'],'Research unavailable')
        tier,requirements=TECH[name]
        require(all(t in g['technologies'] for t in requirements),'Research prerequisites first')
        missing=[f"{row['label']} ({row['actual']}/{row['required']})"
                 for row in research_requirements(g)[tier] if row['actual']<row['required']]
        require(not missing,'Research requirements missing: '+', '.join(missing))
        fee,seconds=RESEARCH[tier]
        pay(g,fee)
        g['research']=dict(name=name,at=g['now']+seconds,duration=seconds)
    elif op=='survey':
        require(tile and tile['resource']=='prospect' and not tile['survey'],'No available prospect')
        tier=positive(a,'tier',3)
        report=tile['report']
        require(not report or not report['mineral'] and tier>report['tier'],'Coverage already reached')
        fee,seconds=SURVEY[tier-1]
        if a.get('scope'):
            take(g['sites'][g['town_store']]['shared'],'survey scopes',1)
            seconds/=2
        pay(g,fee)
        tile['survey']=dict(tier=tier,at=g['now']+seconds,duration=seconds)
    elif op in ('deposit paving','finish paving'):
        key=a['road']
        road=g['roads'].get(key)
        require(road is not None,'Walk this section first')
        require(nearby(g,road['anchor'] if 'anchor' in road else road_anchor(key)),'Move within 40 m of this road and try again. If you\'re already there, wait a moment for your location to update.')
        tier=road_tier(road)+1
        require(tier in ROAD_UPGRADE_COSTS and tier==a.get('tier'),'Road upgrades require level 2 or 3')
        pile=road.setdefault('paving',[])
        if op=='deposit paving':
            qty=positive(a,maximum=3)
            require(count(pile)+qty<=3,'Road needs at most three paving blocks')
            pile.extend(take(g['cargo'],'paving blocks',qty))
        else:
            require(count(pile)==3,'Deliver three paving blocks first')
            road.update(paid=tier,paving=[])
    elif op=='reclaim paving':
        road=g['roads'].get(a['road'])
        require(road and road.get('paving'),'Road has no staged materials')
        require(nearby(g,road['anchor'] if 'anchor' in road else road_anchor(a['road'])),'Move within 40 m of this road and try again. If you\'re already there, wait a moment for your location to update.')
        qty=positive(a,maximum=3)
        require(count(g['cargo'])+qty<=capacity(g),'Cargo is full')
        g['cargo'].extend(take(road['paving'],'paving blocks',qty))
    elif op=='road':
        road=g['roads'].get(a['road'])
        require(road is not None,'Walk this section first')
        tier=road_tier(road)+1
        require(tier in ROAD_UPGRADE_COSTS and tier==a.get('tier'),'Road upgrades require level 2 or 3')
        pay(g,ROAD_UPGRADE_COSTS[tier])
        road['paid']=tier
    elif op=='purchase':
        receipt=a['receipt']
        require(isinstance(receipt,str) and 1<=len(receipt)<=128,'Invalid sandbox receipt')
        if receipt not in g['receipts']:
            g['receipts'].append(receipt)
            g['vouchers']+=5
    elif op=='haul':
        dst=g['sites'].get(a['destination'])
        require(s and s['built'] and dst,'Select a source and destination')
        terms=quote(g,s['id'],dst['id'])
        qty=positive(a,maximum=max(HAUL_CAPACITY.values()))
        require(qty<=terms['capacity'],f"The road route can carry up to {terms['capacity']} units per haul")
        source=a.get('source_buffer','output')
        require(source in ('output','shared','input'),'Invalid source buffer')
        good=a['good']
        require(good in PRICES and good not in ('log','plank'),'Select an exact commodity')
        buf=a['buffer']
        destination(g,dst,buf,good,qty)
        lots=take(s[source],good,qty,a.get('minimum',0),a.get('highest',False),a.get('quality'))
        if a.get('voucher'):
            require(g['vouchers']>0,'No haul vouchers')
            g['vouchers']-=1
        else:
            pay(g,terms['fee'])
        g['jobs'].append(dict(id=len(g['jobs']),src=s['id'],dst=dst['id'],buffer=buf,
            lots=lots,at=g['now']+terms['seconds'],duration=terms['seconds'],done=False,fee=0 if a.get('voucher') else terms['fee']))
    else:
        require(s,'Select a site')
        if op in ('build','pickup','deliver','plant','harvest','clear crop','herd','upgrade','convert','fit kit'):
            require(nearby(g,tile),
                    'Move into this hex and wait for GPS to sync. The hex needs mapped walking access.' if 'graph' in g else
                    'Move within 40 m of this site and refresh your location.')
        if op=='build':
            require(not center_reserved(g,tile),'The city center is reserved for the town store')
            require(not s['built'],'Building already complete')
            require(not s.get('construction'),'Construction is already in progress')
            require(all(row['delivered']==row['required'] for row in construction_needs(s,[])),
                    'Construction materials missing. Deliver the items listed under Construction first.')
            require(not reserve(g,s,'materials'),'Wait for incoming materials before starting construction')
            require(s['kind']!='fish pond' or tile['resource']=='pond','Move the fishing pond blueprint to a pond tile')
            free=s['kind'] in ('lumberjack station','sawmill') and not s['cost']
            rebuilding=free and s['kind'] in g.get('starter_rebuilds',[])
            require(not free or rebuilding or s['kind'] not in g['grants'],'Starter grant already spent')
            if rebuilding:
                g['starter_rebuilds'].remove(s['kind'])
            elif free:
                g['grants'].append(s['kind'])
            duration=construction_duration(s['kind'],s['cost'])
            s.update(materials=[],construction=dict(at=g['now']+duration,duration=duration,
                                                      starter=free,rebuilding=rebuilding))
        elif op in ('pickup','deliver'):
            qty=positive(a)
            good=a['good']
            require(good in PRICES and good not in ('log','plank'),'Select an exact commodity')
            buf=a['buffer']
            if op=='pickup':
                require(buf in ('output','input','shared','materials','upgrade','conversion','pantry'),'Invalid source buffer')
                require(count(g['cargo'])+qty<=capacity(g),'Cargo is full')
                g['cargo'].extend(take(s[buf],good,qty,a.get('minimum',0),a.get('highest',False),a.get('quality')))
                if s.get('reclaim') and not s['shared']:
                    del g['sites'][s['id']]
            else:
                destination(g,s,buf,good,qty)
                lots=take(g['cargo'],good,qty,a.get('minimum',0),a.get('highest',False),a.get('quality'))
                if buf in ('materials','upgrade','conversion','input'):
                    for lot in lots:
                        if not lot.get('xp'):
                            g['xp']+=lot['qty']
                            lot['xp']=True
                s[buf].extend(lots)
        else:
            require(s['built'],'Finish construction first')
            if op=='recipe':
                require(a['name'] in recipe_options(s,tile) and s['kind'] not in ('paddock','apiary','fish pond'),'Recipe unavailable here')
                r=RECIPES[a['name']]
                choices=a.get('choices',[])
                require(len(choices)<=len(r['inputs']) and all(x in r['inputs'][i][1] for i,x in enumerate(choices)),'Invalid ingredient alternatives')
                minimum=a.get('minimum',0)
                floors=a.get('floors',[])
                require(type(minimum) is int and 0<=minimum<=100 and isinstance(floors,list) and
                        len(floors)<=len(r['inputs']) and all(type(q) is int and 0<=q<=100 for q in floors),
                        'Quality floors must be integers from 0–100')
                inputs=selected_inputs(r,choices)
                pending=(lot for j in g['jobs'] if not j['done'] and j['dst']==s['id'] and j['buffer']=='input'
                         for lot in j['lots'])
                require(all(any(matches(good,lot['good']) for _,good in inputs) for lot in pending),
                        'Wait for incompatible inbound stock')
                s.update(recipe=a['name'],choices=choices,minimum=minimum,floors=floors,highest=bool(a.get('highest')))
            elif op=='plant':
                name=a['name']
                require(name in CROPS and CROPS[name]['plot']==SITES[s['kind']]['plot'] and not s['crop'],'Crop does not fit or plot is occupied')
                s['crop']=planting(g,s,name,a.get('compost'))
                s.pop('planned_crop',None)
            elif op=='harvest':
                crop=s['crop']
                require(crop and crop['at']<=g['now'] and s['worker'] is not None,'Crop is immature or needs a farmer')
                qty=plant_yield(crop)
                require(count(s['output'])+qty<=cap(s,'output'),'Output full. Crop remains standing')
                add(s['output'],crop['name'],qty,crop['q'])
                practice(s)
                s['crop']=planting(g,s,crop['name'],a.get('compost')) if s['kind'] in ('orchard','trellis','rubber grove') else None
            elif op=='clear crop':
                require(s['crop'],'No crop planted')
                s['crop']=None
            elif op=='herd':
                require(a['name'] in ANIMALS and not s['recipe'] and RECIPES[ANIMALS[a['name']]]['site']==s['kind'],'Herd unavailable')
                pay(g,5)
                s['recipe']=ANIMALS[a['name']]
            elif op=='tax':
                require(s['kind'] in HOMES,'No household income here')
                g['coins']+=s['tax']
                s['tax']=0
            elif op=='sell':
                require(s['kind'] in MARKETPLACES,'Sell from a marketplace')
                qty=positive(a)
                good=a['good']
                require(good in PRICES,'Unknown item')
                take(s['shared'],good,qty,a.get('minimum',0),a.get('highest',False),a.get('quality'))
                g['coins']+=qty*PRICES[good]
            elif op=='train':
                require(s['worker'] is not None and s['skill']<100,'Assign a crew below skill 100')
                pay(g,s['skill'])
                s['skill']=min(100,s['skill']+5)
            elif op=='staff priority':
                priority=a['priority']
                require(s['built'] and staffing_requirement(s) is not None,'Site has no staffing position')
                require(type(priority) is int and 0<=priority<=2,'Choose Low, Normal, or High priority')
                s['staff_priority']=priority
            elif op=='enrol':
                require(s['kind'] in SCHOOLS and not s['course'] and (s['worker'] is not None or s['visiting']),'An available instructor is required')
                level,_,seats,duration=SCHOOLS[s['kind']]
                radius=SCHOOL_COVERAGE[s['kind']][1]
                candidates=[]
                for citizen in g['citizens']:
                    if citizen['education']!=level or 'education_limit' in citizen:
                        continue
                    if service_distance(g,citizen['home'],s['id'],radius) is None:
                        continue
                    assignment=citizen['assignment']
                    if assignment is None:
                        candidates.append((-1,citizen['id']))
                    elif assignment[0]=='work' and assignment[1]!=s['id']:
                        candidates.append((staffing_priority(g['sites'][assignment[1]]),citizen['id']))
                ids=[i for _,i in sorted(candidates)[:int(seats*SPEED[s['level']-1])]]
                require(ids,'No eligible residents within this school’s walking range')
                for i in ids:
                    citizen=g['citizens'][i]
                    if citizen['assignment']:
                        staff(g,g['sites'][citizen['assignment'][1]],None,0)
                    citizen['assignment']=['study',s['id']]
                if a.get('slates'):
                    require(level==0,'Writing slates apply to primary courses')
                    take(s['input'],'writing slates',len(ids))
                    duration*=.75
                s['course']=dict(students=ids,at=g['now']+duration,duration=duration,remaining=None,selective=True)
            elif op=='upgrade materials':
                require(s['kind'] in CIVIC_SITES and 4<=s['level']+1<=10 and not s['upgrade'] and
                        not reserve(g,s,'upgrade'),'Empty civic upgrade storage first')
                material=a['good']
                require(material in ('bricks','glazed tiles','dressed marble','roof slates'),'Invalid civic material')
                s['upgrade_stonework']=material
            elif op=='upgrade':
                require(s['level']<10 and a.get('level')==s['level']+1 and meets(s['upgrade'],upgrade_cost(s)),'Upgrade unavailable or materials missing')
                require_services(g,s)
                if s['kind'] in HOMES and s['kind']!='town store':
                    require(household(g,s)['ready'],'Household needs or observation window are incomplete')
                    old=home_places(s)
                else:
                    old=None
                s['level']+=1
                s['upgrade']=[]
                s.pop('upgrade_stonework',None)
                if old is not None:
                    s['since']=g['now']
                    s['tax_at']=g['now']
                    for _ in range(home_places(s)-old):
                        resident(g,s,0)
            elif op=='conversion materials':
                require(s['kind']=='cottage' and not s['conversion'] and not reserve(g,s,'conversion'),'Empty conversion storage first')
                s['cabinets']=bool(a.get('cabinets'))
            elif op=='convert':
                require(s['kind'] in CONVERSIONS and a.get('kind')==CONVERSIONS[s['kind']][0] and
                        household(g,s)['ready'] and meets(s['conversion'],conversion_cost(s)),
                        'Conversion requires full materials and a household that meets its needs')
                require_services(g,s,converted=s['id'])
                old=home_places(s)
                s.update(kind=a['kind'],since=g['now'],tax_at=g['now'],conversion=[])
                for _ in range(home_places(s)-old):
                    resident(g,s,0)
            elif op=='fit kit':
                require(s['kind']=='machine works' and g['xp']>=500 and not g['truck_kit'],
                        'Fitting a vehicle kit requires 500 XP and a machine works. You can fit one kit.')
                take(g['cargo'],'vehicle kit',1)
                g['truck_kit']=True
            else:
                raise RuleError('Unknown command')
    fill_jobs(g)
    for site in g['sites'].values():
        begin_batch(g,site)

def staff(g,s,idx,credential):
    if idx is not None:
        require(type(idx) is int and 0<=idx<len(g['citizens']),'Unknown resident')
        c=g['citizens'][idx]
        require(c['education']>=credential and (c['assignment'] is None or c['assignment'][0]=='work'),'Resident lacks qualification or is studying')
        if s['worker']==idx:
            return
        if c['assignment']:
            staff(g,g['sites'][c['assignment'][1]],None,0)
    if s['worker'] is not None:
        g['citizens'][s['worker']]['assignment']=None
    s['worker']=idx
    if idx is not None:
        g['citizens'][idx]['assignment']=['work',s['id']]
    for kind in ('course','batch'):
        cycle=s[kind]
        if cycle:
            if idx is None and not s['visiting'] and cycle['at'] is not None:
                cycle['remaining']=cycle['at']-g['now']
                cycle['at']=None
            elif idx is not None and cycle['at'] is None:
                cycle['at']=g['now']+cycle['remaining']
                cycle['remaining']=None

def assessment(g,s):
    if not s['built']:
        return None
    if s['crop'] and s['crop']['at']<=g['now']:
        return 'Crop ready to harvest'
    if not s['recipe']:
        return None
    r=RECIPES[s['recipe']]
    if s['worker'] is None:
        return 'Needs a qualified lead'
    if s['batch']:
        return None
    if r['tech'] not in g['technologies']:
        return 'Needs '+r['tech']+' research'
    if count(s['output'])+sum(q for q,_ in r['outputs'])>cap(s,'output'):
        return 'Output buffer full'
    for index,(qty,good) in enumerate(selected_inputs(r,s['choices'])):
        floors=s.get('floors',[])
        floor=floors[index] if index<len(floors) else s.get('minimum',0)
        stock=sum(l['qty'] for l in s['input'] if matches(good,l['good']) and l['q']>=floor)
        if stock<qty:
            return f'Waiting for {good}'+(f' Q{floor}+' if floor else '')
    return None

def construction_needs(site,incoming):
    staged=[lot.copy() for lot in site['materials']]
    in_transit=[lot.copy() for job in incoming if job['buffer']=='materials' for lot in job['lots']]
    def allocate(stock,names,wanted):
        remaining=wanted
        for lot in stock:
            if remaining and any(matches(name,lot['good']) for name in names):
                used=min(remaining,lot['qty'])
                remaining-=used
                lot['qty']-=used
        return wanted-remaining
    needs=[]
    for qty,goods in site['cost']:
        delivered=allocate(staged,goods,qty)
        pending=allocate(in_transit,goods,qty-delivered)
        needs.append(dict(goods=goods,required=qty,delivered=delivered,incoming=pending))
    return needs

def timed_task(kind,label,activity,default_duration=None):
    return dict(kind=kind,label=label,at=activity['at'],
                duration=activity.get('duration',default_duration),remaining=activity.get('remaining'))

def site_tasks(g,tile,s,incoming):
    tasks=[]
    if tile['survey']:
        survey=tile['survey']
        tasks.append(timed_task('survey',f"Tier {survey['tier']} survey",survey,SURVEY[survey['tier']-1][1]))
    project=g['research']
    if project and tile['id']==g['town_store']:
        tasks.append(timed_task('research',project['name'],project,RESEARCH[TECH[project['name']][0]][1]))
    if s and s['crop']:
        crop=s['crop']
        tasks.append(timed_task('crop',f"Growing {crop['name']}",crop,
                                CROPS[crop['name']]['seconds']/SPEED[s['level']-1]))
    if s and s['batch']:
        batch=s['batch']
        recipe=RECIPES[batch['recipe']]
        outputs=', '.join(good for _,good in recipe['outputs'])
        tasks.append(timed_task('production',f'Producing {outputs}',batch,recipe['seconds']/SPEED[s['level']-1]))
    if s and s['course']:
        tasks.append(timed_task('course','Class in progress',s['course'],SCHOOLS[s['kind']][3]))
    if s and s.get('construction'):
        tasks.append(timed_task('construction',f"Building {s['kind']}",s['construction']))
    elif s and not s['built'] and s['cost']:
        needs=construction_needs(s,incoming)
        tasks.append(dict(kind='construction',label='Construction materials',
                          collected=sum(row['delivered'] for row in needs),
                          required=sum(row['required'] for row in needs)))
    for job in incoming:
        duration=job.get('duration')
        if duration is None:
            duration=quote(g,job['src'],job['dst'])['seconds']
        tasks.append(timed_task('delivery',f"Incoming haul #{job['id']+1}",job,duration))
    return tasks

def view(g):
    public={k:v for k,v in g.items() if k not in ('seed','tiles','sites','receipts','road_track','market','offer_board','wall_at','production_active_until','production_inactive','graph','map_areas','matched','presence','scanned_hex_access','opportunities','explored_edges')}
    public['capacity']=capacity(g)
    public['mode']='gps' if 'graph' in g else 'fixture'
    public['origin']=g['graph']['origin'] if 'graph' in g else None
    public['map_revision']=len(g.get('map_areas',[]))
    if g.get('matched') and g.get('fix'):
        public['fix']={**g['fix'],'edge':g['matched']['edge']}
    public['offers']=offers(g)
    public['market_orders']={slot:market_offer(g,slot) for slot in market_slots(g)}
    public['supply_prices']=available_supplies(g)
    public['education']=education(g)
    public['research_requirements']=research_requirements(g)
    compost_quality=next((lot['q'] for lot in g['cargo'] if lot['good']=='compost' and lot['qty']>0),None)
    public['crop_forecast']=crop_forecast(g,STARTING_SKILL,compost_quality)
    public.setdefault('blocked_hexes',[])
    incoming={}
    for job in g['jobs']:
        if not job['done']:
            incoming.setdefault(job['dst'],[]).append(job)
    gps='graph' in g
    cells={}
    for tile in g['tiles'].values():
        cells.setdefault(tile_cell(tile,gps),tile['id'])
    if g.get('town_store'):
        cells[tile_cell(g['tiles'][g['town_store']],gps)]=g['town_store']
    links=g.get('tile_paths',[])
    connected={}
    public['tile_paths']=[]
    for a,b in links:
        start,end=(tile_cell(g['tiles'][key],gps) for key in (a,b))
        connected.setdefault(start,set()).add(end)
        connected.setdefault(end,set()).add(start)
        connection=dict(a=a,b=b,line=[])
        if gps:
            sections=tile_path_sections(g,g['tiles'][a],g['tiles'][b])
            connection['sections']=sections
            for section in sections:
                connection['line'].extend(section['line'][1:] if connection['line'] else section['line'])
        public['tile_paths'].append(connection)
    public['tiles']={}
    for key,tile in g['tiles'].items():
        reserved=center_reserved(g,tile)
        if reserved and key!=g['town_store'] and key not in g['sites']:
            continue
        public['tiles'][key]={k:v for k,v in tile.items() if k not in ('truth','difficulty') and (
            k!='grade' or tile['resource']!='prospect' or tile['report'] and tile['report']['mineral'])}
        public['tiles'][key]['nearby']=nearby(g,tile)
        if key==g['town_store']:
            public['tiles'][key]['resource']='land'
            public['tiles'][key]['city_center']=True
        resource=tile['report']['mineral'] if tile['report'] and tile['report']['mineral'] else tile['resource']
        if not reserved and resource in RESOURCE_TECH:
            public['tiles'][key]['resource_tech']=RESOURCE_TECH[resource]
        cell=tile_cell(tile,gps)
        targets=[cells[neighbor] for neighbor in adjacent_cells(cell,gps)
                 if neighbor in cells and neighbor not in connected.get(cell,())]
        if targets:
            public['tiles'][key]['path_targets']=targets
        tasks=site_tasks(g,tile,g['sites'].get(key),incoming.get(key,[]))
        if tasks:
            public['tiles'][key]['tasks']=tasks
        if not reserved and key not in g['sites']:
            public['tiles'][key]['eligible']=[k for k in SITES if k!='town store' and eligible(tile,k)]
        if 'graph' in g:
            public['tiles'][key].update(unproject(g['graph']['origin'],tile['x'],tile['y']))
    public['sites']={}
    schools={kind:school_allocations(g,kind) for kind in SCHOOLS}
    for key,s in g['sites'].items():
        data=public['sites'][key]=s.copy()
        data.pop('offline_batches',None)
        data['capacity']={b:cap(s,b) for b in ('input','output','shared') if s['kind'] in SITES}
        data['assessment']=assessment(g,s)
        data.pop('auto_staff',None)
        data['staff_priority']=staffing_priority(s)
        data['staffing_requirement']=staffing_requirement(s)
        if s['kind'] in MARKETPLACES:
            data['marketplace']=True
        if SITES.get(s['kind'],{}).get('plot'):
            data['crop_forecast']=crop_forecast(g,s['skill'],compost_quality)
        data['options']=recipe_options(s,g['tiles'][key])
        data['input_goods']=(['writing slates'] if s['kind']=='primary school' else
                             [good for _,good in selected_inputs(RECIPES[s['recipe']],s['choices'])]
                             if s['recipe'] else [])
        if not s['built']:
            data['construction_seconds']=construction_duration(s['kind'],s['cost'])
            if not s.get('construction'):
                data['construction_needs']=construction_needs(s,incoming.get(key,[]))
        data['next_cost']=upgrade_cost(s) if s['level']<10 else []
        if s['kind'] in CONVERSIONS:
            data['conversion_cost']=conversion_cost(s)
            data['conversion_kind']=CONVERSIONS[s['kind']][0]
        if s['built'] and s['kind'] in HOMES:
            data['household']=household(g,s)
            data['capacity']['pantry']=cap(s,'pantry')
        if s['built'] and (s['level']<10 or s['kind'] in CONVERSIONS):
            services=service_coverage(g,s,schools)
            if services:
                data['service_coverage']=services
        if s['built'] and s['kind'] in SCHOOLS:
            data['school_coverage']={**schools[s['kind']][2][key], 'radius':SCHOOL_COVERAGE[s['kind']][1],
                                     'class_size':int(SCHOOLS[s['kind']][2]*SPEED[s['level']-1])}
    return public


MARKET_GUIDE = (
    'Open Overview at any marketplace to see the citywide buyer orders.',
    'Put the requested goods in that marketplace’s stock, then tap Sell to buyer to collect the coins.',
    'A buyer might offer 12 coins for 4 bread. After a sale or dismissal, a new order appears in 12 game hours.',
)

BUILDING_PURPOSES = {
    'town store': 'Your main marketplace and central stockpile. Nearby homes have market access. All marketplaces offer the same supplies and buyer orders.',
    'warehouse': 'Adds a separate stockpile for deliveries and overflow. You can collect its goods in person or dispatch them by hired haul.',
    'export depot': 'Lets you accept export contracts and sell larger shipments for coins. Each contract specifies a good, quantity, and minimum quality. Store the goods at this depot to ship them.',
    'library': 'Counts as a learning building for research. Your first library adds a citywide buyer.',
    'local marketplace': 'Extends market access to nearby homes. Buy supplies and fulfill citywide buyer orders using this marketplace’s stock.',
    'police station': 'Provides police coverage for nearby homes upgrading to level 3 or higher. Station upgrades require nearby education.',
    'fire station': 'Provides fire coverage for nearby homes upgrading to level 4 or higher. Station upgrades require nearby education.',
    'market hall': 'Provides local market access. Your first market hall adds a citywide buyer.',
    'clock tower': 'Build your first Clock Tower to attract one more buyer to the City Center market. Upgrade that tower to earn more on its future orders.',
    'field': 'Grow staple crops such as wheat for bread, potatoes for food, and beans for meals. Choose a crop that prefers the local soil for a larger, higher-quality harvest.',
    'garden': 'Grow vegetables and herbs for meals, preserves, and other recipes. The crop list shows which ones suit this soil.',
    'orchard': 'Grow fruit and nuts for juice, preserves, and cooking. Orchard crops start another growing cycle after harvest.',
    'trellis': 'Grow climbing crops such as grapes for juice and hemp for rope. Trellis crops start another growing cycle after harvest.',
    'meadow': 'Grow crops such as clover for hay, bee feed, or compost. Harvest the crop before starting the next planting.',
    'rubber grove': 'Harvest latex for the Rubber Works. The grove starts another growing cycle after each harvest.',
    'paddock': 'Choose an animal to raise. Feed it to collect goods such as eggs, milk, wool, meat, or manure for compost.',
    'apiary': 'Feed bees clover to collect honey and beeswax. Completed batches also pollinate growing crops in orchards within 120 m, adding one unit to eligible harvests.',
    'fish pond': 'Raise trout on a pond tile. Supply stock feed and collect trout for food or smoking.',
    'lumberjack station': 'Harvest logs from the trees on this tile. Carry them to a sawmill for planks or use them as fuel in recipes that accept logs.',
    'sawmill': 'Saw logs into planks of the same wood. Use the planks to build structures or supply woodworking recipes.',
    'mine': 'Extract the mineral identified by a survey on this tile. Send ores to a foundry or use other minerals in the recipes that call for them.',
    'kiln': 'Fire clay into bricks, a construction material used in buildings and upgrades.',
    'bakery': 'Bake bread from wheat and use processed ingredients for pastries. The baked goods can feed households or be sold.',
    'foundry': 'Smelt ores with coal into metal bars. Send the bars to workshops, alloy works, or jewellers, depending on the metal.',
    'workshop': 'Make tools, fittings, gears, wire, and other parts. Its recipes supply buildings and higher-level factories.',
    'jeweller': 'Turn precious metals, gemstones, and polished amber into jewellery for household leisure or sale.',
    'quarry': 'Cut stone from this tile for construction and upgrades.',
    'clay pit': 'Dig clay from this tile for bricks and pottery.',
    'sand pit': 'Dig sand from this tile for glass and mortar.',
    'gravel pit': 'Collect gravel from this tile to make paving blocks.',
    'limestone quarry': 'Extract limestone from this tile for lime and glass.',
    'reed bed': 'Cut reeds from this tile for paper or compost.',
    'resin tap': 'Gather resin from this tile.',
    'forager hut': 'Gather the berries or mushrooms that grow on this tile. Berries can also go into jam.',
    'cork stand': 'Harvest cork from this tile to make bottle stoppers.',
    'willow coppice': 'Cut willow from this tile for basket making.',
    'bamboo grove': 'Harvest bamboo for baskets or furniture panels.',
    'basalt quarry': 'Extract basalt from this tile to make paving blocks.',
    'salt spring': 'Collect brine from this tile and send it to the saltworks for rock salt.',
    'amber bank': 'Collect raw amber from this tile. A stonecutter can polish it for jewellery.',
    'feed mill': 'Grind crops and press cake into animal feed. Different recipes supply grain feed or stock feed.',
    'hay barn': 'Dry clover into hay for livestock.',
    'grain mill': 'Mill grain into flour or rolled oats for bakeries and kitchens.',
    'malt house': 'Turn barley into malt for the brewery.',
    'brewery': 'Brew ale from malt and hops for sale.',
    'orchard press': 'Press apples, pears, or grapes into juice. Some juices can then be fermented or bottled.',
    'cider house': 'Ferment apple juice into cider or grape juice into vinegar. Cider can be bottled, and vinegar is used for pickling and condiments.',
    'sugar house': 'Extract sugar from sugar beet for preserves and sweets.',
    'preserve kitchen': 'Make jam, marmalade, and pickles. Bring fruit or vegetables and the sugar or vinegar specified by the recipe.',
    'oil press': 'Press crops into oil for cooking and other recipes. Some batches also produce press cake for animal feed or compost.',
    'dairy': 'Turn milk into butter or cheese. Different animals’ milk produces different goods.',
    'town kitchen': 'Cook meals such as porridge, soup, and flatbreads. It also makes sauce used in other dishes.',
    'smokehouse': 'Smoke trout with logs or cure pork with salt. Collect smoked fish or cured pork.',
    'compost yard': 'Turn organic materials such as manure or clover into compost. Applying compost at planting adds two units and can improve harvest quality.',
    'fibre shed': 'Spin plant or animal fibres into yarn for weavers and other crafts.',
    'weaving house': 'Weave yarn into linen, cotton cloth, or wool cloth for clothing and household goods.',
    'dye works': 'Make dye or pigment from local materials, or use dye to colour wool cloth for the tailor.',
    'tailor': 'Sew fabric into shirts and coats, or make quilts for household comfort.',
    'tannery': 'Cure hide with rock salt to make leather for the cobbler.',
    'cobbler': 'Use leather and linen yarn to make boots for households.',
    'chandlery': 'Make candles from beeswax and yarn, or scented soap from oil and lavender.',
    'paper mill': 'Make paper from reeds and logs for printing and construction.',
    'print shop': 'Make ink from graphite and oil, then use ink and paper to print books.',
    'furniture shop': 'Make chairs, beds, shelves, or cabinet materials. Furniture can support household comfort, while some pieces are used in housing conversions.',
    'lime kiln': 'Fire limestone with coal to make lime for the mason.',
    'mason': 'Make mortar, plaster, and paving blocks for construction and upgrades.',
    'glassworks': 'Make glass for buildings and bottles, or optical glass for survey scopes.',
    'pottery': 'Fire mineral materials into crockery, porcelain, and glazed tiles.',
    'alloy works': 'Combine metals into bronze, brass, steel, or stainless steel for parts and advanced construction.',
    'instrument maker': 'Assemble survey scopes and clocks. Scopes can halve survey time, while clocks are used for the Clock Tower and household leisure.',
    'rubber works': 'Make rubber from latex and sulphur, then combine rubber and steel to make tyres.',
    'machine works': 'Assemble motors and vehicle kits. Fitting a kit to an unlocked truck adds 10 units of carrying capacity.',
    'condiment kitchen': 'Process peanuts, sesame, or mustard into peanut butter, tahini, or prepared mustard.',
    'drying house': 'Dry fruit and vanilla or finish and smoke tea for household use, further recipes, or sale.',
    'roastery': 'Roast coffee or combine almonds and sugar into marzipan for the bakery.',
    'basket maker': 'Weave willow or bamboo into baskets for household essentials.',
    'ropewalk': 'Twist hemp into rope for furniture panels or as an alternative warehouse construction material.',
    'bottling house': 'Cut cork into stoppers, then use stoppers and glass to bottle cider or pear juice.',
    'saltworks': 'Evaporate brine into rock salt for food preservation and leather making.',
    'stonecutter': 'Cut and finish minerals into paving blocks, dressed marble, roof slates, writing slates, or polished amber for other trades.',
}


def building_details():
    inputs = {name:'Compost is optional. Planting uses the plot’s soil.' for name,s in SITES.items() if s['plot']}
    inputs.update({
        'export depot':'The goods and minimum quality listed on your accepted contract.',
        'paddock':'Feed depends on the animal you select.',
    })
    market_note = ('Market Hall, Clock Tower, and Library each add one buyer. Extra copies of the same building share that buyer. '
                   'Future orders from that buyer pay 2% more of the base reward per building level above 1.')
    descriptions = BUILDING_PURPOSES.copy()
    for name,(places,coins) in HOMES.items():
        if name!='town store':
            descriptions[name]=(f'Houses {places} residents and earns {coins} {"coin" if coins==1 else "coins"} '
                                'per game hour at level 1. Upgrades and conversions require a supplied pantry and nearby civic services.')
            inputs[name]='Food and household goods go in the pantry.'
    for name,(level,_,seats,duration) in SCHOOLS.items():
        extra=' Supplying writing slates shortens primary classes by 25%.' if level==0 else ''
        descriptions[name]=(f'Teaches up to {seats} residents of education level {level} at once. After '
                            f'{duration//3600} game hours, graduates reach education level {level+1}. '
                            f'About {GRADUATION_RATES[level]}% pass. Residents who fail keep their current education '
                            'and can continue working.'+extra)
        if level==0:
            inputs[name]='Writing slates are optional.'
    placement={name:'Any empty discovered tile except ponds or the city center.' for name in SITES}
    for name in dict.fromkeys(EXTRACTORS.values()):
        resources=[material for material,extractor in EXTRACTORS.items() if extractor==name]
        placement[name]='Requires a tile with '+ ' or '.join(resources)+'.'
    placement.update({
        'town store':'Placed automatically on your first reachable tile.',
        'lumberjack station':'Requires a forest tile.',
        'mine':'Requires a surveyed prospect with a confirmed mineral.',
        'field':'Requires an empty land tile.',
        'fish pond':'Requires a pond tile.',
    })
    costs={name:site['cost'] for name,site in SITES.items()}
    for source,(name,cost) in CONVERSIONS.items():
        placement[name]=f'Convert an existing {source} that meets household and coverage requirements.'
        costs[name]=quantities(cost)
    coverage={kind:f'{radius} m walking range · {capacity} coverage places at level 1'
              for kind,(_,radius,capacity) in SCHOOL_COVERAGE.items()}
    for _,label,kinds,radius in HOME_SERVICES:
        for kind in kinds:
            coverage[kind]=f'{label} coverage for homes within {radius} m walking distance.'
    return {name:dict(description=descriptions[name],inputs=inputs.get(name),
                     placement=placement[name],build_cost=costs[name],coverage=coverage.get(name),
                     lead=staffing_requirement({'kind':name}),shared=SITES.get(name,{}).get('shared',0),
                     market_note=market_note if name in CIVIC_SITES else None,
                     construction_seconds=construction_duration(name,SITES[name]['cost']) if name in SITES and name!='town store' else None)
            for name in dict.fromkeys((*SITES,*HOMES))}
