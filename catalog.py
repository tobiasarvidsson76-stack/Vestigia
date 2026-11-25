"""Versioned economy catalog."""
import math
import re

VERSION = 1
SPEED = (1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 3.5, 4)
STORAGE = (1, 1.5, 2, 2.5, 3, 4, 5, 6.5, 8, 10)
WOODS = ('pine', 'spruce', 'birch', 'oak', 'ash')
SURFACE = ('stone', 'clay', 'sand', 'gravel', 'limestone', 'reeds', 'resin', 'berries',
           'mushrooms', 'cork', 'willow', 'bamboo', 'basalt', 'brine', 'amber')
MINERALS = ('copper ore', 'iron ore', 'coal', 'gold ore', 'diamond', 'tin ore', 'zinc ore',
            'silver ore', 'rock salt', 'kaolin', 'quartz', 'graphite', 'sulphur', 'bauxite',
            'gypsum', 'ochre', 'nickel ore', 'chromite', 'feldspar', 'marble', 'slate', 'garnet')
TECH = {
    'Settlement basics': (0, []), 'Agriculture': (1, ['Settlement basics']),
    'Craft production': (1, ['Settlement basics']), 'Prospecting': (1, ['Settlement basics']),
    'Food processing': (2, ['Agriculture']), 'Building materials': (2, ['Craft production', 'Prospecting']),
    'Household trades': (2, ['Craft production', 'Agriculture']), 'Smelting': (2, ['Prospecting']),
    'Metalworking': (3, ['Smelting', 'Craft production']), 'Jewellery': (3, ['Smelting', 'Building materials']),
    'Precision engineering': (4, ['Metalworking', 'Building materials']),
    'Horticulture': (2, ['Agriculture']),
    'Animal husbandry': (2, ['Agriculture']),
    'Aquaculture': (3, ['Animal husbandry']),
    'Specialty crops': (3, ['Horticulture']),
    'Quarrying': (2, ['Prospecting']),
    'Deep mining': (3, ['Prospecting', 'Smelting']),
    'Food preservation': (3, ['Food processing', 'Horticulture']),
    'Industrial alloys': (4, ['Deep mining', 'Metalworking']),
}
ALIASES = {'planks':'plank','tools':'tool','egg':'eggs','gears':'gear','stopper':'stoppers',
           'carrot':'carrots','quilt':'quilts','1 clover':'clover','panel':'furniture panels','grit':'abrasive grit','shelves':'shelves'}
CLASSES = {'A': ('3 plank',5,1), 'B': ('4 plank + 3 bricks',10,3),
           'C': ('6 bricks + 2 iron bars',15,5), 'D': ('8 bricks + 2 tools',25,8)}
SITES = {}
RECIPES = {}
CROPS = {}

def item(name):
    name = name.strip().lower()
    if name.endswith(' bars'):
        name = name[:-1]
    return ALIASES.get(name, name)

def quantities(spec):
    if not spec:
        return []
    result = []
    for part in spec.split(' + '):
        match = re.fullmatch(r'(?:(\d+) )?(.+)', part.strip())
        result.append([int(match[1] or 1), [item(n) for n in match[2].split(' or ')]])
    return result

def site(name, cost='', credential=None, shared=0, plot=None):
    SITES[name] = dict(cost=quantities(cost), credential=credential, shared=shared, plot=plot)

def recipe(facility, spec, minutes, tech, bonus=1, label=None):
    ins, outs = spec.split(' → ')
    output = [[count, names[0]] for count, names in quantities(outs)]
    key = facility + ' / ' + (label or outs)
    if key in RECIPES:
        key += ' (' + ins + ')'
    RECIPES[key] = dict(site=facility, inputs=quantities(ins), outputs=output,
                        seconds=minutes*60, tech=tech, bonus=bonus)
    return key

site('town store', shared=60)
site('local marketplace','4 plank + 2 stone',shared=60)
site('market hall','6 plank + 4 mortar + 2 fittings',shared=60)
site('warehouse', '6 plank + 4 fittings', shared=120)
site('export depot','6 plank + 4 bricks',shared=60)
for name,cost in {
 'cottage':'2 plank','primary school':'4 plank + 2 stone',
 'high school':'5 plank + 3 stone',
 'technical college':'6 plank + 4 bricks','university':'8 bricks + 4 iron bars + 4 paper',
 'library':'6 bricks + 4 glass + 4 books',
 'police station':'4 plank + 4 stone','fire station':'4 plank + 4 bricks',
 'clock tower':'8 stone + 4 brass + 2 clocks',
}.items():
    site(name,cost)
for name in ('field','garden','orchard','trellis','meadow','rubber grove'):
    site(name,'3 plank' if name=='rubber grove' else '2 plank',0,plot=name)
for name, cost, credential in (
 ('lumberjack station','3 plank',0), ('sawmill','3 plank',0),
 ('mine','4 plank + 2 bricks',1), ('kiln','4 stone + 3 plank',1),
 ('bakery','4 stone + 3 plank',1), ('foundry','6 bricks + 4 plank',2),
 ('workshop','6 bricks + 2 iron bars',2), ('jeweller','6 bricks + 2 tools',2),
 ('paddock','3 plank',0), ('apiary','3 plank',0), ('fish pond','3 plank',0),
):
    site(name,cost,credential)
EXTRACTORS = dict(zip(SURFACE, ('quarry','clay pit','sand pit','gravel pit','limestone quarry',
    'reed bed','resin tap','forager hut','forager hut','cork stand','willow coppice',
    'bamboo grove','basalt quarry','salt spring','amber bank')))
RESOURCE_TECH = {
    **{name:'Prospecting' for name in (*SURFACE,*MINERALS)},
    **{name:'Settlement basics' for name in ('stone','clay')},
    **{name:'Quarrying' for name in ('sand','gravel','limestone','basalt')},
    **{name:'Deep mining' for name in ('nickel ore','chromite','bauxite','graphite')},
}
for material, facility in EXTRACTORS.items():
    site(facility,'3 plank',0)
    recipe(facility,' → 1 '+material,8,RESOURCE_TECH[material])
for material in MINERALS:
    recipe('mine',' → 1 '+material,15,RESOURCE_TECH[material])
for wood in WOODS:
    recipe('lumberjack station',' → 1 '+wood+' log',15,'Settlement basics')
    recipe('sawmill','1 '+wood+' log → 1 '+wood+' plank',3,'Settlement basics')
for facility,spec,mins,tech in (
 ('kiln','2 clay → 2 bricks',10,'Settlement basics'),
 ('bakery','2 wheat → 2 bread',10,'Settlement basics'),
 ('foundry','1 copper ore + 1 coal → 1 copper bar',12,'Smelting'),
 ('foundry','1 iron ore + 1 coal → 1 iron bar',12,'Smelting'),
 ('workshop','1 iron bar + 1 copper bar → 1 tool',15,'Metalworking'),
 ('jeweller','1 gold ore + 1 diamond → 1 jewellery',30,'Jewellery'),
 ('workshop','2 spruce plank → 1 roof truss',15,'Craft production'),
 ('workshop','2 oak plank + 1 fittings → 2 barrels',15,'Craft production'),
 ('workshop','1 ash plank → 3 tool handles',15,'Craft production'),
):
    recipe(facility,spec,mins,tech)

GROUPS = {
 'Agriculture':'feed mill|hay barn|compost yard',
 'Craft production':'fibre shed|basket maker|ropewalk|paper mill|pottery|furniture shop',
 'Building materials':'lime kiln|mason|stonecutter|glassworks',
 'Household trades':'weaving house|dye works|tailor|tannery|cobbler|chandlery|print shop',
 'Smelting':'foundry','Metalworking':'workshop','Jewellery':'jeweller',
 'Industrial alloys':'alloy works','Food preservation':'preserve kitchen|drying house|bottling house',
 'Precision engineering':'instrument maker|rubber works|machine works',
}
FACILITY_TECH = {name:tech for tech,names in GROUPS.items() for name in names.split('|')}

import json
from pathlib import Path

DATA = json.loads(Path(__file__).with_name('catalog_v1.json').read_text())

def manufacture(name, tier, batches):
    name = name.lower()
    cost, minutes, bonus = CLASSES[tier]
    if name not in SITES:
        credential = 1 if tier in 'AB' else 2
        if name in ('instrument maker','machine works'):
            credential = 3
        site(name,cost,credential)
    for batch in batches.split('; '):
        tech=FACILITY_TECH.get(name,'Food processing')
        if name=='foundry' and ('nickel ore' in batch or 'chromite' in batch):
            tech='Industrial alloys'
        recipe(name,batch,minutes,tech,bonus)

for row in DATA['manufacturing']:
    manufacture(*row)

for name,tier,batches in [
 ('grain mill','A','2 rice → 3 rice flour; 2 spelt → 3 flour; 2 buckwheat → 3 buckwheat flour'),
 ('feed mill','A','1 millet → 3 grain feed'),
 ('town kitchen','B','1 rice + 1 spinach → 2 rice bowls; 1 rice + 1 saffron → 3 saffron rice; 1 lentils + 1 leeks → 2 soup; 1 chickpeas + 1 garlic → 2 falafel; 1 buckwheat flour + 1 rice flour → 3 noodles'),
 ('oil press','B','2 walnuts → 2 walnut oil; 2 peanuts → 2 oil + 1 press cake'),
 ('condiment kitchen','B','2 peanuts → 2 peanut butter; 2 sesame → 2 tahini; 1 mustard + 1 vinegar → 2 prepared mustard'),
 ('preserve kitchen','B','2 peaches or blackberries + 1 sugar → 3 jam; 2 lemons + 1 sugar → 3 marmalade; 2 beetroot + 1 vinegar → 3 pickles'),
 ('drying house','A','2 figs or blackberries → 2 dried fruit; 2 vanilla → 2 baking vanilla; 2 tea → 2 finished tea; 2 tea + 1 log → 3 smoked tea'),
 ('roastery','B','2 coffee → 2 roasted coffee; 2 almonds + 1 sugar → 3 marzipan'),
 ('bakery','A','1 marzipan + 1 baking vanilla + 1 flour → 3 almond cakes'),
 ('basket maker','A','2 willow or bamboo → 2 baskets'),('ropewalk','B','2 hemp → 3 rope'),
 ('furniture shop','C','1 birch plank → 2 shelves; 2 bamboo + 1 rope → 2 furniture panels; 1 panel + 1 walnut oil → 2 polished cabinets'),
 ('bottling house','B','1 cork → 4 stoppers; 2 cider + 1 glass + 1 stopper → 2 bottled cider; 2 pear juice + 1 glass + 1 stopper → 2 bottled pear juice'),
 ('saltworks','A','2 brine → 2 rock salt'),('pottery','B','1 feldspar + 1 kaolin → 3 glazed tiles'),
 ('foundry','C','1 nickel ore + 1 coal → 1 nickel bar; 1 chromite + 1 coal → 1 chromium bar'),
 ('alloy works','C','2 iron bars + 1 nickel bar + 1 chromium bar → 3 stainless steel'),
 ('stonecutter','C','1 garnet → 3 abrasive grit; 1 basalt + 1 mortar → 3 paving blocks; 2 marble + 1 grit → 3 dressed marble; 1 slate → 2 roof slates; 1 slate + 1 plank → 2 writing slates; 1 amber + 1 grit → 2 polished amber'),
 ('jeweller','D','1 polished amber + 1 silver bar → 2 amber brooches; 1 garnet + 1 gold bar → 2 garnet rings'),
 ('workshop','C','1 stainless steel + 1 plank → 3 cutlery sets'),
]:
    manufacture(name,tier,batches)

ANIMALS = {}
for animal,feed,duration,output in DATA['animals']:
    facility = {'Bees':'apiary','Trout':'fish pond'}.get(animal,'paddock')
    ANIMALS[animal] = recipe(facility,feed+' → '+output,int(duration.split()[0]),
                             'Aquaculture' if animal=='Trout' else 'Animal husbandry',label=animal)
for plot,soil,entries in DATA['crops']:
    for crop,hours in re.findall(r'([a-zA-Z ]+?) (\d+) h',entries):
        crop = crop.strip().lower()
        plot_name=plot.lower()
        tech=('Settlement basics' if crop in ('wheat','potatoes','beans') else
              'Specialty crops' if crop in ('tea','coffee','vanilla','saffron','rice') else
              'Horticulture' if plot_name in ('orchard','trellis') else 'Agriculture')
        CROPS[crop] = dict(plot=plot_name,soil=soil.lower(),seconds=int(hours)*3600,tech=tech)
CROPS['latex'] = dict(plot='rubber grove',soil='sandy',seconds=28800,tech='Prospecting')

def matches(requirement, commodity):
    return commodity == requirement or requirement in ('log','plank') and commodity.endswith(' '+requirement)

RAW = set(SURFACE + MINERALS) | set(CROPS) | {w+' log' for w in WOODS}
PRICES = {name:1 for name in RAW}
PRICES.update({name:1 for key in ANIMALS.values() for _,name in RECIPES[key]['outputs']})
PRICES.update({name:1 for name in ('grain feed','stock feed','hay')})
PRICES.update({name:2 for name in ('plank','bricks','bread',*(w+' plank' for w in WOODS))})
PRICES.update({name:4 for name in ('iron bar','copper bar')})
PRICES.update(tool=10,jewellery=25,log=1)
FIXED = PRICES.copy()
while True:
    previous = PRICES.copy()
    for r in RECIPES.values():
        costs = [[PRICES[n] for n in names if n in PRICES] for _,names in r['inputs']]
        if not all(costs):
            continue
        new = [(q,n) for q,n in r['outputs'] if n not in FIXED]
        if not new:
            continue
        cost = sum(q*min(c) for (q,_),c in zip(r['inputs'],costs)) + r['bonus']
        cost -= sum(q*FIXED[n] for q,n in r['outputs'] if n in FIXED)
        value = max(2,math.ceil(cost/sum(q for q,_ in new)))
        for _,n in new:
            PRICES[n] = min(PRICES.get(n,value),value)
    if PRICES == previous:
        break
