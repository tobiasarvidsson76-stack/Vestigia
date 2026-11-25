'use strict';
const el = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));
let city, catalog, selected = '0,0', panel = 'site', busy = false, cropPlan, researchChoice, focusedMapTile;
let cityReceivedAt=0;
function updateCity(state) {
  city=state;
  cityReceivedAt=Date.now();
}
const currentCityTime=()=>city.now+(Date.now()-cityReceivedAt)/1000;
let token = localStorage.getItem('vestigia.city');
const total = stock => stock.reduce((sum, lot) => sum + lot.qty, 0);
const cost = items => items.length ? items.map(([q, names]) => `${q} ${names.join(' or ')}`).join(' + ') : 'Free';
const eta = at => at === null ? 'Paused' : at <= city.now ? 'Ready' : `${Math.ceil((at-city.now)/60)} min`;
const options = values => values.map(value => `<option>${escape(value)}</option>`).join('');
function button(label, action, disabled=false) {
  return `<button data-action="${escape(JSON.stringify(action))}"${disabled?' disabled':''}>${escape(label)}</button>`;
}
async function request(path, method = 'GET', data, key) {
  const headers = {'Content-Type':'application/json'};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (key) headers['Idempotency-Key'] = key;
  const response = await fetch('/api/'+path, {method, headers, body:data && JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), {status:response.status});
  return result;
}
function say(text) { el('notice').textContent = text; }
function flush() {
  const raw = localStorage.getItem('vestigia.pending');
  if (!raw) return Promise.resolve();
  const {action, key} = JSON.parse(raw);
  return request('command','POST',action,key).then(state => {
    updateCity(state);
    localStorage.removeItem('vestigia.pending');
  }, error => {
    if (error.status) localStorage.removeItem('vestigia.pending');
    throw error;
  });
}
let actionFailure;
const actionScope=()=>panel==='site'?`site/${selected}/${cropPlan??''}`:panel;

async function act(action) {
  if (busy || !city) return;
  busy = true;
  const scope=actionScope();
  actionFailure=undefined;
  try {
    await flush();
    const key = globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random();
    localStorage.setItem('vestigia.pending',JSON.stringify({action,key}));
    await flush();
    if (action.op==='plan'||action.op==='step') cropPlan=undefined;
    if (action.op === 'step') {
      focusedMapTile=undefined;
      const id = position();
      if (city.tiles[id]) selected = id;
    }
    say('');
  } catch (error) {
    if (scope===actionScope()) {
      actionFailure={scope,message:error.status ? error.message : 'Connection lost. One command is waiting to sync.'};
    }
  } finally {
    busy = false;
    render();
  }
}
function position() {
  return city.fix ? [Math.round(city.fix.x/60),Math.round(city.fix.y/60)].join(',') : '0,0';
}
function siteAttention(site, now) {
  if (!site) return [];
  if (!site.built) {
    if (site.construction) return [];
    const pending=(site.construction_needs??[]).filter(need=>need.delivered<need.required);
    if (!pending.length) return ['Ready to start construction'];
    return [pending.every(need=>need.delivered+need.incoming>=need.required)
      ?'Building materials on the way':'Waiting for building materials'];
  }
  const reasons=site.crop&&site.crop.at<=now?['Ready to harvest']:[];
  for (const buffer of ['output','input','shared','pantry']) {
    const capacity=site.capacity[buffer];
    if (capacity&&total(site[buffer])>=capacity) reasons.push(buffer==='shared'?'Storage full':buffer+' storage full');
  }
  return reasons;
}
function map() {
  const [x,y] = (focusedMapTile??position()).split(',').map(Number);
  const cells = [];
  for (let j=y-2;j<=y+2;j++) {
    for (let i=x-3;i<=x+3;i++) {
      const id = [i,j].join(',');
      const tile = city.tiles[id];
      const links=city.tile_paths.flatMap(({a,b})=>a===id?[b]:b===id?[a]:[]);
      const connectors=links.map(end=>{
        const [x,y]=end.split(',').map(Number);
        return `<span aria-hidden="true" class="tile-path ${x>i?'east':x<i?'west':y>j?'south':'north'}"></span>`;
      }).join('');
      const attention = siteAttention(city.sites[id],currentCityTime()).join(", ");
      const name = city.sites[id]?.kind ?? tile?.report?.mineral ?? tile?.resource ?? 'Fog';
      cells.push(`<button class="cell ${tile?'known':''} ${tile?.resource==='pond'?'pond':''} ${id===selected?'selected':''}
        ${id===position()?'current':''} ${id===city.marked_tile?'marked':''}"
        ${tile ? `data-site="${id}"` : 'disabled'} aria-label="${escape(name)} at ${i*60}, ${j*60} metres${attention?', '+escape(attention):''}">${connectors}<span class="tile-label">${tile?escape(name):''}</span>
        ${id===city.marked_tile?'<span class="map-flag" aria-label="Marked tile">⚑</span>':''}
        ${attention?`<span class="tile-notice" title="${escape(attention)}" aria-hidden="true">!</span>`:''}</button>`);
    }
  }
  el('map').innerHTML = cells.join('');
}
function stock(items, transfers=false, buf='', op='pickup', sell=false) {
  if (!items.length) return '<p class="muted">Empty</p>';
  const goods=new Map();
  for (const lot of items) {
    const grades=goods.get(lot.good)??new Map();
    grades.set(lot.q,(grades.get(lot.q)??0)+lot.qty);
    goods.set(lot.good,grades);
  }
  function actions(good,qty,quality) {
    const collect=Math.min(qty,city.capacity-total(city.cargo));
    return (transfers&&(op==='deliver'||collect>0)?
      button(op==='pickup'?'Collect 1':'Deliver 1',{op,site:selected,buffer:buf,good,qty:1,quality}):'')+
      (transfers&&op==='pickup'&&collect>1?button(`Collect ${collect}`,{op,site:selected,buffer:buf,good,qty:collect,quality}):'')+
      (sell?button(`Sell ${Math.min(qty,1200)}`,{op:'sell',site:selected,good,qty:Math.min(qty,1200),quality}):'');
  }
  return [...goods].map(([good,quantities])=>{
    const grades=[...quantities].sort(([a],[b])=>b-a);
    const qty=grades.reduce((sum,[,amount])=>sum+amount,0);
    const multiple=grades.length>1;
    return `<div class="row"><strong>${escape(good)} ×${qty}</strong>
      <p class="muted">${grades.map(([q,amount])=>multiple?`Q${q} ×${amount}`:`Quality Q${q}`).join(' · ')}</p>
      ${actions(good,qty,multiple?undefined:grades[0][0])}
      ${multiple&&(transfers||sell)?`<details><summary>Choose by quality</summary>${grades.map(([q,amount])=>
        `<div>Q${q} · ${amount} units ${actions(good,amount,q)}</div>`).join('')}</details>`:''}</div>`;
  }).join('');
}
function eligible(tile, name) {
  const resource = tile.resource;
  if (tile.city_center || name === 'town store') return false;
  if (resource === 'pond' || name === 'fish pond') return resource === 'pond' && name === 'fish pond';
  if (name === 'mine') return Boolean(tile.report?.mineral);
  if (name === 'lumberjack station') return ['pine','spruce','birch','oak','ash'].includes(resource);
  if (name === 'field') return resource === 'land';
  const source = Object.values(catalog.recipes).filter(r => r.site===name && !r.inputs.length);
  return !source.length || source.some(r => r.outputs[0][1]===resource);
}
function form(label, name, choices, extra='') {
  return `<form data-form="${name}"><label>${escape(label)}<select name="name" required>
    ${options(choices)}</select></label>${extra}<button type="submit">${escape(label)}</button></form>`;
}
function taskProgress(task,now) {
  if (task.required!==undefined) return [`${task.collected} of ${task.required} units`,task.collected/task.required];
  const remaining=Math.max(0,task.at===null?(task.remaining??0):task.at-now);
  return [task.at===null?`Paused · ${Math.ceil(remaining/60)} min left`:
    remaining>0?(remaining<60?`${Math.ceil(remaining)} sec left`:`${Math.ceil(remaining/60)} min left`):
    task.kind==='crop'?'Ready to harvest':'Complete',
    task.duration?Math.max(0,Math.min(1,1-remaining/task.duration)):undefined];
}
function taskCard(task) {
  const [label,fraction]=taskProgress(task,currentCityTime());
  return `<div class="task-card" data-task="${escape(JSON.stringify(task))}">
    <strong>${escape(task.label)}</strong> · <span>${escape(label)}</span>
    <progress max="1" ${fraction===undefined?'hidden':`value="${fraction}"`} aria-label="${escape(task.label)}"></progress></div>`;
}
function marketGuide() {
  return `<details><summary>How market orders work</summary>
    ${catalog.market_guide.map(step=>`<p>${escape(step)}</p>`).join('')}</details>`;
}
function buildingInfo(kind,tile) {
  const info=catalog.building_details[kind];
  const resource=tile.report?.mineral??(kind==='lumberjack station'?tile.resource+' log':tile.resource);
  const recipes=Object.values(catalog.recipes).filter(recipe=>recipe.site===kind);
  const local=recipes.filter(recipe=>!recipe.inputs.length&&recipe.outputs.some(([,good])=>good===resource));
  const shown=local.length?local:recipes;
  return `<p>${escape(info.description)}</p>
    ${info.coverage?`<p>${escape(info.coverage)}</p>`:''}
    ${info.market_note?`<p>${escape(info.market_note)}</p>`:''}
    ${info.market_note||kind==='town store'?marketGuide():''}
    ${info.shared?`<p>Shared storage · ${info.shared} units at level 1</p>`:''}
    ${info.lead===null?'':`<p>Crew · 1 resident, education ${info.lead}+</p>`}
    ${info.inputs?`<p>Operating inputs · ${escape(info.inputs)}</p>`:!shown.length&&!info.market_note?'<p>Operating inputs · None</p>':''}
    ${shown.length?`<details open><summary>Production recipes</summary><ul>${shown.map(recipe=>`<li>
      Produces ${escape(recipe.outputs.map(([qty,good])=>qty+' '+good).join(' + '))} ·
      ${recipe.inputs.length?'Inputs '+escape(cost(recipe.inputs)):'Uses the tile’s natural resources'} ·
      ${recipe.seconds/60} min at level 1
      ${city.technologies.includes(recipe.tech)?'':' · Requires '+escape(recipe.tech)+' research'}</li>`
    ).join('')}</ul></details>`:''}`;
}
function sitePanel() {
  const tile = city.tiles[selected];
  if (!tile) return '<p>Select a revealed tile.</p>';
  const s = city.sites[selected];
  const title = tile.city_center?'CITY CENTER':(s?.kind ?? tile.report?.mineral ?? tile.resource).toUpperCase();
  const distance = city.fix ? Math.round(Math.hypot(tile.x-city.fix.x,tile.y-city.fix.y)) : null;
  let html = `<h2>${escape(title)}</h2><p class="muted">${tile.x} m east · ${tile.y} m south ·
    ${distance===null?'No recent fix':distance+' m away'} · ${tile.nearby?'In range':'40 m interaction radius'}</p>
    ${tile.city_center?'<p>Town store</p>':tile.resource==='pond'?'<p>Fresh water · Build a fish pond here.</p>':
      `<p>${tile.soil[0].toUpperCase()+tile.soil.slice(1)} soil${tile.grade===undefined?'':' · Natural grade '+tile.grade+'/100'}</p>`}`;
  html+=button(city.marked_tile===tile.id?'Clear tile marker':'Mark tile',
    {op:'mark tile',site:city.marked_tile===tile.id?null:tile.id});
  if (city.marked_tile) html+='<button data-focus-marker="true">Show marked tile on map</button>';
  if (!s&&cropPlan&&tile.resource==='land') {
    const definition=catalog.crops[cropPlan];
    return html+`<h3>Build a ${escape(definition.plot)}?</h3>
      <p>Plan to plant ${escape(cropPlan)} after construction · ${escape(cost(catalog.sites[definition.plot].cost))}</p>
      <p>Build time · ${catalog.building_details[definition.plot].construction_seconds/60} min</p>
      ${buildingInfo(definition.plot,tile)}
      ${button('Place blueprint',{op:'plan',site:selected,kind:definition.plot,crop:cropPlan})}
      <button data-crop-back="true">Back to crops</button>`;
  }
  if(s) html+=`<details><summary>Building info</summary>${buildingInfo(s.kind,tile)}</details>`;
  html+=(tile.tasks??[]).map(taskCard).join('');
  if (tile.resource_tech&&!city.technologies.includes(tile.resource_tech)) {
    html+=`<p>Extraction requires ${escape(tile.resource_tech)} research</p>`;
  }
  if (s?.planned_crop) {
    const planned=catalog.crops[s.planned_crop];
    html+=`<p><strong>Planned crop</strong> · ${escape(s.planned_crop)}
      ${s.built&&s.worker!==null&&city.technologies.includes(planned.tech)
        ?button('Plant '+s.planned_crop,{op:'plant',site:selected,name:s.planned_crop}):''}</p>`;
  }
  if (tile.path_targets?.length) {
    html+=`<details><summary>Build path · ${catalog.tile_path_cost} coins</summary>${tile.path_targets.map(id=>{
      const target=city.tiles[id];
      return button((city.sites[id]?.kind??target.resource).toUpperCase()+' · '+id,
        {op:'build path',site:selected,destination:id});
    }).join(' ')}</details>`;
  }
  const attention=siteAttention(s,currentCityTime());
  if (attention.length) html+=`<p class="attention">${escape(attention.join(' · '))}</p>`;
  const plots=s?[catalog.sites[s.kind]?.plot]:Object.entries(catalog.sites)
    .filter(([name])=>eligible(tile,name)).map(([,definition])=>definition.plot).filter(Boolean);
  const cropRows=Object.entries(catalog.crops).filter(([,crop])=>plots.includes(crop.plot))
    .sort(([name,a],[other,b])=>Number(b.soil===tile.soil)-Number(a.soil===tile.soil)||name.localeCompare(other));
  const cropList=cropRows.length?`<details open><summary>Crops by soil suitability</summary><ul>
    ${cropRows.map(([name,crop])=>{
      const match=crop.soil===tile.soil;
      const forecast=(s?.crop_forecast??city.crop_forecast)[match?'match':'mismatch'];
      return `<li><strong>${escape(name)}</strong> · Soil suitability ${forecast.suitability}/100 · ${match?'Best fit':'Prefers '+escape(crop.soil)+' soil'}
        · Est. harvest ${forecast.qty} units at Q${forecast.q}/100 · ${crop.seconds/3600} h base grow time
        ${s?'':' · Plot required '+escape(crop.plot)}
        ${city.technologies.includes(crop.tech)?'':' · Requires '+escape(crop.tech)+' research'}
        ${!s&&tile.resource==='land'?` <button data-crop-plan="${escape(name)}">Plan ${escape(name)}</button>`:''}</li>`;
    }).join('')}</ul></details>`:'';
  if (tile.resource==='prospect') {
    if (tile.report) html += `<p>${escape(tile.report.message)} · Tier ${tile.report.tier}</p>`;
    if (!tile.survey && !tile.report?.mineral) {
      html += '<div class="actions">' + [3,8,18].map((fee,i) => !tile.report || tile.report.tier<i+1 ?
        button(`Survey ${i+1} · ${fee} coins`,{op:'survey',site:selected,tier:i+1}) : '').join('') + '</div>';
    }
  }
  if (!s) {
    const valid = Object.keys(catalog.sites).filter(name => eligible(tile,name)).sort();
    return html + form('Place blueprint','plan',valid,'<label hidden id="ropeOption"><input name="rope" type="checkbox"> Use rope instead of fittings</label>') + `<div id="preview" class="muted"></div>` + cropList;
  }
  if (s.construction) return html+'<p>The building opens when the timer reaches zero.</p>';
  if (!s.built) {
    const needs=s.construction_needs??[];
    const missing=needs.some(need=>need.delivered<need.required);
    const supplies=city.cargo.filter(lot=>needs.some(need=>need.delivered+need.incoming<need.required&&
      need.goods.some(good=>good===lot.good||(['log','plank'].includes(good)&&lot.good.endsWith(' '+good)))));
    return html+`<h3>Materials to deliver</h3><p>Build time · ${s.construction_seconds/60} min</p>`+
      (needs.length?`<ul>${needs.map(need=>`<li><strong>${escape(need.goods.join(' or '))}</strong> ·
        ${need.delivered} of ${need.required} delivered · ${need.required-need.delivered} missing
        ${need.incoming?' · '+need.incoming+' on the way by haul':''}</li>`).join('')}</ul>`:
        '<p>Starter grant covers the construction materials.</p>')+
      (supplies.length?'<h3>Ready to deliver from your cargo</h3>'+stock(supplies,true,'materials','deliver'):'')+
      (s.materials.length?'<h3>Materials on site</h3>'+stock(s.materials,true,'materials'):'')+
      '<div class="actions">'+(missing?'<button disabled>Start construction</button>':button('Start construction',{op:'build',site:selected}))+
      button('Cancel blueprint',{op:'cancel',site:selected})+'</div>'+
      form('Move blueprint','move blueprint',Object.values(city.tiles).filter(t=>!city.sites[t.id] && eligible(t,s.kind)).map(t=>t.id)) + cropList;
  }
  html += `<p>Level ${s.level}${s.worker===null?'':' · Crew '+s.worker+' · Skill '+s.skill}</p>`;
  if (s.kind!=='town store') html += button('Demolish building',{op:'demolish',site:selected});
  if (s.batch) html += `<p>Next batch · ${eta(s.batch.at)} · Q${s.batch.q}</p>`;
  else if (s.recipe) {
    const recipe=catalog.recipes[s.recipe];
    const message=!city.technologies.includes(recipe.tech)?'Research '+recipe.tech:
      s.worker===null?'No qualified lead':total(s.output)+recipe.outputs.reduce((sum,[q])=>sum+q,0)>s.capacity.output?
      'Output full':'Waiting for recipe inputs';
    html += `<p>${escape(message)}</p>`;
  }
  if (s.crop) html += `<p>${escape(s.crop.name)} · ${s.crop.qty+(s.crop.pollinated && !['tea','coffee','olives'].includes(s.crop.name)?1:0)} units · ${eta(s.crop.at)}</p>
    <div class="actions">${button('Harvest',{op:'harvest',site:selected})}${button('Clear crop',{op:'clear crop',site:selected})}</div>`;
  const crops=cropRows.map(([name])=>name);
  if (!s.crop && crops.length) html += form('Plant crop','plant',crops,'<label><input type="checkbox" name="compost"> Apply compost</label>')+'<p id="preview"></p>';
  html+=cropList;
  if (s.options.length && !['paddock','apiary','fish pond'].includes(s.kind)) html += form('Set recipe','recipe',s.options)+ '<div id="ingredients"></div><p id="preview"></p>';
  if (!s.recipe && ['paddock','apiary','fish pond'].includes(s.kind)) {
    html+=form('Stock herd · 5 coins','herd',s.options.map(k=>k.split(' / ')[1]));
  }
  if (s.household) {
    const h=s.household;
    html+=`<h3>Household</h3><p>${h.score.toFixed(1)} / 100 · ${h.hours} / 24 hours · ${h.families.length} food families</p>
      <p>${Object.entries(h.coverage).map(([k,v])=>k+' '+Math.round(v*100)+'%').join(' · ')}</p>`;
  }
  for (const buf of ['output','input','shared','pantry']) {
    const show=s[buf].length>0||(buf==='input'&&(s.input_goods??[]).length>0)||
      (buf==='output'&&(s.options.length||crops.length))||
      (buf==='shared'&&(s.marketplace||['warehouse','export depot'].includes(s.kind)))||
      (buf==='pantry'&&['town store','cottage','townhouse','apartment house'].includes(s.kind));
    if (!show||!s.capacity[buf]) continue;
    const supplies=buf==='input'?city.cargo.filter(lot=>(s.input_goods??[]).some(good=>
      good===lot.good||(['log','plank'].includes(good)&&lot.good.endsWith(' '+good)))):city.cargo;
    const heading={output:'Finished goods',input:'Inputs',shared:'Storage',pantry:'Pantry'}[buf];
    html+=`<details open><summary>${heading} · ${total(s[buf])} / ${s.capacity[buf]}</summary>`+
      stock(s[buf],true,buf,'pickup',buf==='shared'&&s.marketplace);
    if (buf!=='output'&&supplies.length) html+='<p class="muted">In your cargo</p>'+stock(supplies,true,buf,'deliver');
    html+='</details>';
  }
  if (s.staffing_requirement!=null) {
    html+=`<details><summary>Staffing priority · ${['Low','Normal','High'][s.staff_priority]}</summary>
      <p>${s.visiting?'Visiting instructor':s.worker===null?'Vacant':'Staffed'} · Education ${s.staffing_requirement}+</p>
      <p>Higher-priority sites get qualified workers first.</p>`+
      ['Low','Normal','High'].map((label,priority)=>priority===s.staff_priority
        ?`<button disabled aria-pressed="true">${label}</button>`:
        button(label,{op:'staff priority',site:selected,priority})).join(' ');
    if (s.worker!==null) html+=button(`Train crew · ${s.skill} coins`,{op:'train',site:selected});
    if (s.school_coverage) {
      const school=s.school_coverage;
      html+=`<p>${school.used} / ${school.capacity} coverage places · ${school.radius} m walking range · ${school.class_size} seats per class</p>`;
    }
    if (s.last_class) html+=`<p>Last class · ${s.last_class.graduated} graduated · ${s.last_class.failed} reached their education limit</p>`;
    if (s.school_coverage && !s.course && (s.visiting||s.worker!==null)) {
      html+=button('Enroll eligible residents',{op:'enrol',site:selected});
    }
    html+='</details>';
  }
  const services=s.service_coverage??[];
  if (s.level<10 && !s.reclaim) html+=`<details><summary>Upgrade to level ${s.level+1}</summary>
    ${services.map(row=>`<p>${escape(row.label)} within ${row.radius} m · ${row.covered?'Covered':row.at_capacity?'At capacity':'Needed'}</p>`).join('')}
    <p>${escape(cost(s.next_cost))}</p>`+stock(s.upgrade,true,'upgrade')+
    stock(city.cargo,true,'upgrade','deliver')+
    (s.level>=3 && ['library','market hall','clock tower'].includes(s.kind)?['bricks','glazed tiles','dressed marble','roof slates'].map(good=>button('Use '+good,{op:'upgrade materials',site:selected,good})).join(' '):'')+button('Finish upgrade',{op:'upgrade',site:selected,level:s.level+1},services.some(row=>!row.covered))+'</details>';
  if (s.marketplace) {
    html+='<h3>Buy supplies</h3><p>Collect purchases from this marketplace’s stock.</p>'+
      Object.entries(city.supply_prices).map(([good,price])=>`<div class="row">${escape(good)} · ${price} coins each
        ${[1,3].map(qty=>button(`Buy ${qty} · ${qty*price} coins`,{op:'buy supplies',site:selected,good,qty})).join(' ')}</div>`).join('')+
      (city.supply_prices['pine log']===undefined?'<p>Build a sawmill to buy logs.</p>':'');
    html+='<h3>Market orders</h3>'+marketGuide()+Object.entries(city.market_orders).map(([slot,order])=>{
      if (!order) return '';
      if (order.refresh) return `<p>Next order · ${eta(order.refresh)}</p>`;
      return `<div class="row"><strong>${escape(city.sites[slot]?.kind??'Town Store')}</strong> ·
      Sell ${order.qty} ${escape(order.good)} for ${order.payout} coins
      <p>${total(s.shared.filter(lot=>lot.good===order.good))} of ${order.qty} in this marketplace’s stock</p>
      ${button('Sell to buyer',{op:'fill market order',site:selected,slot,order:order.id})}
      ${button('Dismiss',{op:'dismiss market order',site:selected,slot,order:order.id})}</div>`;
    }).join('');
  }
  if (s.conversion_kind) {
    html+=`<details><summary>Convert to ${escape(s.conversion_kind)}</summary><p>${escape(cost(s.conversion_cost))}</p>`+
      stock(s.conversion,true,'conversion')+stock(city.cargo,true,'conversion','deliver')+
      (s.kind==='cottage'?button('Use chairs',{op:'conversion materials',site:selected,cabinets:false})+
        button('Use polished cabinets',{op:'conversion materials',site:selected,cabinets:true}):'')+
      button('Finish conversion',{op:'convert',site:selected,kind:s.conversion_kind})+'</details>';
  }
  if (s.kind==='export depot') {
    html+='<h3>Export orders</h3>'+city.offers.map(o=>`<div class="row">${o.qty} × ${escape(o.good)} · Q${o.floor}+
      ${city.orders[o.id]?'':button('Accept',{op:'accept export',order:o.id})}</div>`).join('');
    for (const order of Object.values(city.orders)) {
      html+=`<div class="row">${order.qty} × ${escape(order.good)} · Q${order.floor}+ ·
        ${order.expires<=city.now && order.status==='active'?'Expired':escape(order.status)}
        ${order.status==='active' && order.expires>city.now?
          button('Ship',{op:'ship export',site:selected,order:order.id})+
          button('Abandon',{op:'abandon export',order:order.id}):''}</div>`;
    }
  }
  if (s.kind==='machine works') html+=button('Fit vehicle kit',{op:'fit kit',site:selected});
  return html;
}
function cityPanel() {
  const jobs=city.jobs.map(j=>`<div class="row">${escape(j.src)} → ${escape(j.dst)} · ${total(j.lots)} units ·
    ${j.fee?j.fee+' coins':'voucher'} · ${j.done?'Delivered':eta(j.at)}</div>`).join('');
  const directory=new Map();
  for (const tile of Object.values(city.tiles)) {
    const site=city.sites[tile.id];
    const group=tile.city_center?'City Center':site
      ?!site.built?'Construction':catalog.sites[site.kind]?.plot?'Farming':site.options.length?'Production':'Other buildings'
      :tile.resource==='land'?'Land':'Natural resources';
    const list=directory.get(group)??[];
    list.push(tile);
    directory.set(group,list);
  }
  const sites=['City Center','Construction','Farming','Production','Other buildings','Natural resources','Land'].map(group=>{
    const entries=directory.get(group);
    if (!entries?.length) return '';
    return `<details ${group==='City Center'||group==='Construction'?'open':''}><summary>${group} · ${entries.length}</summary>
      ${entries.map(t=>`<p><button data-site="${escape(t.id)}">${escape(t.city_center?'City Center':city.sites[t.id]?.kind??t.report?.mineral??t.resource)}
        ${t.id===city.marked_tile?' ⚑':''}</button>
        ${escape(siteAttention(city.sites[t.id],currentCityTime()).join(' · '))}</p>`).join('')}</details>`;
  }).join('');
  return `<h2>City</h2><p>${city.citizens.length} residents · Education ${city.education.toFixed(1)} · ${Object.keys(city.tiles).length} tiles</p>
    <h3>Cargo</h3>${stock(city.cargo)}<h3>Sites</h3>${city.marked_tile?'<button data-focus-marker="true">Show marked tile on map</button>':''}${sites}
    <h3>Hired transport</h3><p>${city.vouchers} vouchers</p>${jobs}
    <form data-form="haul">
      <label>Source<select name="source">${options(Object.keys(city.sites))}</select></label>
      <label>Source buffer<select name="source_buffer">${options(['output','shared','input'])}</select></label>
      <label>Destination<select name="destination">${options(Object.keys(city.sites))}</select></label>
      <label>Destination buffer<select name="buffer">${options(['input','shared','pantry','materials','upgrade','conversion'])}</select></label>
      <label>Commodity<select name="good">${options(Object.keys(catalog.prices).sort())}</select></label>
      <label>Units <input type="number" min="1" value="1" name="qty" required></label>
      <label><input type="checkbox" name="voucher"> Use one voucher</label><button>Quote haul</button>
    </form><div id="quote"></div>
    <div class="actions">${button('Sandbox · Add five vouchers',{op:'purchase',receipt:String(Date.now())})}</div>
    <div class="actions"><button id="delete">Delete city</button></div>`;
}
function researchPanel() {
  const tierRequirements=city.research_requirements??[];
  const meetsRequirements=tier=>(tierRequirements[tier]??[]).every(row=>row.actual>=row.required);
  const tech=catalog.technologies;
  const tiers=[], depths=new Map();
  function depth(name) {
    if (!depths.has(name)) depths.set(name,Math.max(0,...tech[name][1].map(dependency=>depth(dependency)+1)));
    return depths.get(name);
  }
  for (const name of Object.keys(tech)) (tiers[depth(name)]??=[]).push(name);
  const height=Math.max(...tiers.map(tier=>tier.length))*66;
  const width=tiers.length*186-24;
  const nodes=tiers.flatMap((tier,column)=>tier.map((name,row)=>({
    name,x:column*186+4,y:(height-tier.length*66)/2+row*66+4,
  })));
  const positions=new Map(nodes.map(node=>[node.name,node]));
  const choice=researchChoice??city.research?.name??nodes[0].name;
  const links=nodes.flatMap(to=>tech[to.name][1].map(parent=>{
    const from=positions.get(parent);
    const x=from.x+144,y=from.y+27,end=to.y+27,mid=(x+to.x)/2;
    const route=to.x-x>186?`M${x} ${y} H${x+12} V${height-4} H${to.x-12} V${end} H${to.x}`:
      `M${x} ${y} C${mid} ${y},${mid} ${end},${to.x} ${end}`;
    return `<path d="${route}" stroke="${to.name===choice?'#f3c471':'#769162'}" fill="none" stroke-width="2"/>`;
  })).join('');
  const cards=nodes.map(({name,x,y})=>{
    const [tier,parents]=tech[name];
    const state=city.technologies.includes(name)?'Complete':city.research?.name===name?'In progress':
      !city.research&&city.coins>=catalog.research_costs[tier][0]&&
        parents.every(parent=>city.technologies.includes(parent))&&meetsRequirements(tier)?'Available':'Locked';
    return `<button class="research-node" style="left:${x}px;top:${y}px" data-research="${escape(name)}"
      aria-pressed="${name===choice}">${escape(name)}<br><small>${state}</small></button>`;
  }).join('');
  const [tier,prerequisites]=tech[choice];
  const [fee,seconds]=catalog.research_costs[tier];
  const missing=prerequisites.filter(name=>!city.technologies.includes(name));
  const active=city.research?.name===choice;
  const known=city.technologies.includes(choice);
  const crops=Object.entries(catalog.crops).filter(([,crop])=>crop.tech===choice).map(([name])=>name);
  const goods=[...new Set(Object.values(catalog.recipes).filter(r=>r.tech===choice)
    .flatMap(r=>r.outputs.map(([,name])=>name+' at '+r.site)))].sort();
  return `<h2>Research</h2><div id="research-tree"><div style="position:relative;width:${width}px;height:${height}px">
    <svg width="${width}" height="${height}" aria-hidden="true">${links}</svg>${cards}</div></div>
    <h3>${escape(choice)}</h3>
    ${active?taskCard({kind:'research',label:'Research',...city.research,duration:city.research.duration??seconds}):
      known?'<p>Complete</p>':`<p>${fee} coins · ${seconds/60} min</p>`}
    ${missing.length?`<p>Requires ${escape(missing.join(', '))}</p>`:''}
    ${!known&&!active?(tierRequirements[tier]??[]).map(row=>`<p>${escape(row.label)} · ${row.actual} / ${row.required}</p>`).join(''):''}
    ${!known&&!city.research&&!missing.length?button('Start research',{op:'research',name:choice},city.coins<fee||!meetsRequirements(tier)):''}
    ${crops.length?`<p>Crops · ${escape(crops.join(', '))}</p>`:''}
    ${goods.length?`<p>Production · ${escape(goods.join(', '))}</p>`:''}`;
}
function search(query='') {
  const match = text => text.toLowerCase().includes(query.toLowerCase());
  const goods=Object.keys(catalog.prices).filter(match).sort();
  const recipes=Object.entries(catalog.recipes).filter(([key,r])=>match(key)||r.inputs.some(([,ns])=>ns.some(match)));
  el('results').innerHTML = goods.map(g=>{
    const use=catalog.consumers[g];
    const sources=Object.values(city.sites).filter(s=>s.recipe && catalog.recipes[s.recipe].outputs.some(([,n])=>n===g));
    return `<div class="row"><strong>${escape(g)}</strong> · ${catalog.prices[g]} coins
      ${use?`<p>Household ${escape(use[0])} · ${escape(use[1])} · ${use[2]} uses</p>`:''}
      ${sources.length?`<p>Discovered producers ${sources.map(s=>`<button data-site="${escape(s.id)}">${escape(s.kind)} · ${escape(s.id)}</button>`).join(' ')}</p>`:''}</div>`;
  }).join('')+recipes.map(([key,r])=>`<div class="row"><strong>${escape(key)}</strong><p>${escape(cost(r.inputs))} → ${escape(r.outputs.map(([q,n])=>q+' '+n).join(' + '))}</p><p>${r.seconds/60} min · ${escape(r.tech)}</p></div>`).join('');
}
function render() {
  if (!city || !catalog) return;
  el('balance').textContent = `${Number(city.coins.toFixed(2))} coins · Cargo ${total(city.cargo)}/${city.capacity} · ${city.xp} XP`;
  el('walk').textContent = city.walking?'Stop walk':'Start walk';
  el('tracking').textContent = city.walking?`Tracking · ${Math.floor((city.now-city.walk_started)/60)} min`:'Tracking off';
  map();
  document.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.panel===panel)));
  const content=panel==='site'?sitePanel():panel==='city'?cityPanel():panel==='research'?researchPanel():
    '<h2>Almanac</h2><label>Search goods, crops and recipes<input id="search" type="search"></label><div id="results"></div>';
  const notice=actionFailure?.scope===actionScope()?
    `<div class="action-notice" role="alert">${escape(actionFailure.message)}
      <button data-dismiss-error="true" aria-label="Dismiss message">×</button></div>`:'';
  el('panel').innerHTML=notice+content;
  if (panel==='almanac') search('');
  preview();
}
function preview() {
  const form=el('panel').querySelector('form[data-form="plan"],form[data-form="recipe"],form[data-form="plant"]');
  const target=el('preview');
  if (!form||!target||!form.elements.name.value) return;
  const name=form.elements.name.value;
  if (form.dataset.form==='plan') {
    const free=['lumberjack station','sawmill'].includes(name)&&(!city.grants.includes(name)||city.starter_rebuilds?.includes(name));
    const site=catalog.sites[name];
    el('ropeOption').hidden=name!=='warehouse';
    const buildCost=name==='warehouse' && form.elements.rope.checked?'6 plank + 4 rope':cost(site.cost);
    target.innerHTML = `<strong>Construction · ${escape(free?'Starter grant':buildCost)}</strong>`+
      `<p>Build time · ${(free?catalog.starter_construction_seconds:catalog.building_details[name].construction_seconds)/60} min</p>`+
      buildingInfo(name,city.tiles[selected]);
  } else if (form.dataset.form==='recipe') {
    const r=catalog.recipes[name];
    target.textContent=`${cost(r.inputs)} · ${r.seconds/60} min at level 1 · ${r.tech}`;
    const ingredients=el('ingredients');
    ingredients.innerHTML=r.inputs.map(([q,ns])=>`<label>${q} units<select form="recipe-form" name="choice">${options(ns)}</select></label>`).join('')+
      '<label>Minimum Q <input name="minimum" form="recipe-form" type="number" min="0" max="100" value="0"></label>';
    form.id='recipe-form';
  } else {
    const crop=catalog.crops[name];
    const level=city.sites[selected].level;
    const speed=[1,1.25,1.5,1.75,2,2.25,2.5,3,3.5,4][level-1];
    const match=city.tiles[selected].soil===crop.soil;
    const base=(city.sites[selected].crop_forecast??city.crop_forecast)[match?'match':'mismatch'];
    const estimate=form.elements.compost.checked&&base.with_compost?base.with_compost:base;
    target.textContent=`Soil suitability ${base.suitability}/100 · Est. harvest ${estimate.qty} units at Q${estimate.q}/100 · ${crop.seconds/(3600*speed)} h · ${crop.tech}`;
  }
}
document.addEventListener('click', async event=>{
  const b=event.target.closest('button');
  if (!b) return;
  if (b.dataset.focusMarker&&city.marked_tile) {
    selected=focusedMapTile=city.marked_tile;
    panel='site';
    cropPlan=undefined;
    actionFailure=undefined;
    render();
    return;
  }
  if (b.dataset.dismissError) {actionFailure=undefined;render();return;}
  if (b.dataset.site||b.dataset.cropPlan||b.dataset.cropBack||b.dataset.panel) actionFailure=undefined;
  if (b.dataset.site) {selected=b.dataset.site;panel='site';cropPlan=undefined;render();}
  if (b.dataset.cropPlan) {cropPlan=b.dataset.cropPlan;render();}
  if (b.dataset.cropBack) {cropPlan=undefined;render();}
  if (b.dataset.research) {
    const scroll=el('research-tree').scrollLeft;
    researchChoice=b.dataset.research;
    render();
    el('research-tree').scrollLeft=scroll;
  }
  if (b.dataset.panel) {panel=b.dataset.panel;cropPlan=undefined;render();}
  if (b.dataset.action) {
    const action=JSON.parse(b.dataset.action);
    if (action.op!=='demolish' || confirm('Demolish this building? Stored goods go to the town store.')) act(action);
  }
  if (b.dataset.dx) act({op:'step',dx:Number(b.dataset.dx),dy:Number(b.dataset.dy)});
  if (b.id==='walk') act({op:'walk',enabled:!city.walking});
  if (b.id==='clock') {
    const entry=prompt('Advance the development clock by minutes','15');
    if (entry!==null) act({op:'advance',seconds:Number(entry)*60});
  }
  if (b.id==='delete' && confirm('Delete this city and its location history permanently?')) {
    try {
      await request('city','DELETE');
      localStorage.removeItem('vestigia.city');
      localStorage.removeItem('vestigia.pending');
      location.reload();
    } catch (error) {say(error.message);}
  }
});
document.addEventListener('input',event=>{if(event.target.id==='search')search(event.target.value);});
document.addEventListener('change',event=>{if(['name','compost','rope'].includes(event.target.name))preview();});
document.addEventListener('submit',async event=>{
  const form=event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const data=new FormData(form);
  const operation=form.dataset.form;
  const name=data.get('name');
  const a={op:operation,site:selected};
  if (operation==='plan') { a.kind=name; a.rope=data.has('rope'); }
  else if (operation==='move blueprint') a.destination=name;
  else if (operation==='haul') {
    a.site=data.get('source');
    for (const key of ['source_buffer','destination','buffer','good']) a[key]=data.get(key);
    a.qty=Number(data.get('qty'));
    a.voucher=data.has('voucher');
    try {
      const quote=await request('quote','POST',{source:a.site,destination:a.destination});
      el('quote').innerHTML=`<p>${quote.metres} m · ${quote.seconds/60} min · ${a.voucher?'1 voucher':quote.fee+' coins'} · Up to ${quote.capacity} units</p>`+
        button('Confirm haul',a,a.qty>quote.capacity);
    } catch (error) {say(error.message);}
    return;
  } else a.name=name;
  if (operation==='plant') a.compost=data.has('compost');
  if (operation==='recipe') {
    a.choices=data.getAll('choice');
    a.minimum=Number(data.get('minimum'));
  }
  act(a);
});
async function start() {
  catalog=await request('catalog');
  if(token) {
    try {updateCity(await request('city'));}
    catch(error) {if(error.status!==401)throw error;token=null;}
  }
  if(!token) {
    const result=await request('city','POST');
    token=result.token;updateCity(result.city);
    localStorage.setItem('vestigia.city',token);
    localStorage.removeItem('vestigia.pending');
  }
  await flush();
  render();
}
window.addEventListener('online',()=>{if(!busy)start().catch(error=>say(error.message));});
start().catch(error=>say(error.message));

let lastTileNoticeCheck=0, refreshingTasks=false;
setInterval(()=>{
  if (!city||busy) return;
  const now=currentCityTime();
  document.querySelectorAll('[data-task]').forEach(card=>{
    const [label,value]=taskProgress(JSON.parse(card.dataset.task),now);
    card.querySelector('span').textContent=label;
    const progress=card.querySelector('progress');
    if (value!==undefined) {progress.hidden=false;progress.value=value;}
  });
  if (Object.values(city.sites).some(site=>site.crop&&site.crop.at>lastTileNoticeCheck&&site.crop.at<=now)) map();
  lastTileNoticeCheck=now;
  if (refreshingTasks||!Object.values(city.tiles).some(tile=>tile.tasks?.some(task=>task.kind!=='crop'&&task.at!=null&&task.at<=now))) return;
  const previous=city;
  refreshingTasks=true;
  request('city').then(state=>{
    if (busy||city!==previous) return;
    updateCity(state);
    if (panel==='site'||panel==='research') render();
    else map();
  }).catch(()=>{}).finally(()=>{refreshingTasks=false;});
},5000);
