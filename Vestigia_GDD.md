# Vestigia | Game design and Codex implementation brief

Single-player mobile city builder · Full-game delivery

## Assignment

Implement this entire document in one assignment and deliver one runnable, integrated game. Use GitHub and Codespaces with the cloud development workflow already established for WalkFreight. Keep this game in its own repository, with its own application IDs, database, authentication configuration and save data. Reuse tooling patterns where convenient. Supply a one-command development startup, migrations, seed data, mobile development build instructions and a reproducible acceptance run.

## Player experience

The player's first tile is a patch of familiar ground. Around it, the map is dark. Walking reveals a grove where the player builds a lumberjack station. Walking back the next day, the player sees yesterday's route beginning to wear into the map. A growing town eventually sends that same player down the same street carrying a truckload of timber. The settlement is personal. All residents, surveyors and hired haulers are simulated.

The owner-defined rules are discovery by walking, on-site construction and farming, capped inventories, persistent deposits, paid recon of varying quality, personal hauling progression, one-off hired transport, and roads improved by walking or payment. The following economy values, housing rules, map dimensions, location-session behavior and purchase model are initial design decisions for implementation. Keep them in versioned configuration.

## Where play happens

| From anywhere | Requires physical presence |
|---|---|
| Inspect revealed tiles, stocks, recipes, crop suitability and needs | Reveal new tiles by walking |
| Place, move or cancel an unbuilt blueprint on eligible revealed land | Deliver construction goods and finish the building |
| Commission recon at a discovered prospect and read its report | Discover the prospect and build its mine |
| Hire one NPC haul or pay for a road upgrade | Collect or unload personal cargo, plant and harvest |
| Choose production recipes, inspect jobs and purchase vouchers | Wear in roads by traversing them |

Blueprints cost nothing to plan. Each holds one site footprint. Materials can arrive in instalments and remain in site storage. Finish construction within 40 m of the interaction anchor once the listed materials are present. Cancellation with deposited materials converts the blueprint into a reclaimable stockpile. Show missing materials, distance and eligible actions before the player sets out.

## World and walking

Use Google Maps as the preferred mobile basemap. Overlay a persistent metric grid (roughly 60 m cells), fog, resource and building anchors, and road segments. On first valid fix reveal exactly the occupied cell. Reveal subsequently occupied cells during an explicit walking session. GPS sampling alone must never reveal a distant corridor across a gap. Retain discovered cells across sessions. Keep labels for unknown deposits generic, including in the mobile API.

Use a separate pedestrian network with access, crossing and grade information to choose reachable anchors. Place interaction points directly on eligible public pedestrian segments. Exclude private or restricted ways, motorways and disconnected fragments. A nearby road across water, railway tracks or a grade separation does not establish access. Filter blueprint placement by the same rules. Generate deterministically per world and cell, persist claimed anchors, and provide a free “site inaccessible” replacement on a different eligible segment preserving site contents, recon results and discovery state. If coverage is missing, allow an anchor on a verified player walk after checking access exclusions. Defer placement if no suitable anchor exists.

Use optional screen-locked tracking during a player-started walk, with explicit start/stop, duration and visible tracking status. Idle or terminated app time advances the economy. Movement requires recorded fixes. Start with horizontal accuracy ≤30 m and a sustained speed ceiling of 9 km/h, tolerate occasional spikes, and suspend credit during long gaps. Use recent reliable fixes for on-site actions. Queue walking samples across brief connectivity losses and replay once. Show pending sync. Require connection for inventory mutations. Minimize raw coordinate retention after reconciliation and support deleting a city and its location history.

## First walk and construction economy

Start with 30 coins, one cargo unit, a free town store at the first reachable anchor and a construction grant for one lumberjack station and one sawmill. Guarantee a grove on the first eligible newly explored segment. Show both grants in the planner. The mill accepts one log at a time, so the player can produce their first plank without improving capacity. Build a cottage for two planks. These actions must work from a fresh account without waiting for a purchase, survey result or random rare spawn.

All cargo uses integer units. Buildings have separate capped input and output buffers of 12 units each unless specified. The town store holds 60 shared units. Each production cycle consumes the complete recipe and credits the whole output atomically. Insufficient space or ingredients pauses the plant. On collection or delivery reconcile elapsed production first. Resume from the time capacity or inputs become available, with no bank of missed production. Preserve partial progress while a running cycle is eligible. Show next output time and the limiting buffer.

| Site | Build cost | Output or use |
|---|---|---|
| Lumberjack station / sawmill | First of each free, subsequent 3 planks each | 1 log per 5 min / 1 log → 1 plank in 3 min |
| Cottage / field | 2 planks each | 4 residents / 1 crop plot |
| Quarry / clay pit | 3 planks each | 1 stone or clay per 8 min on matching visible site |
| Kiln / bakery | 4 stone + 3 planks each | 2 clay → 2 bricks / 2 wheat → 2 bread, each in 10 min |
| Mine | 4 planks + 2 bricks | 1 unit of its surveyed mineral per 15 min |
| Foundry | 6 bricks + 4 planks | 1 copper or iron ore + 1 coal → 1 matching metal bar in 12 min |
| Workshop | 6 bricks + 2 iron bars | 1 iron bar + 1 copper bar → 1 tool in 15 min |
| Jeweller | 6 bricks + 2 tools | 1 gold ore + 1 diamond → 1 jewellery in 30 min |

Wood, stone, clay and fields are visible on discovery. Copper, iron, coal, gold and diamonds require recon. Use a shuffled regional allocation of deposits with common construction resources weighted above luxury minerals. Guarantee a reachable field, stone and clay opportunity within the first 12 distinct eligible segments, and each industrial mineral within the next 36. Schedule guarantees against reachable explored segments rather than a straight-line circle. Keep sites productive indefinitely.

### Groves and lumber types

The guaranteed starter grove grows pine. Each later timber grove has one visible species. Draw from a shuffled bag of spruce, birch, oak and ash before repeating, using additional grove slots so mineral and crop guarantees still hold. Show the species and natural grade in the map preview. Species determines what the wood can make. Grade and worker skill determine quality under the existing rules.

| Grove | Sawmill output | Use |
|---|---|---|
| Pine | Pine planks | Starter cottages and general construction |
| Spruce | Spruce planks | Workshop: 2 spruce planks → 1 roof truss |
| Birch | Birch planks | Furniture shop: 1 birch plank → 2 shelves |
| Oak | Oak planks | Workshop: 2 oak planks + 1 fitting → 2 barrels |
| Ash | Ash planks | Workshop: 1 ash plank → 3 tool handles |

All species use the existing logging and sawing rates. One log yields one plank of the same species. A generic log or plank requirement accepts any mix, one for one, including staged construction deliveries. Players can reserve a species for a specialist recipe. Keep species and quality visible through stock selection, hauling and sale. Use pine for pre-existing untyped stock and groves.

Specialist goods are optional town orders. Use the facility's standard recipe time and quality rules. In acceptance, build a cottage with one pine and one birch plank, then verify that the barrel recipe accepts oak, rejects pine and preserves the quality of the selected inputs in its calculation.

## Fields, residents and money

Each field has a seeded soil class visible before construction. Loam favours wheat, sandy soil favours potatoes and heavy soil favours beans. Select one crop and plant on-site at no coin cost. After 60 minutes, harvest 4 units on favoured soil or 2 elsewhere into the field buffer. Show yield and maturity before planting. Ripe crops persist until visited. A full buffer blocks harvest and leaves the crop standing. Replanting requires a fresh on-site action.

Cottages begin occupied and generate 1 coin per occupied cottage per hour, held locally up to 12 coins, claimable from the sofa. Deliver 4 food units to a cottage to support 4 more residents for 24 hours and double that period's income. Potatoes, beans and bread each count as one food unit. A new delivery can extend support by one day up to two days ahead. Residents return to baseline when supply lapses. At the town store sell surplus goods on demand at 1 coin per raw unit, 2 per plank, brick or bread, 4 per bar, 10 per tool and 25 per jewellery. Coins pay for recon, hired trips and roads. Population, prosperity, map coverage and the first jewellery shipment give the player long-term goals. The city remains playable afterward.

## Settlement economy and production atlas

The starter recipes above stay available throughout the game. The following catalog is part of the same delivery. A player can run an orchard town, a cloth-making district, a mining settlement or a mix. Each district starts with goods it can sell directly and develops reasons to trade with the rest of the player's city. All intermediate goods can be stored, carried and dispatched individually. Nothing moves between buildings without a player action or a paid one-off haul.

### Land and crops

All 30 crops below are available when the player has the corresponding plot. Existing wheat, potatoes and beans retain their starter timings. Every crop grows on every farm soil. Suitability affects yield, so a player with poor local soil can still complete every chain. Display the exact real-time harvest time and yield in the blueprint preview. One plot grows one crop at a time. Annuals require on-site sowing after each harvest. Orchard trees, vines, hops and olives start the next growth period after on-site picking. They occupy the plot until the player clears it on-site. Produce never spoils during an absence.

| Plot and favoured soil | Crops and time to harvest | Where the harvest goes |
|---|---|---|
| Field, loam | Wheat 1 h, barley 2 h, rye 3 h, oats 2 h, maize 4 h | Flour, malt, dark bread, porridge, stock feed |
| Field, sandy | Potatoes 1 h, carrots 2 h, sugar beet 4 h, flax 4 h | Household meals, fodder, sugar, linen |
| Field, heavy | Beans 1 h, cabbage 2 h, peas 2 h, turnips 3 h | Soup, pickles and winter fodder |
| Field, loam | Sunflowers 4 h, rapeseed 4 h, cotton 6 h | Cooking oil, press cake, cotton cloth |
| Garden, loam | Strawberries 2 h, tomatoes 3 h, onions 2 h, cucumbers 2 h | Preserves, sauces, soup and pickles |
| Garden, sandy | Lavender 4 h, madder 5 h | Soap and red dye |
| Orchard, loam | Apples 8 h, pears 8 h, plums 8 h, cherries 8 h | Juice, preserves, cider, pies |
| Orchard, sandy | Olives 8 h | Oil and soap |
| Trellis, sandy | Grapes 6 h | Juice and vinegar |
| Trellis, heavy | Hops 6 h | Brewery |
| Meadow, heavy | Clover 2 h | Hay and apiary forage |

Gardens, orchards, trellises and meadows each cost 2 planks like the starter field. Use the same 4/2 yield rule. Add a nearby staffed apiary bonus of +1 fruit per orchard harvest within 120 m, capped at one bonus. Evaluate the bonus while the orchard grows: at least one completed apiary cycle in that orchard's growth window qualifies. Show the expected base harvest separately from earned pollination.

### Further crops and regional specialities

Add these 24 crops to the original 30. All use the existing on-site planting and harvesting rules, 4/2 base yields, soil bonuses, education, lot quality and ten plot levels. Times below are level 1 growth times. Regional specialities are virtual crops: real-world latitude, season and climate never lock the player out. Orchards and trellises regrow; the field and garden entries require resowing. Treat tea and coffee as perennial orchard crops. Only fruit and nut trees receive the orchard pollination bonus.

| Plot | Favoured soil | Crops and harvest times | Production choices |
|---|---|---|---|
| Field | Heavy | Rice 3 h, lentils 2 h, chickpeas 3 h | Rice flour or rice bowls; pulses for soup or falafel |
| Field | Sandy | Buckwheat 2 h, millet 2 h, peanuts 4 h | Noodles, poultry feed, peanut butter or oil |
| Field | Loam | Spelt 3 h, hemp 5 h, mustard 3 h | Flour, cordage, prepared mustard |
| Garden | Heavy | Leeks 2 h, spinach 2 h, beetroot 3 h | Soup, rice bowls, preserved beetroot |
| Garden | Sandy | Garlic 3 h, sesame 4 h, saffron 8 h | Seasoning, tahini, premium saffron rice |
| Orchard | Loam | Peaches 7 h, walnuts 9 h, coffee 10 h | Preserves, furniture oil, roasted coffee |
| Orchard | Sandy | Almonds 8 h, lemons 7 h, figs 7 h | Marzipan, marmalade, dried fruit |
| Orchard | Heavy | Tea 6 h | Finished tea or smoked tea |
| Trellis | Loam | Blackberries 4 h, vanilla 10 h | Jam, dried berries, baking vanilla |

### Animals and husbandry

Build paddocks on eligible revealed land (3 planks each). Choose a species and buy the first herd on-site for 5 coins. One herd represents a small group; each paddock keeps one species and has its own feed and output buffers. Additional paddocks increase throughput. The apiary uses hives and the fish pond uses a constructed pond, each costing the same as a paddock and following the same stocking rules. Fish ponds use virtual water on reachable land. Physical access to a shoreline is unnecessary.

Deliver feed personally or by hired haul. Feed and stored outputs determine how many complete cycles a herd can finish while the app is closed. Hungry animals pause production and survive indefinitely. Players collect output on-site or dispatch it to another building. Multiple products from one cycle enter storage together. By-products occupy space and can be collected, sold or used. The production rates below are game-balance values.

| Animal | Feed per cycle | Cycle | Whole-cycle output |
|---|---|---:|---|
| Chickens | 1 grain feed | 30 min | 3 eggs |
| Ducks | 1 grain feed | 45 min | 2 eggs + 1 down |
| Geese | 1 hay + 1 grain feed | 60 min | 3 down + 1 egg |
| Sheep | 1 hay | 90 min | 3 wool |
| Goats | 1 hay | 60 min | 3 goat milk |
| Dairy cattle | 1 hay + 1 stock feed | 90 min | 5 cow milk + 1 manure |
| Buffalo | 2 hay | 120 min | 4 buffalo milk + 1 manure |
| Pigs | 2 stock feed | 120 min | 2 pork + 1 hide |
| Rabbits | 1 carrot or 1 clover | 60 min | 2 angora fibre |
| Alpacas | 2 hay | 120 min | 4 fleece |
| Bees | 1 clover | 60 min | 2 honey + 1 beeswax |
| Trout | 1 stock feed | 90 min | 3 trout |

Herd size stays constant. Pork and hides represent the farm's regular livestock output. Manure can go straight to market or to a compost yard. Horses remain the player's personal transport unlock.

### Raw materials and deposits

| Discovery | New resources | Extraction and purpose |
|---|---|---|
| Visible surface sites | Sand, gravel, limestone, reeds, resin, berries, mushrooms | A sand pit, gravel pit, limestone quarry, reed bed, resin tap or forager hut produces the matching resource. Berries and mushrooms have separate patches. |
| Surveyed deposits | Tin ore, zinc ore, silver ore, rock salt, kaolin, quartz, graphite, sulphur | A mine extracts the identified deposit. These open alloy, food preservation, ceramic, optical, writing and rubber lines. |
| Surveyed deposits | Bauxite, gypsum, iron-rich ochre | Supply aluminium, plaster and pigment works. |
| Cultivated industrial stand | Rubber latex | Build a rubber grove on any eligible orchard plot. Tap it on-site every 8 h for 4 latex, then it regrows. |

Surface extractors cost 3 planks and produce 1 unit every 8 min. New mines follow the original mine costs, cycle and recon rules. A rubber grove costs 3 planks. Guarantee the original industrial mineral set in the original exploration window. Allocate the expanded materials from separate shuffled surface and mineral bags on subsequent eligible segments. Place at least one expanded surface site and one prospect from these bags per six newly explored eligible segments until each bag is exhausted. Guaranteed prospects contain the assigned material. Empty prospects use additional slots. Repeat the bags after exhaustion. All opportunities obey the pedestrian-access rules.

### Manufacturing recipes

Each row names one facility. Each semicolon-separated entry is a separately selectable recipe. Numbers are inventory units. An item with no number means one unit. Alternatives joined by “or” are interchangeable only within that recipe. The cycle time and build price follow the facility class. Class A costs 3 planks and takes 5 min per batch, B costs 4 planks + 3 bricks and takes 10 min, C costs 6 bricks + 2 iron bars and takes 15 min, D costs 8 bricks + 2 tools and takes 25 min. Existing buildings retain their original build prices and existing recipe timings. New recipes on those buildings use the listed class cycle time. Furnaces include ordinary process heat in their cycle unless coal is explicitly listed. Water is available at each processing site.

| Food, farms and drink | Class | Selectable batches |
|---|---|---|
| Feed mill | A | 1 wheat or barley or maize → 3 grain feed; 1 oats or turnips or press cake → 3 stock feed |
| Hay barn | A | 1 clover → 3 hay |
| Grain mill | A | 2 wheat → 3 flour; 2 rye → 3 rye flour; 2 oats → 3 rolled oats |
| Bakery | A | 2 flour → 3 bread; 2 rye flour → 3 dark bread; 1 flour + 1 egg + 1 cherries → 2 cherry pies |
| Malt house | B | 2 barley → 3 malt |
| Brewery | B | 2 malt + 1 hops → 3 ale |
| Orchard press | A | 2 apples → 2 apple juice; 2 pears → 2 pear juice; 2 grapes → 2 grape juice |
| Cider house | B | 2 apple juice → 2 cider; 2 grape juice → 2 vinegar |
| Sugar house | B | 2 sugar beet → 3 sugar |
| Preserve kitchen | B | 2 strawberries or plums or berries + 1 sugar → 3 jam; 2 cucumbers or cabbage + 1 vinegar → 3 pickles |
| Oil press | B | 2 sunflowers or rapeseed or olives → 2 oil + 1 press cake |
| Dairy | B | 2 cow milk → 2 butter; 2 goat milk → 2 goat cheese; 2 buffalo milk → 2 mozzarella |
| Town kitchen | B | 1 rolled oats + 1 honey → 2 porridge; 1 peas or beans + 1 onions → 2 soup; 1 tomatoes + 1 oil → 2 sauce; 1 flour + 1 sauce + 1 mozzarella → 3 flatbreads |
| Smokehouse | B | 2 trout + 1 log → 3 smoked fish; 2 pork + 1 rock salt → 3 cured pork |
| Compost yard | A | 1 manure + 1 clover → 3 compost; 1 press cake + 1 reeds → 2 compost |

| Cloth, household goods and civic trades | Class | Selectable batches |
|---|---|---|
| Fibre shed | A | 2 flax → 3 linen yarn; 2 cotton → 3 cotton yarn; 2 wool or fleece or angora fibre → 3 spun yarn |
| Weaving house | B | 2 linen yarn → 2 linen; 2 cotton yarn → 2 cotton cloth; 2 spun yarn → 2 wool cloth |
| Dye works | B | 2 madder → 3 red dye; 2 ochre → 3 pigment; 1 wool cloth + 1 red dye → 2 dyed cloth |
| Tailor | C | 2 linen → 2 shirts; 1 dyed cloth + 1 cotton cloth → 2 coats; 1 linen + 2 down → 2 quilts |
| Tannery | B | 1 hide + 1 rock salt → 2 leather |
| Cobbler | B | 1 leather + 1 linen yarn → 2 boots |
| Chandlery | B | 1 beeswax + 1 cotton yarn → 3 candles; 1 oil + 1 lavender → 2 scented soap |
| Paper mill | B | 2 reeds + 1 log → 4 paper |
| Print shop | C | 1 graphite + 1 oil → 2 ink; 2 paper + 1 ink → 3 books |
| Furniture shop | C | 2 planks + 1 linen → 2 chairs; 2 planks + 1 quilt → 2 beds |

| Construction, metalworking and advanced goods | Class | Selectable batches |
|---|---|---|
| Lime kiln | B | 2 limestone + 1 coal → 3 lime |
| Mason | B | 1 lime + 1 sand → 3 mortar; 1 gypsum + 1 lime → 3 plaster; 1 gravel + 1 mortar → 3 paving blocks |
| Glassworks | C | 2 sand + 1 limestone → 3 glass; 2 quartz + 1 coal → 2 optical glass |
| Pottery | B | 2 clay → 3 crockery; 2 kaolin + 1 quartz → 3 porcelain |
| Foundry | C | 1 tin ore + 1 coal → 1 tin bar; 1 zinc ore + 1 coal → 1 zinc bar; 1 silver ore + 1 coal → 1 silver bar; 1 gold ore + 1 coal → 1 gold bar; 2 bauxite + 1 coal → 1 aluminium bar |
| Alloy works | C | 1 copper bar + 1 tin bar → 2 bronze; 1 copper bar + 1 zinc bar → 2 brass; 2 iron bars + 1 coal → 2 steel |
| Workshop | C | 1 bronze + 1 plank → 2 fittings; 1 steel + 1 oil → 2 gears; 1 copper bar → 2 copper wire |
| Instrument maker | D | 1 brass + 1 optical glass → 2 survey scopes; 1 brass + 1 gear → 2 clocks |
| Rubber works | C | 2 latex + 1 sulphur → 2 rubber; 1 rubber + 1 steel → 2 tyres |
| Machine works | D | 2 gears + 1 copper wire + 1 aluminium bar → 1 motor; 1 motor + 2 tyres + 1 steel → 1 vehicle kit |
| Jeweller | D | 1 silver bar + 1 diamond → 2 silver rings; 1 gold bar + 1 diamond → 2 gold rings |

### Additional resources to discover

Add six surface materials and six recon deposits. Each row uses a separate site with a fixed natural grade. Surface sites use the established 3-plank extractor and 8-minute base cycle, while deposits use the existing survey and mine rules. Salt springs and forest materials have land-based interaction anchors.

| Discovery | Material and site | Main use |
|---|---|---|
| Surface | Cork at a cork oak stand | Bottle stoppers for export bottling |
| Surface | Willow at a coppice | Harvest baskets |
| Surface | Bamboo at a grove | Baskets or furniture panels |
| Surface | Basalt at a rock outcrop | Cut stone for road paving |
| Surface | Brine at a salt spring | Evaporated salt for the existing smokehouse and tannery |
| Surface | Amber at a gravel bank | Polished amber for silver jewellery |
| Recon | Nickel ore | Stainless steel with iron and chromium |
| Recon | Chromite | Chromium for stainless steel |
| Recon | Feldspar | Glazed tiles together with kaolin |
| Recon | Marble | Dressed marble for public buildings |
| Recon | Slate | Roof slates and writing slates |
| Recon | Garnet | Jewellery or abrasive grit for the stonecutter |

Keep the original starter and expanded discovery guarantees. Give these additions independent shuffled bags (six per bag). From the end of the starter mineral guarantee onward, add one extra surface opportunity and one extra prospect per eight newly explored eligible segments until both new bags are exhausted, then reshuffle. Extra sites follow all existing access checks. If a segment lacks a free eligible anchor, carry the placement forward. Reveal mineral identity and grade only after successful recon.

### Recipes for the expanded catalog

Use the existing class costs, cycle times, quality, alternative-input selection and price rules. New class A/B processing sites require E1; the stonecutter requires E2. Existing facilities keep their profession. All outputs can be sold or exported, and all edible finished dishes count as 2 food units per item. Drinks, condiments and ingredients are trade goods. Hemp, tea leaves, coffee beans, vanilla, saffron and raw mustard are excluded from direct household feeding.

| Facility | New batches |
|---|---|
| Grain mill / feed mill | Grain mill: 2 rice → 3 rice flour; 2 spelt → 3 flour; 2 buckwheat → 3 buckwheat flour. Feed mill: 1 millet → 3 grain feed. |
| Town kitchen | 1 rice + 1 spinach → 2 rice bowls; 1 rice + 1 saffron → 3 saffron rice; 1 lentils + 1 leeks → 2 soup; 1 chickpeas + 1 garlic → 2 falafel; 1 buckwheat flour + 1 rice flour → 3 noodles. |
| Oil press / condiment kitchen (B) | Press: 2 walnuts → 2 walnut oil; 2 peanuts → 2 oil + 1 press cake. Kitchen: 2 peanuts → 2 peanut butter; 2 sesame → 2 tahini; 1 mustard + 1 vinegar → 2 prepared mustard. |
| Preserve kitchen | 2 peaches or blackberries + 1 sugar → 3 jam; 2 lemons + 1 sugar → 3 marmalade; 2 beetroot + 1 vinegar → 3 pickles. |
| Drying house (A) | 2 figs or blackberries → 2 dried fruit; 2 vanilla → 2 baking vanilla; 2 tea → 2 finished tea; 2 tea + 1 log → 3 smoked tea. |
| Roastery (B) / bakery | Roastery: 2 coffee → 2 roasted coffee; 2 almonds + 1 sugar → 3 marzipan. Bakery: 1 marzipan + 1 baking vanilla + 1 flour → 3 almond cakes. |
| Basket maker (A) / ropewalk (B) | Basket maker: 2 willow or bamboo → 2 baskets. Ropewalk: 2 hemp → 3 rope. |
| Furniture shop | 2 bamboo + 1 rope → 2 furniture panels; 1 panel + 1 walnut oil → 2 polished cabinets. “Panel” selects the furniture panel item. |
| Bottling house (B) | 1 cork → 4 stoppers; 2 cider or pear juice + 1 glass + 1 stopper → 2 bottled cider or bottled pear juice respectively. Preserve distinct output identities. |
| Saltworks (A) / pottery | Saltworks: 2 brine → 2 rock salt (the existing culinary salt inventory item). Pottery: 1 feldspar + 1 kaolin → 3 glazed tiles. |
| Foundry / alloy works | Foundry: 1 nickel ore + 1 coal → 1 nickel bar; 1 chromite + 1 coal → 1 chromium bar. Alloy works: 2 iron bars + 1 nickel bar + 1 chromium bar → 3 stainless steel. |
| Stonecutter (C) | 1 garnet → 3 abrasive grit; 1 basalt + 1 mortar → 3 paving blocks; 2 marble + 1 grit → 3 dressed marble; 1 slate → 2 roof slates; 1 slate + 1 plank → 2 writing slates; 1 amber + 1 grit → 2 polished amber. “Grit” selects abrasive grit. |
| Jeweller / workshop | Jeweller: 1 polished amber + 1 silver bar → 2 amber brooches; 1 garnet + 1 gold bar → 2 garnet rings. Workshop: 1 stainless steel + 1 plank → 3 cutlery sets. |

Give the materials domestic demand as well as export buyers. For one primary-school course, deliver one writing slate per enrolled student before class starts to shorten that class by 25%. A warehouse may substitute 4 rope for its 4 fittings. For townhouse conversion, 2 polished cabinets can replace the 2 chairs. For each civic landmark upgrade at level 4 or higher, the player may replace the full brick component with the same quantity of glazed tiles, dressed marble or roof slates. Show substitutions before committing materials. Include market orders for baskets, bottled drinks, cutlery and amber brooches. Apply existing quality thresholds to all export lots.

Verify a fresh city can access all 24 crops using ordinary plots. Test the added bags against the existing mineral guarantees, a new school course with writing slates, and complete seed-to-export and deposit-to-export runs for almond cakes and amber brooches. Include all additions in the almanac, price and dependency checks.

### Uses beyond selling

* **Farm inputs.** On-site sowing can consume 1 compost from the player's cargo for +2 yield on that planting. On perennial plots apply after harvest for the next cycle only. A fertilized, pollinated orchard on suitable soil yields 7 fruit. Highlight this total before collection.
* **Food and households.** All fruits, edible vegetables, eggs, milk and processed meals count toward the existing food delivery. Wheat, industrial crops, feed and alcoholic drinks do not. Basic foods count as 1 food unit. Soup, pies, flatbreads, dark bread, porridge, cheese, mozzarella, pickles, jam, smoked fish and cured pork count as 2. Show the value in the item catalog. Accept mixed food up to the support cap.
* **Housing improvements.** Upgrade a cottage on-site to a townhouse for 4 bricks, 2 mortar, 2 glass and 2 chairs. It houses 8 people, earns 2 coins/h and stores 24 coins. Upgrade again to an apartment house for 4 steel, 4 plaster, 2 beds and 2 tools. It houses 16, earns 4 coins/h and stores 48. A day of extra residents requires one food unit per baseline resident. Income and population double while supported. Store inventories survive an upgrade.
* **Distribution.** A warehouse costs 6 planks + 4 fittings and stores 120 units in a shared buffer. Place it like a town store. Players can transfer between any compatible facilities via walking or a one-off hire. A vehicle kit fitted on-site at a machine works adds 10 personal cargo slots to an unlocked truck, once per player.
* **Recon and roads.** Supply a survey scope to the town store to reduce the duration of one commissioned survey by half. It is consumed on confirmation and leaves detection tier unchanged. Deliver 3 paving blocks to a road's upgrade blueprint to cover the coin cost of its next tier. Finish this material upgrade on-site. The existing remote coin upgrade remains available.
* **Civic buildings.** A library costs 6 bricks, 4 glass and 4 books. A market hall costs 6 planks, 4 mortar and 2 fittings. A clock tower costs 8 stone, 4 brass and 2 clocks. Each completed building adds one optional order slot at the town store. Each design grants its slot once. The structures stay on the map as visible landmarks.
* **Market orders.** Start with one optional order slot. Each completed or dismissed order refreshes after 12 h. Generate a request for 2–6 units of a finished good the player can produce with discovered materials. Deliver to the town store and submit remotely. Examples include quilts for a guesthouse, crockery for a café, porcelain and silver rings for a fair, or books for a school. Pay 150% of normal total sale value, rounded up. Require one commodity per order. Give every eligible finished good a turn using a shuffled pool. Orders never reserve stock automatically.
* **Prices.** Keep all explicitly priced starter goods. For remaining raw goods use 1 coin per unit. For new manufactured goods compute the price once in catalog dependency order as the greater of 2 or the rounded-up value of (total input sale value + facility-class bonus) divided by total output quantity. Class bonuses A/B/C/D are 1/3/5/8 coins. For alternatives choose the least expensive allowed inputs; for competing recipes use the cheapest calculated price. For herd outputs and hay/feed use 1 coin per unit unless already priced. For multi-output batches with an already priced by-product, subtract its total value before dividing over the remaining output. Freeze computed prices per catalog version and display them at the store.

### What a mature city looks like

A dairy district can sell buffalo milk immediately, turn it into mozzarella across the street, or take it to a town kitchen for flatbread. That last choice commits the player to a second route bringing flour and tomato sauce. A textile district can share a clover meadow between the sheep paddock and an apiary. The sheep supply the tailor, the bees supply the chandlery, and a nearby cherry orchard benefits from pollination. An industrial town needs coal for both steel and glass. Its owner can inspect the competing buffers from home before deciding which works gets the next load.

### Catalog interface and verification

Ship an in-game almanac searchable by commodity, crop, animal or facility. Each item shows its sources, recipes that use it, household and civic uses, sale price and nearest discovered producer. Hide undiscovered deposit coordinates. In the planner show the input quantities per batch and how many complete batches current storage permits. For recipes with alternatives the player selects the input when setting production. Reject inputs belonging exclusively to a different active recipe and permit withdrawal of leftovers after switching.

As part of the single delivery, validate every recipe reference, mixed output, building cost, crop, animal and unlock against the catalog. Starting from starter grants and reachable discoveries, run a dependency check proving every listed good and building can be produced without a purchase. Exercise all recipes with both full and nearly full buffers. Run end-to-end scenarios for pollinated cherry pie, buffalo-milk flatbread, dyed wool coats, a printed book, a scope-assisted survey, and a truck upgrade made from ore and latex. Verify that each chain includes real inventory transfers and that closing the app produces identical balances to continuous play.

## Quality, skilled workers and exports

Every unit of every commodity carries an integer quality index Q from 0 to 100. Local households accept all grades. A player's first plank can always become a cottage. Export buyers pay for consistent quality, which gives the player a reason to seek better deposits, deliver selected inputs and develop specialist crews. Capitalism II's manufacturing model weights raw materials and production technology differently by product. Vestigia adapts that idea with recipe-specific weights and local worker skill. Design reference: [Capitalism II manual, chapter 4](https://www.enlight.com/capitalism2/manual/Capitalism2_Manual.pdf).

### Where quality originates

Every discovered grove, mineral deposit, forage patch and other natural source has a persistent seeded grade from 35 to 100. Roll once per underlying site. Distribution: 60% in 35–64, 30% in 65–84 and 10% in 85–100, uniform inside each band. Reveal grade on discovery for visible resources and on successful recon for hidden deposits. Replacements for inaccessible sites inherit the original grade. Site inspection shows grade, forecast output and the nearest discovered alternatives producing the same good.

Every producing site has one NPC crew. Skill starts at 40, rises by 1 after every five completed batches at that site, and caps at 100. A farm harvest counts as one batch. A player can train any crew remotely for +5 skill, capped at 100, for coins equal to its current skill. Show the price and predicted effect before confirmation. Training takes effect on the next batch started. Crew proficiency persists across recipe switches at the same building. Snapshot inputs and skill at batch start, award experience after completion and process offline batches chronologically. For established saves, existing lots start at Q50, crews at 40 and ongoing cycles retain a migration-time snapshot.

| Production step | Calculation before rounding |
|---|---|
| Logging, mining, quarrying, tapping or foraging | 85% natural source grade + 15% crew skill |
| Crop harvest | 75% land grade + 25% crew skill. Set land grade to 80 on favoured soil or 55 elsewhere. Compost adds 10% of its own Q to land grade. Cap land grade at 100. Snapshot at planting or regrowth. Pollination continues to affect yield. |
| Livestock, fish and bees | 70% actual feed quality + 30% crew skill. Weight feed units by quantity. Apply the batch Q to each output, including by-products. |
| Sawmill, mills, presses, food, textiles and ordinary manufacturing | 70% ingredient quality + 30% crew skill |
| Foundry, alloy works, glassworks, workshop, printer and jeweller | 55% ingredient quality + 45% crew skill |
| Instrument maker and machine works | 40% ingredient quality + 60% crew skill |

For manufacturing, average the Q of the units actually consumed, weighted by quantity, unless a recipe specifies ingredient importance. For survey scopes use 70% optical glass and 30% brass within the ingredient share. Apply these rules to starter and alternative recipes too. For the rubber grove use the perennial crop rule with sandy soil favoured. Round half up once per completed step. Every output unit keeps this Q when moved, sold, split or dispatched. Finished stock retains its original rating after crew training. Consumption by a building or household ends the chain for those units.

### Choosing what goes into a batch

Inventory counts remain in units. Store lots by commodity and Q. The stock panel can collapse lots into one quantity, with a grade range and a drill-down. Capacity counts all units across grades. Support oldest eligible stock first by default, highest quality first, or a minimum input Q chosen per ingredient. With a threshold set, show “Waiting for optical glass Q75+” even when ordinary glass is available. Allow specific lot selection on personal pickup and hired dispatch. Reserve the exact lots and destination space. Persist units, quality and reservation identifiers through reconnection and retries.

Show how to improve a product before the player spends coins or takes a walk. Example: a Q90 grove and skill-50 lumber crew produce Q84 logs. At a skill-60 sawmill they become Q77 planks. A Q40 grove with the same two crews yields Q42 logs and Q47 planks. Training the sawmill crew to 80 turns the premium logs into Q83 planks. If a builder abroad requires Q80, the player can see exactly which investment gets the order over the line.

### Export exchange

Build an export depot for 6 planks and 4 bricks on any eligible revealed site. The depot holds 60 units across all lots. No physical port, railway or national border is required. The exchange represents external NPC buyers. Review and accept offers from the sofa. Carry the goods to the depot personally or hire one haul. Once enough qualifying goods are in the depot, select the lots and authorize shipment remotely. The displayed price includes onward freight. Settlement is immediate.

The exchange posts three offers per city per 24-hour server window. One bulk buyer requests 8–16 units at Q40+, one specialist requests 4–8 at Q65+, and one premium buyer requests 2–5 at Q80+. Rotate among locally producible raw, intermediate and finished goods, including crops and livestock outputs. Offer at least one achievable bulk contract whenever a qualifying source or recipe is known. Show aspirational orders with current best grade and the shortfall. Players may accept one offer per tier per window. Acceptance fixes its terms for 72 hours, even across board refreshes. Expired or abandoned orders free the commitment and leave all stock available. Orders cannot repeat automatically.

Each unit must meet the buyer's floor. Let the player preview which lots qualify and how much would remain. Compute a single payout as floor(quantity × local catalog unit price × tier multiplier × (1 + (mean shipped Q − required Q)/100)). Use exact quantity-weighted mean Q. Tier multipliers are 1.25, 1.75 and 2.5 respectively. Local fixed-price sales and civic market orders retain their existing prices. Example: six Q75 planks sold to a Q65 specialist at a base price of 2 yield 23 coins. Six Q60 planks remain useful for construction or domestic sale. Never consume cargo for an incomplete shipment. Debit selected lots, close the contract and credit coins in one idempotent transaction. The same units cannot fulfil an export and a local order.

### Acceptance additions

Verify the two-grove example and training forecast exactly. Trace actual Q through feed → milk → mozzarella → flatbread and ore → brass → scope, including mixed-quality inputs, alternate recipes, by-products, rounding and offline training progression. Compare forecasts to actual output. Verify exact lot conservation through partial pickups, hired hauls, cancellations, save migration and offline replay. Run export scenarios for a mixed shipment with one below-floor unit, a valid above-floor premium, rollover of an accepted offer, expiry with stock present, and duplicate submission. Show a complete playable route from finding a good resource to receiving payment from an external buyer.

## Technology tree

Technologies belong to the settlement. Credentials belong to citizens. To start a batch, the settlement must know the recipe's technology and the site must meet its existing staffing, input and capacity rules. Researching a process once makes it available at every compatible site. A trained worker can move between those sites without taking the discovery along.

The town store opens the research screen from anywhere. Start with Settlement basics already known. The player chooses one project at a time, pays earned coins when starting it and sees its completion time before confirming. Each project needs every listed prerequisite. Use 2 coins and 15 minutes for tier 1, 5 coins and 45 minutes for tier 2, 10 coins and 2 hours for tier 3, and 20 coins and 4 hours for tier 4. The starter cottage can fund the first project through ordinary rent. Research runs on settlement time, including offline time, and needs no dedicated researcher. Education continues to govern who can operate the resulting processes.

| Technology | Tier | Prerequisites | Processes unlocked |
|---|---:|---|---|
| Settlement basics | 0 | Starting knowledge | Logging, ordinary sawing, field crops, stone and clay extraction, original wheat-to-bread and clay-to-bricks recipes |
| Agriculture | 1 | Settlement basics | Remaining crops and plots, livestock, bees, fish, feed mill, hay barn and compost yard |
| Craft production | 1 | Settlement basics | Fibre shed, basket maker, ropewalk, paper mill, pottery, furniture shop and all four specialist lumber recipes |
| Prospecting | 1 | Settlement basics | Mining, tapping and remaining raw material extraction |
| Food processing | 2 | Agriculture | All remaining food and drink processes, including milling, saltworks and bottling |
| Building materials | 2 | Craft production, Prospecting | Lime kiln, mason, stonecutter and glassworks |
| Household trades | 2 | Craft production, Agriculture | Weaving, dyeing, tailoring, tanning, cobbling, chandlery and printing |
| Smelting | 2 | Prospecting | All foundry processes |
| Metalworking | 3 | Smelting, Craft production | Alloy works and remaining workshop recipes, including tools, fittings and gears |
| Jewellery | 3 | Smelting, Building materials | All jeweller recipes |
| Precision engineering | 4 | Metalworking, Building materials | Instrument maker, rubber works and machine works |

Assign one technology ID to each recipe or extraction process in the catalog. A named recipe takes precedence over its facility's general rule. For example, the workshop can make ash tool handles with Craft production while steel gears require Metalworking. Discovery, surveys, blueprints and education stay available under their existing rules. Show locked recipes in the planner with their technology, prerequisites and a link to research. List staff and input shortages separately so the player can plan the whole chain.

Persist each settlement's completed technologies and active project. Charge a project once and resolve completion at its recorded timestamp across restarts and retries. When upgrading an existing save, grant the technologies and prerequisites for processes already running or previously completed in that settlement. Preserve existing batches and stock.

Verify catalog coverage, an acyclic tree and a path from the starter cottage to every technology using earned coins. Test a fully staffed workshop with sufficient inputs before and after Metalworking, then remove its qualified lead and check that the next batch waits for staffing. Verify that a project finishing offline unlocks its recipes once and that an existing batch survives save migration.

## Ten site levels, education and employment

These rules govern all constructed sites. They replace the earlier one-off 12-to-48 buffer upgrade, the original lumberjack timing, the assumption of an always-available crew, and the final quality calculation above. Existing recipe quantities remain the unit of work. Roads retain their own passage tiers. Resource grades describe the land and remain fixed.

### Site growth

All sites start at level 1 and reach a maximum of 10. Upgrades affect only the selected site. Preview them remotely, deliver the listed materials to a dedicated upgrade buffer over several trips and finish on-site. The site continues operating during deliveries. Charge materials once on completion. A running cycle finishes at its original rate; the following cycle uses the new level. Capacity increases immediately. Existing stock, reservations, progress, crew skill and crop plantings survive upgrades.

| Level | Work speed | Storage multiplier | Lumberjack logs/h | Lumberjack log capacity |
|---:|---:|---:|---:|---:|
| 1 | 1.00× | 1.00× | 4 | 12 |
| 2 | 1.25× | 1.50× | 5 | 18 |
| 3 | 1.50× | 2.00× | 6 | 24 |
| 4 | 1.75× | 2.50× | 7 | 30 |
| 5 | 2.00× | 3.00× | 8 | 36 |
| 6 | 2.25× | 4.00× | 9 | 48 |
| 7 | 2.50× | 5.00× | 10 | 60 |
| 8 | 3.00× | 6.50× | 12 | 78 |
| 9 | 3.50× | 8.00× | 14 | 96 |
| 10 | 4.00× | 10.00× | 16 | 120 |

One log takes 15 minutes at level 1. Grant the first free lumberjack station one opening log once at construction so a player can make their first delivery on the same walk. Later stations start empty. Divide all extraction, herd, crop and manufacturing durations by work speed, retaining full timing precision. Buffers scale from each site's own base capacity, rounded down, including both input and output buffers. The longer storage window rewards players who visit once a day. From empty, a level 1 lumberjack fills in 3 h and a level 10 in 7 h 30 min.

For target level L pay 2L planks and L stone. At L≥4 add L bricks; at L≥7 add L iron bars; at L≥9 add L tools. Costs apply per upgrade, moving one level at a time. These costs never gate construction of the first level. For housing, apply work speed to baseline resident capacity and hourly tax income (round residents down), and storage multiplier to coin capacity. Cottage/townhouse/apartment conversion remains an independent change of housing type and preserves site level. For storage and export depots scale shared capacity. For civic landmarks retain their single order slot and increase the payout of orders from that slot by 2% per level above 1. For schools scale seats as specified below. Display each site's actual next benefit. Production upgrades increase throughput; improved product quality requires better materials, a more skilled crew or a better-educated city.

### Residents and qualifications

Assign one persistent citizen record to each baseline resident. Food-supported extra households contribute population and income but do not create temporary skilled workers. Each baseline citizen has a permanent education credential and one assignment (available, studying or employed). Qualifications are cumulative. Building a site is possible before recruiting its required worker. The site panel shows exactly which profession is missing. A single qualified lead represents each operating crew, so upgrading a single factory never requires ten separate assignments. Crew skill measures the team's accumulated practice at that site. Education determines eligibility and contributes separately to quality.

| Credential | Professions and sites |
|---|---|
| E0 · No formal qualification | Lumberjack, quarry hand, surface gatherer, farmer, herder, beekeeper, fish farmer and sawmill hand. All fields, groves, animal sites and surface extractors can operate from the start. |
| E1 · Primary | Miner, miller, baker, food processor, brewer, dairy worker, spinner, weaver, tanner, cobbler, potter, brickmaker, mason and general craft worker. Default for remaining class A/B factories. |
| E2 · Vocational | Metallurgist at the foundry or alloy works, glassmaker, machinist at the workshop, tailor, printer, furniture maker, rubber worker, jeweller, primary teacher and vocational instructor. |
| E3 · University | Precision instrument maker, machine works engineer and university lecturer. |

Explicit profession entries override facility-class defaults. Use E2 for unlisted class C/D manufacturing. Distribution, exports, housing, passive civic bonuses, construction and paid NPC commissions require no permanent lead. On building completion auto-assign the lowest qualified available resident unless the player has disabled it. Reassign remotely. An unstaffed site pauses and retains stock and elapsed progress. The opening town store includes one permanent E0 founder and one E2 founding artisan in addition to housing residents. These two can staff the granted starter stations before the first cottage exists. Show graduates available, jobs unfilled and projected vacancies together.

### Schools, colleges and universities

| Institution | Construction | Student prerequisite → graduation | Instructor | Seats at level 1 | Course time |
|---|---|---|---|---:|---:|
| Primary school | 4 planks + 2 stone | E0 → E1 | E2 | 4 | 4 h |
| Technical college | 6 planks + 4 bricks | E1 → E2 | E2 | 3 | 8 h |
| University | 8 bricks + 4 iron bars + 4 paper | E2 → E3 | E3 | 2 | 16 h |

Scale seats by the site's work-speed multiplier, rounded down. Course time stays fixed. Enrol available residents remotely. Instructors cannot teach and study simultaneously. If a lecturer leaves, pause the class until replaced. Store elapsed time. Graduation is permanent and survives closure or reassignment. Completed students become available for work or further study. Provide one founding fellowship with the first university: an external visiting lecturer staffs that campus until its first E3 graduate takes over. The visitor fills no industrial job and does not enter city education statistics. The founding artisan can teach both earlier qualifications in succession. Before moving a sole instructor, preview affected classes. If housing capacity decreases, retain existing residents and suspend new arrivals until housing catches up.

### Education and batch quality

Calculate city education from all permanent resident credentials including founders, students and workers. Education index = 100 × sum of credential numbers / (3 × permanent resident count). A city with average credential E1.5 scores 50. Buildings earn their quality benefit by graduating residents. Empty school buildings add no points. Display the score, graduate counts and the effect of one more graduation. Snapshot the score at the same time as ingredient grades and local crew skill.

For each produced lot, compute the unrounded result from the existing source, field, feed or manufacturing formula. Final Q = round-half-up(0.90 × that result + 0.10 × city education index), bounded to 0–100. Round once at the end of each production step. Use this for every producer including farms and by-products. The natural deposit grade and quality of stock already in storage remain fixed. For a direct factory comparison, Q84 logs and a skill-60 sawmill give a local result of 76.8. In a city scoring 40 the plank is Q73. In a city scoring 80 it is Q77. The earlier two-grove figures illustrate the local calculation only; full-chain forecasts use education at every stage. Show the three contributions in the batch preview where applicable.

### Verification

Check every constructed site at levels 1, 2 and 10. Reject level 11 and duplicate finishes. Test a level change mid-cycle, overnight production with reserved inbound stock, and housing conversion at a nonstarter level. Reach the first school with E0 extraction, then bake bricks with a primary graduate, train a vocational metallurgist, produce iron and paper, open a university and graduate an engineer without importing a worker or paying real money. Test understaffing, teacher reassignment, simultaneous graduation and batch start (resolve graduations first), offline catch-up and conservation of citizen assignments. On migration map legacy buffers to the lowest level preserving their capacity and all existing stock. Give each existing occupied production site a qualified incumbent, preserving its crew skill and recording the citizen once; temporarily grandfather housing for these residents. Existing inventory keeps its stored quality.

## Household consumption and residential advancement

This section supersedes food-support timers, temporary food-created residents, automatic doubling of tax on food delivery, and materials-only residential advancement. Baseline housing capacities, level multipliers, construction costs and tax storage still apply. Every occupied home has a resident ledger, a household inventory and a rolling record of needs actually met. Residents in school or at work still consume at home. The two founders use the town store as their initial household under the same consumption rules; its demand does not count toward another house's advancement.

### Delivering and consuming goods

Personally deliver supplies to the house or dispatch a one-off hired haul. The household pantry accepts up to 10 physical units per resident place (minimum 40). Construction deliveries go into their own buffer. Display daily demand and days of supply before dispatch. Each home can choose which eligible lots to use first, defaulting to oldest lots while rotating available food families. Exports, warehouse stock and items merely passing in personal cargo confer no household benefit.

Process consumption hourly against actual occupied resident-hours. Per resident per 24 h, target 1 nutrition point, 0.10 clothing point, 0.10 household essentials point, 0.05 comfort point and 0.025 leisure point. Draw whole goods from the pantry as needed and retain fractional remaining use per family and category. Thus one ordinary shirt supplies one resident for ten days or four residents for two and a half days. Food arrives as servings, clothing wears out, household items get used up. Earn points only as those servings or uses are consumed. Cap category credit at actual demand and 100% coverage. Empty shelves yield unmet demand, never debt. Preserve fractional use and consumption history across offline reconciliation, level changes and restarts.

| Category | Eligible alternatives and points per physical unit |
|---|---|
| Nutrition | Existing edible catalog values of 1 or 2. Tag each food with one main family: grains, vegetables, pulses/nuts, fruit, dairy, eggs, meat or fish. Mixed dishes use their main ingredient, with a stable recipe-specific family for ties. Bread and dark bread both count as grains. |
| Clothing | Shirts or boots 1; coats 2. Woven linen, cotton cloth or wool cloth 0.5 as simple wraps, giving early homes an accessible option. |
| Household essentials | Soap, candles, baskets or crockery 1; cutlery sets 2. |
| Comfort | Quilts, chairs or beds 2 each; polished cabinets 3. |
| Leisure and luxuries | Finished tea, coffee, books or cider 1; clocks, jewellery or loose diamonds 3. |

Give each consumer good a catalog entry with its category, family where relevant, and per-unit uses. Ordinary nonfood goods use their listed value at Q50, scaled by (0.75 + Q/200). Nutrition retains its listed serving count regardless of Q. Unlisted production inputs and construction materials give zero household points. A unit has one consumption purpose and cannot satisfy two categories. Show values and substitutes in the almanac.

### Evaluating one house

Evaluate the last 24 hours, requiring at least 24 occupied hours at the current level before advancing. Coverage is credited uses divided by demand for actual resident-hours in that window. A food family qualifies for variety if it supplied at least 15% of the home's nutrition demand. Use unrounded values for eligibility. Score out of 100 = 40 × nutrition coverage + 20 × clothing + 15 × essentials + 15 × comfort + 10 × leisure (all coverages are fractions). Check the combined score AND every applicable minimum below. A dash means no minimum. Even perfect leisure coverage contributes at most ten points.

| Target level | Nutrition minimum | Food families | Clothing minimum | Essentials minimum | Comfort minimum | Combined score |
|---:|---:|---:|---:|---:|---:|---:|
| 2 | 80% | 2 | 25% | — | — | 37 |
| 3 | 85% | 2 | 40% | — | — | 44 |
| 4 | 85% | 2 | 50% | 20% | — | 50 |
| 5 | 90% | 3 | 55% | 30% | — | 56 |
| 6 | 90% | 3 | 60% | 40% | 10% | 62 |
| 7 | 90% | 3 | 65% | 50% | 15% | 67 |
| 8 | 95% | 3 | 70% | 60% | 25% | 73 |
| 9 | 95% | 4 | 75% | 65% | 35% | 79 |
| 10 | 95% | 4 | 80% | 70% | 45% | 85 |

Example: a four-person cottage consumes two nutrition points from potatoes and two from goat milk in a day. Both families qualify. One ordinary shirt supplied for the final six hours meets 25% of the day's clothing demand. The home scores 45 and can advance to level 2 once construction materials are delivered. Replace all the milk with more potatoes and the variety condition fails. Add diamonds and variety still fails. At level 10 every luxury commodity remains optional; fully covering the four other categories yields 90 points.

Complete the upgrade on-site, rechecking eligibility at confirmation. Existing residents keep skills and jobs. New residential places fill with permanent E0 residents on completion. Type conversion also requires residents to meet the row for the next site level (level 10 uses its own row), with a full 24 h observation window since the most recent level or type change. Retain the site level on conversion. Supply interruptions pause further advancement. Earned levels, population and jobs persist. Baseline taxes accrue as specified by housing type and level. Show which need is short, recent consumption, available substitutes and time left in the observation window.

For migration, preserve existing permanent citizens, stored stock, house level and accrued taxes. Honour any prepaid food-support interval under its existing terms until expiry, then retire temporary residents. Do not count that legacy bonus as duplicated nutrition or permanent workforce. Begin recording the new household window at migration. Update earlier food-support acceptance scenarios to test continuing consumption, advancement eligibility and retention of residents instead.

Test equal advancement through distinct baskets of goods, excess diamonds in a hungry home, varieties sharing one family, mixed grades, a shirt lasting several days, higher demand after move-in, irreversible consumption under offline replay, and simultaneous upgrade attempts. Compare pantry, wear balances and score after 48 h offline with an hourly simulation. Confirm every threshold is achievable using locally producible goods without paid hauling.

## Recon

Assign each prospect a persistent hidden payload and detection difficulty at generation. Initial mix over a large region is 20% empty and 80% mineral-bearing, subject to regional guarantees. For deposits assign difficulty 1/2/3 with weights 50/35/15. Teams cost 3/8/18 coins, take 5/15/30 minutes and detect deposits up to their tier. Higher price buys better coverage. A survey cannot create or reroll a mineral. Give an unsuccessful team the report “Resources could not be found”; record its tier and coverage. Disable equivalent or weaker repeat orders. An expert negative closes the prospect. Debit once, permit one active order per site, and reveal the report on return even if the app was closed.

## Personal transport, hired hauls and sales

Award 2 XP per newly discovered tile, 5 per completed building, and 1 per personally delivered unit used in construction or production, once per unit. Unlock the handcart at 40 XP (4 units), horse and carriage at 150 XP (12), and truck at 500 XP (40). All use the player's actual walk. Allow mixed loads, partial pickup and partial unloading. For late-game bulk handling, upgrade any production building's buffers on-site from 12 to 48 for 4 bricks and 2 tools. Upgrades preserve stock.

From any location choose source, destination, commodity and amount (1–12 units). Quote the job before confirmation. Reserve stock and destination space immediately. Deliver once after 2 minutes plus 1 minute per 200 m of pedestrian route, rounded up. Charge 2 coins plus 1 per started 250 m, with a 25% distance-charge discount on paved portions. Round final price up. Where no connected route exists, reject before charging. Jobs carry specified goods once and end. The player can hire another trip manually.

Offer one consumable haul voucher as an alternative to the quoted coin fee on any eligible trip. Sell packs of five through the platform store, showing the platform's localized price. Vouchers buy transport only. Implement purchase confirmation, server-side validation, transaction deduplication, entitlement ledger and interrupted-purchase recovery. Use a clearly marked sandbox store in development. Real sales depend on owner-provided store products, accounts and credentials. All progression is attainable using earned coins.

## Roads

Match walks to stable pedestrian segments using trajectory, heading and connectivity. Group opposite pavements of the same street under a canonical road section between junctions. Keep parallel streets, bridges and underpasses distinct. Count a passage when the player covers at least 70% of a section, with long sections divided into pieces up to 80 m. Rearm after leaving the section. A genuine return trip counts. GPS jitter while standing does not. Preserve each branch's own count.

Show a faint trail after 1 passage, a dirt path after 3, gravel after 10 and paving after 30. From the sofa buy the next tier on an existing trail for 4, 12 or 30 coins respectively. Apply the higher of the paid and earned tiers, retain passage history, preview cost and appearance, and reject duplicate charges. Use line pattern and width as well as colour to show tier. Roads never dispatch a haul.

## Mobile interface

The map opens on the city with a Walk button and a compact cargo indicator. Tap an anchor for stock, requirements, distance, interaction range and available actions. The planner overlays eligible footprints and lets the player inspect a route before placing a blueprint. The city panel groups stalls by cause (full, missing input, ripe), lists survey reports and hired trips, and opens the relevant site on tap. Each job shows its cost, ETA and destination. Keep the map usable after denying background permission. Foreground walks still work. Support metric units, large touch targets, readable text scaling and a list alternative to tapping small adjacent markers.

## Engineering and delivery

Prefer Expo React Native with a native development build, Spring Boot, PostgreSQL/PostGIS and Supabase authentication, matching the familiar cloud workflow. Supply an isolated development environment with sample pedestrian data, offline fixture basemap, simulated positions, controllable clock, seeded prospects and sandbox billing. These fixtures must exercise the same application services as the live providers. Restrict simulated movement, time and purchases to development. Document live map keys, pedestrian data import, platform permissions and store configuration. Keep secrets outside source control.

Persist city ownership, grid discoveries, anchors, prospect truth and reports, blueprints, production state, buffers, crops, population support, player cargo, XP, road sections, wallet and job reservations. Resolve timed events in timestamp order, including deliveries that restart production during an absence. Use a server clock, transactional stock and wallet changes, and idempotency keys. Lock source and destination consistently. Reopening the app, syncing a second device or replaying a command must never duplicate goods, XP, payments or road wear. Authenticate access to each personal city. Supply migrations, API contract, known external dependencies and exact startup/test commands.

## Acceptance contract for the single delivery

1. In a fresh city verify one visible tile. Walk a seeded route, place both granted sites, build on-site, carry one log, make planks and finish an occupied cottage. Attempt every on-site action outside its radius and verify a clear reason for rejection.
2. Plan remotely, commission a survey and hire a haul. Try planting and harvesting remotely, then visit a mature field and harvest. Verify suitability changes yield, full storage preserves the crop, and food changes occupancy and income.
3. Replay one failed shallow survey of a known deep deposit, then commission an expert. Verify the mineral persists through a restart. Verify an empty prospect and a concurrent duplicate request.
4. Walk opposite pavements and then a parallel street. Check common-section credit, independent side streets, paid upgrades, return walks and stationary jitter. Test an inaccessible site and replacement.
5. Close the app for 48 simulated hours with partially full buffers, active production, ripe crops, a survey and an inbound delivery. Compare every balance with an uninterrupted run. Verify caps, reservations and restart timing.
6. Progress through all vehicles, every resource and recipe, and deliver jewellery. Verify a full truck can unload partially and serve multiple sites. Complete the same economic chain using earned coins only.
7. Complete coin and voucher trips, decline an invalid destination, simulate an interrupted purchase and replay a receipt. Verify exactly one charge, entitlement and delivery. Check screen lock, permission denial, interrupted GPS and reconnect on supported mobile builds.
8. Deliver the full source, runnable cloud setup and test results together. Distinguish fixture results, physical-device checks and live provider checks. Record any credential-dependent check that could not be run.
