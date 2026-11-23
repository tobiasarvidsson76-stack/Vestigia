"""Deterministic fixture world and transactional command domain."""
import hashlib
import math
import random

from catalog import ANIMALS, CROPS, EXTRACTORS, MINERALS, PRICES, RECIPES, SITES, SPEED, STORAGE, SURFACE, TECH, WOODS, matches, quantities

HOMES = {'cottage':(4,1,12), 'townhouse':(8,2,24), 'apartment house':(16,4,48), 'town store':(2,0,0)}
SCHOOLS = {'primary school':(0,2,4,14400),'technical college':(1,2,3,28800),'university':(2,3,2,57600)}
RESEARCH = ((0,0),(2,900),(5,2700),(10,7200),(20,14400))
SURVEY = ((3,300),(8,900),(18,1800))

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
                since=now,tax=0,tax_at=now,skill=40,batches=0,worker=None,recipe=None,
                choices=[],batch=None,crop=None,course=None,visiting=False)

def point(i,j):
    return f'{i},{j}'

def world_tile(g,i,j):
    key = point(i,j)
    rng = random.Random(int.from_bytes(hashlib.sha256(f"{g['seed']}/{key}".encode()).digest()[:8]))
    rank = len(g['tiles'])
    grade_roll = rng.random()
    band = (35,64) if grade_roll<.6 else (65,84) if grade_roll<.9 else (85,100)
    grade = rng.randint(*band)
    soil = rng.choice(['loam','sandy','heavy'])
    assigned = {1:'pine',2:'field',3:'stone',4:'clay'}
    g['tiles'][key] = tile = dict(id=key,x=i*60,y=j*60,grade=grade,soil=soil,
        resource=assigned.get(rank,'land'),truth=None,difficulty=None,report=None,survey=None)
    if 5<=rank<=48 and (rank-5)%7==0 and (rank-5)//7<len(MINERALS[:5]):
        tile.update(resource='prospect',truth=MINERALS[(rank-5)//7],difficulty=3 if rank==5 else rng.choices([1,2,3],[50,35,15])[0])
    elif rank>=49:
        offset=rank-49
        group=offset%24
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
                tile['resource']=rng.choice(['field','stone','clay'])
    elif rank>4 and rank%7==3:
        tile.update(resource='prospect')
    elif rank>4 and rank%7==6:
        index=(rank-6)//7
        woods=list(WOODS[1:])
        random.Random(f"{g['seed']}/early woods/{index//4}").shuffle(woods)
        tile['resource']=woods[index%4]
    elif rank>4 and rank%7==0:
        tile['resource']=rng.choice(['field','stone','clay'])
    return tile

def new_game(seed, now):
    g = dict(seed=seed,now=now,coins=30,xp=0,cargo=[],tiles={},sites={},citizens=[],
             technologies=['Settlement basics'],research=None,walking=False,walk_started=None,
             fix=None,road_track=None,roads={},jobs=[],vouchers=0,receipts=[],grants=[],
             orders={},truck_kit=False)
    start = world_tile(g,0,0)
    g['sites'][start['id']] = home = make_site(start,'town store',[],now)
    home['built']=True
    resident(g,home,0)
    resident(g,home,2)
    return g

def resident(g,home,education):
    n=len(g['citizens'])
    g['citizens'].append(dict(id=n,home=home['id'],education=education,assignment=None))

def education(g):
    return 100*sum(c['education'] for c in g['citizens'])/(3*len(g['citizens']))

def capacity(g):
    xp = g['xp']
    return 40+10*g['truck_kit'] if xp>=500 else 12 if xp>=150 else 4 if xp>=40 else 1

def home_places(s):
    return math.floor(HOMES[s['kind']][0]*SPEED[s['level']-1]) if s['kind']!='town store' else 2

def cap(s, buffer):
    scale = STORAGE[s['level']-1]
    if buffer=='pantry':
        return max(40,10*home_places(s))
    if buffer=='shared':
        return math.floor(SITES[s['kind']]['shared']*scale)
    return math.floor(12*scale)

def reserve(g,s,buffer):
    return sum(count(j['lots']) for j in g['jobs'] if not j['done'] and j['dst']==s['id'] and j['buffer']==buffer)

def assign(g,s,credential):
    eligible = [c for c in g['citizens'] if c['assignment'] is None and c['education']>=credential]
    if eligible:
        c = min(eligible,key=lambda c:c['education'])
        c['assignment']=['work',s['id']]
        s['worker']=c['id']

def rounded_quality(g,local):
    return min(100,max(0,math.floor(.9*local+.1*education(g)+.5)))

def selected_inputs(r,choices):
    return [(q,choices[idx] if idx<len(choices) else names[0]) for idx,(q,names) in enumerate(r['inputs'])]

def begin_batch(g,s):
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
        for q,good in selected_inputs(r,s['choices']):
            lots.extend(take(stock,good,q,s.get('minimum',0),s.get('highest',False)))
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
    s['batch']=dict(at=g['now']+r['seconds']/SPEED[s['level']-1],recipe=s['recipe'],
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

def advance(g, until):
    require(until>=g['now'],'Clock cannot go backwards')
    while True:
        times=[]
        if g['research']:
            times.append(g['research']['at'])
        times.extend(t['survey']['at'] for t in g['tiles'].values() if t['survey'])
        times.extend(j['at'] for j in g['jobs'] if not j['done'])
        for s in g['sites'].values():
            for key in ('batch','course'):
                if s[key] and s[key]['at'] is not None:
                    times.append(s[key]['at'])
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
            course=s['course']
            if course and course['at']==now:
                for i in course['students']:
                    g['citizens'][i].update(education=SCHOOLS[s['kind']][0]+1,assignment=None)
                if s['visiting']:
                    s['visiting']=False
                    assign(g,s,3)
                s['course']=None
            if s['built'] and s['kind'] in HOMES and s['tax_at']+3600==now:
                _,rate,limit=HOMES[s['kind']]
                s['tax']=min(limit*STORAGE[s['level']-1],s['tax']+rate*SPEED[s['level']-1])
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
        for s in g['sites'].values():
            begin_batch(g,s)

def unlock_cost(g,kind,rope=False):
    if kind in ('lumberjack station','sawmill') and kind not in g['grants']:
        return []
    if kind=='warehouse' and rope:
        return quantities('6 plank + 4 rope')
    return SITES[kind]['cost']

def eligible(tile,kind):
    t=tile['resource']
    if kind=='lumberjack station':
        return t in WOODS
    if kind=='mine':
        return bool(tile['report'] and tile['report']['mineral'])
    if kind in EXTRACTORS.values():
        return EXTRACTORS.get(t)==kind
    if kind=='field':
        return t=='field'
    return True

def nearby(g,tile):
    fix=g['fix']
    return bool(fix and 0<=g['now']-fix['at']<=60 and
                math.dist((fix['x'],fix['y']),(tile['x'],tile['y']))<=40)

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
    return max(road['paid'],sum(road['passages']>=n for n in (1,3,10,30)))

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

def planting(g,s,name,compost):
    definition=CROPS[name]
    require(s['worker'] is not None,'Assign a farmer first')
    require(definition['tech'] in g['technologies'],'Research '+definition['tech'])
    soil=g['tiles'][s['id']]['soil']==definition['soil']
    fertilizer=take(g['cargo'],'compost',1)[0]['q'] if compost else 0
    land=min(100,(80 if soil else 55)+fertilizer*.1)
    return dict(name=name,at=g['now']+definition['seconds']/SPEED[s['level']-1],pollinated=False,
                qty=(4 if soil else 2)+2*bool(compost),q=rounded_quality(g,.75*land+.25*s['skill']))

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
        require((not s['built'] if buffer=='materials' else s['built'] and not s.get('reclaim') and (buffer=='conversion' or s['level']<10)),'No eligible project')
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
    metres=abs(a['x']-b['x'])+abs(a['y']-b['y'])
    require(metres>0,'Choose different sites')
    row=int(a['y']/60)
    low,high=sorted([int(a['x']/60),int(b['x']/60)])
    paved=sum(60 for i in range(low,high) if point(i,row) in g['roads'] and road_tier(g['roads'][point(i,row)])==4)
    lo_y,hi_y=sorted([int(a['y']/60),int(b['y']/60)])
    column=int(b['x']/60)
    for j in range(lo_y,hi_y):
        road=g['roads'].get(point(column,j)+':v')
        if road and road_tier(road)==4:
            paved+=60
    return dict(metres=metres,fee=2+math.ceil((metres-.25*paved)/250),seconds=120+60*math.ceil(metres/200))

def positive(a,key='qty',maximum=1200):
    n=a.get(key)
    require(type(n) is int and 1<=n<=maximum,f'{key} must be an integer from 1 to {maximum}')
    return n

EXPORT_TIERS = ((8,16,40,1.25),(4,8,65,1.75),(2,5,80,2.5))

def offers(g):
    window=int(g['now']//86400)
    known=set()
    for s in g['sites'].values():
        if not s['built']:
            continue
        for key in recipe_options(s,g['tiles'][s['id']]):
            r=RECIPES[key]
            if r['tech'] in g['technologies']:
                known.update(good for _,good in r['outputs'])
        if s['crop']:
            known.add(s['crop']['name'])
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
    return ['0,0']+[next(s['id'] for s in g['sites'].values() if s['kind']==kind and s['built'])
                   for kind in CIVIC_SITES
                   if any(s['kind']==kind and s['built'] for s in g['sites'].values())]

def market_choices(g):
    producers=set()
    for s in g['sites'].values():
        if s['built']:
            for key in recipe_options(s,g['tiles'][s['id']]):
                r=RECIPES[key]
                if r['inputs'] and r['tech'] in g['technologies']:
                    producers.update(good for _,good in r['outputs'] if PRICES[good]>1)
    return sorted(producers)

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
    level=g['sites'][slot]['level'] if slot!='0,0' else 1
    payout=math.ceil(1.5*qty*PRICES[good]*(1+.02*(level-1))-1e-9)
    return dict(id=f'{slot}/{sequence}',sequence=sequence,good=good,qty=qty,payout=payout,active=True)

def market_command(g,a):
    slot=a['slot']
    require(slot in market_slots(g),'No market slot at this site')
    offer=market_offer(g,slot)
    require(offer and offer.get('id')==a['order'],'Market order is unavailable')
    if a['op']=='fill market order':
        take(g['sites']['0,0']['shared'],offer['good'],offer['qty'])
        g['coins']+=offer['payout']
    g.setdefault('market',{})[slot]=dict(offer,active=False,refresh=g['now']+43200)

def reclaim(g,s):
    if s['materials']:
        s.update(kind='warehouse',built=True,shared=s['materials'],materials=[],reclaim=True)
    else:
        del g['sites'][s['id']]

def command(g,a):
    need_staff=None
    op=a['op']
    s=g['sites'].get(a.get('site'))
    tile=g['tiles'].get(a.get('site'))
    if op in ('fill market order','dismiss market order'):
        market_command(g,a)
    elif op in ('accept export','ship export','abandon export'):
        exchange(g,a,s)
    elif op=='walk':
        g['walking']=bool(a['enabled'])
        g['walk_started']=g['now'] if g['walking'] else None
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
        require(tile and kind in SITES and kind!='town store' and not s and eligible(tile,kind),'No eligible footprint')
        g['sites'][tile['id']]=make_site(tile,kind,unlock_cost(g,kind,a.get('rope')),g['now'])
    elif op=='move blueprint':
        dst=g['tiles'].get(a['destination'])
        require(s and not s['built'] and dst and dst['id'] not in g['sites'] and
                eligible(dst,s['kind']) and not reserve(g,s,'materials'),'No eligible move for this blueprint')
        target=make_site(dst,s['kind'],s['cost'],g['now'])
        g['sites'][dst['id']]=target
        reclaim(g,s)
    elif op=='cancel':
        require(s and not s['built'],'Select an unfinished blueprint')
        require(not reserve(g,s,'materials'),'Wait for incoming delivery')
        reclaim(g,s)
    elif op=='research':
        name=a['name']
        require(name in TECH and name not in g['technologies'] and not g['research'],'Research unavailable')
        tier,requirements=TECH[name]
        require(all(t in g['technologies'] for t in requirements),'Research prerequisites first')
        fee,seconds=RESEARCH[tier]
        pay(g,fee)
        g['research']=dict(name=name,at=g['now']+seconds)
    elif op=='survey':
        require(tile and tile['resource']=='prospect' and not tile['survey'],'No available prospect')
        tier=positive(a,'tier',3)
        report=tile['report']
        require(not report or not report['mineral'] and tier>report['tier'],'Coverage already reached')
        fee,seconds=SURVEY[tier-1]
        if a.get('scope'):
            take(g['sites']['0,0']['shared'],'survey scopes',1)
            seconds/=2
        pay(g,fee)
        tile['survey']=dict(tier=tier,at=g['now']+seconds)
    elif op in ('deposit paving','finish paving'):
        key=a['road']
        road=g['roads'].get(key)
        require(road is not None,'Walk this section first')
        require(nearby(g,road_anchor(key)),'A reliable fix within 40 m of the road is required')
        tier=road_tier(road)+1
        require(tier<=4 and tier==a.get('tier'),'Road tier has changed')
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
        require(nearby(g,road_anchor(a['road'])),'A reliable fix within 40 m of the road is required')
        qty=positive(a,maximum=3)
        require(count(g['cargo'])+qty<=capacity(g),'Cargo is full')
        g['cargo'].extend(take(road['paving'],'paving blocks',qty))
    elif op=='road':
        road=g['roads'].get(a['road'])
        require(road is not None,'Walk this section first')
        tier=road_tier(road)+1
        require(tier<=4 and tier==a.get('tier'),'Road tier has changed')
        pay(g,(4,12,30)[tier-2])
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
        qty=positive(a,maximum=12)
        source=a.get('source_buffer','output')
        require(source in ('output','shared','input'),'Invalid source buffer')
        good=a['good']
        require(good in PRICES and good not in ('log','plank'),'Select an exact commodity')
        buf=a['buffer']
        destination(g,dst,buf,good,qty)
        terms=quote(g,s['id'],dst['id'])
        lots=take(s[source],good,qty,a.get('minimum',0),a.get('highest',False),a.get('quality'))
        if a.get('voucher'):
            require(g['vouchers']>0,'No haul vouchers')
            g['vouchers']-=1
        else:
            pay(g,terms['fee'])
        g['jobs'].append(dict(id=len(g['jobs']),src=s['id'],dst=dst['id'],buffer=buf,
            lots=lots,at=g['now']+terms['seconds'],done=False,fee=0 if a.get('voucher') else terms['fee']))
    else:
        require(s,'Select a site')
        if op in ('build','pickup','deliver','plant','harvest','clear crop','herd','upgrade','convert','fit kit'):
            require(nearby(g,tile),'A reliable fix within 40 m is required')
        if op=='build':
            require(not s['built'] and meets(s['materials'],s['cost']),'Construction materials missing or building already complete')
            free=s['kind'] in ('lumberjack station','sawmill') and not s['cost']
            require(not free or s['kind'] not in g['grants'],'Starter grant already spent')
            s.update(built=True,materials=[],since=g['now'],tax_at=g['now'])
            g['xp']+=5
            if free:
                g['grants'].append(s['kind'])
            if s['kind'] in HOMES:
                for _ in range(home_places(s)):
                    resident(g,s,0)
            if s['kind'] in SCHOOLS:
                assign(g,s,SCHOOLS[s['kind']][1])
                if s['kind']=='university' and s['worker'] is None and not g.get('fellowship'):
                    s['visiting']=True
                    g['fellowship']=True
            credential=SITES[s['kind']]['credential']
            if credential is not None:
                assign(g,s,credential)
            options=recipe_options(s,tile)
            if options and s['kind'] not in ('paddock','apiary','fish pond'):
                s['recipe']=options[0]
            if free and s['kind']=='lumberjack station':
                add(s['output'],tile['resource']+' log',1,rounded_quality(g,.85*tile['grade']+.15*s['skill']))
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
                require(type(minimum) is int and 0<=minimum<=100,'Quality floor must be 0–100')
                inputs=selected_inputs(r,choices)
                pending=(lot for j in g['jobs'] if not j['done'] and j['dst']==s['id'] and j['buffer']=='input'
                         for lot in j['lots'])
                require(all(any(matches(good,lot['good']) for _,good in inputs) for lot in pending),
                        'Wait for incompatible inbound stock')
                s.update(recipe=a['name'],choices=choices,minimum=minimum,highest=bool(a.get('highest')))
            elif op=='plant':
                name=a['name']
                require(name in CROPS and CROPS[name]['plot']==SITES[s['kind']]['plot'] and not s['crop'],'Crop does not fit or plot is occupied')
                s['crop']=planting(g,s,name,a.get('compost'))
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
                require(s['kind']=='town store','Sell from the town store')
                qty=positive(a)
                good=a['good']
                require(good in PRICES,'Unknown item')
                take(s['shared'],good,qty,a.get('minimum',0),a.get('highest',False),a.get('quality'))
                g['coins']+=qty*PRICES[good]
            elif op=='train':
                require(s['worker'] is not None and s['skill']<100,'Assign a crew below skill 100')
                pay(g,s['skill'])
                s['skill']=min(100,s['skill']+5)
            elif op=='staff':
                need_staff=SCHOOLS[s['kind']][1] if s['kind'] in SCHOOLS else SITES[s['kind']]['credential']
                require(need_staff is not None,'Site has no staffing position')
                staff(g,s,a.get('citizen'),need_staff)
            elif op=='enrol':
                require(s['kind'] in SCHOOLS and not s['course'] and (s['worker'] is not None or s['visiting']),'An available instructor is required')
                level,_,seats,duration=SCHOOLS[s['kind']]
                ids=a['students']
                require(isinstance(ids,list) and 0<len(ids)<=int(seats*SPEED[s['level']-1]) and len(set(ids))==len(ids),'Invalid student count')
                for i in ids:
                    require(type(i) is int and 0<=i<len(g['citizens']),'Unknown resident')
                    c=g['citizens'][i]
                    require(c['education']==level and c['assignment'] is None,'Student is unavailable or ineligible')
                    c['assignment']=['study',s['id']]
                if a.get('slates'):
                    require(level==0,'Writing slates apply to primary courses')
                    take(s['input'],'writing slates',len(ids))
                    duration*=.75
                s['course']=dict(students=ids,at=g['now']+duration,remaining=None)
            elif op=='upgrade materials':
                require(s['kind'] in CIVIC_SITES and 4<=s['level']+1<=10 and not s['upgrade'] and
                        not reserve(g,s,'upgrade'),'Empty civic upgrade storage first')
                material=a['good']
                require(material in ('bricks','glazed tiles','dressed marble','roof slates'),'Invalid civic material')
                s['upgrade_stonework']=material
            elif op=='upgrade':
                require(s['level']<10 and a.get('level')==s['level']+1 and meets(s['upgrade'],upgrade_cost(s)),'Upgrade unavailable or materials missing')
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
                        'Conversion requires full materials and household coverage')
                old=home_places(s)
                s.update(kind=a['kind'],since=g['now'],tax_at=g['now'],conversion=[])
                for _ in range(home_places(s)-old):
                    resident(g,s,0)
            elif op=='fit kit':
                require(s['kind']=='machine works' and g['xp']>=500 and not g['truck_kit'],'An unmodified truck and machine works are required')
                take(g['cargo'],'vehicle kit',1)
                g['truck_kit']=True
            else:
                raise RuleError('Unknown command')
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

def view(g):
    public={k:v for k,v in g.items() if k not in ('seed','tiles','sites','receipts','road_track','market','offer_board','wall_at')}
    public['capacity']=capacity(g)
    public['offers']=offers(g)
    public['market_orders']={slot:market_offer(g,slot) for slot in market_slots(g)}
    public['education']=education(g)
    public['tiles']={}
    for key,tile in g['tiles'].items():
        public['tiles'][key]={k:v for k,v in tile.items() if k not in ('truth','difficulty') and (
            k!='grade' or tile['resource']!='prospect' or tile['report'] and tile['report']['mineral'])}
        public['tiles'][key]['nearby']=nearby(g,tile)
    public['sites']={}
    for key,s in g['sites'].items():
        data=public['sites'][key]=s.copy()
        data['capacity']={b:cap(s,b) for b in ('input','output','shared') if s['kind'] in SITES}
        data['options']=recipe_options(s,g['tiles'][key])
        data['next_cost']=upgrade_cost(s) if s['level']<10 else []
        if s['kind'] in CONVERSIONS:
            data['conversion_cost']=conversion_cost(s)
            data['conversion_kind']=CONVERSIONS[s['kind']][0]
        if s['built'] and s['kind'] in HOMES:
            data['household']=household(g,s)
            data['capacity']['pantry']=cap(s,'pantry')
    return public
