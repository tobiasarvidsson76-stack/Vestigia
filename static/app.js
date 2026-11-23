'use strict';
const el = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));
let city, catalog, selected = '0,0', panel = 'site', busy = false;
let token = localStorage.getItem('vestigia.city');
const total = stock => stock.reduce((sum, lot) => sum + lot.qty, 0);
const cost = items => items.length ? items.map(([q, names]) => `${q} ${names.join(' or ')}`).join(' + ') : 'Free';
const eta = at => at === null ? 'Paused' : at <= city.now ? 'Ready' : `${Math.ceil((at-city.now)/60)} min`;
const options = values => values.map(value => `<option>${escape(value)}</option>`).join('');
function button(label, action) {
  return `<button data-action="${escape(JSON.stringify(action))}">${escape(label)}</button>`;
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
    city = state;
    localStorage.removeItem('vestigia.pending');
  }, error => {
    if (error.status) localStorage.removeItem('vestigia.pending');
    throw error;
  });
}
async function act(action) {
  if (busy || !city) return;
  busy = true;
  try {
    await flush();
    const key = globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random();
    localStorage.setItem('vestigia.pending',JSON.stringify({action,key}));
    await flush();
    if (action.op === 'step') {
      const id = position();
      if (city.tiles[id]) selected = id;
    }
    say('');
  } catch (error) {
    say(error.status ? error.message : 'Connection lost. One command is pending sync.');
  } finally {
    busy = false;
    render();
  }
}
function position() {
  return city.fix ? [Math.round(city.fix.x/60),Math.round(city.fix.y/60)].join(',') : '0,0';
}
function map() {
  const [x,y] = position().split(',').map(Number);
  const cells = [];
  for (let j=y-2;j<=y+2;j++) {
    for (let i=x-3;i<=x+3;i++) {
      const id = [i,j].join(',');
      const tile = city.tiles[id];
      const road = city.roads[id];
      const tier = road ? Math.max(road.paid, [1,3,10,30].filter(n => road.passages>=n).length) : 0;
      const name = city.sites[id]?.kind ?? tile?.report?.mineral ?? tile?.resource ?? 'Fog';
      cells.push(`<button class="cell ${tile?'known':''} ${id===selected?'selected':''}
        ${id===position()?'current':''} ${['','trail','dirt','gravel','paved'][tier]}"
        ${tile ? `data-site="${id}"` : 'disabled'} aria-label="${escape(name)} at ${i*60}, ${j*60} metres">${tile?escape(name):''}</button>`);
    }
  }
  el('map').innerHTML = cells.join('');
}
function stock(items, transfers=false, buf='', op='pickup') {
  if (!items.length) return '<p class="muted">Empty</p>';
  return items.map(l => `<div class="row">${l.qty} × ${escape(l.good)} · Q${l.q}
    ${transfers ? button(op==='pickup'?'Collect 1':'Deliver 1',{op,site:selected,buffer:buf,good:l.good,qty:1,quality:l.q}):''}</div>`).join('');
}
function eligible(tile, name) {
  const resource = tile.resource;
  if (name === 'town store') return false;
  if (name === 'mine') return Boolean(tile.report?.mineral);
  if (name === 'lumberjack station') return ['pine','spruce','birch','oak','ash'].includes(resource);
  if (name === 'field') return resource === 'field';
  const source = Object.values(catalog.recipes).filter(r => r.site===name && !r.inputs.length);
  return !source.length || source.some(r => r.outputs[0][1]===resource);
}
function form(label, name, choices, extra='') {
  return `<form data-form="${name}"><label>${escape(label)}<select name="name" required>
    ${options(choices)}</select></label>${extra}<button type="submit">${escape(label)}</button></form>`;
}
function sitePanel() {
  const tile = city.tiles[selected];
  if (!tile) return '<p>Select a revealed tile.</p>';
  const s = city.sites[selected];
  const title = s?.kind ?? tile.report?.mineral ?? tile.resource;
  const distance = city.fix ? Math.round(Math.hypot(tile.x-city.fix.x,tile.y-city.fix.y)) : null;
  let html = `<h2>${escape(title)}</h2><p class="muted">${tile.x} m east · ${tile.y} m south ·
    ${distance===null?'No recent fix':distance+' m away'} · ${tile.nearby?'In range':'40 m interaction radius'}</p>
    <p>Soil ${tile.soil}${tile.grade===undefined?'':' · Natural grade '+tile.grade}</p>`;
  if (tile.resource==='prospect') {
    if (tile.report) html += `<p>${escape(tile.report.message)} · Tier ${tile.report.tier}</p>`;
    if (tile.survey) html += `<p>Survey due in ${eta(tile.survey.at)}</p>`;
    if (!tile.survey && !tile.report?.mineral) {
      html += '<div class="actions">' + [3,8,18].map((fee,i) => !tile.report || tile.report.tier<i+1 ?
        button(`Survey ${i+1} · ${fee} coins`,{op:'survey',site:selected,tier:i+1}) : '').join('') + '</div>';
    }
  }
  if (!s) {
    const valid = Object.keys(catalog.sites).filter(name => eligible(tile,name)).sort();
    return html + form('Place blueprint','plan',valid,'<label hidden id="ropeOption"><input name="rope" type="checkbox"> Use rope instead of fittings</label>') + `<p id="preview" class="muted"></p>`;
  }
  if (!s.built) {
    return html+`<p>Construction · ${escape(cost(s.cost))}</p>`+stock(s.materials,true,'materials')+
      '<h3>Cargo deliveries</h3>'+stock(city.cargo,true,'materials','deliver')+
      '<div class="actions">'+button('Finish construction',{op:'build',site:selected})+
      button('Cancel blueprint',{op:'cancel',site:selected})+'</div>'+
      form('Move blueprint','move blueprint',Object.values(city.tiles).filter(t=>!city.sites[t.id] && eligible(t,s.kind)).map(t=>t.id));
  }
  html += `<p>Level ${s.level}${s.worker===null?'':' · Crew '+s.worker+' · Skill '+s.skill}</p>`;
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
  const crops=Object.keys(catalog.crops).filter(name=>catalog.crops[name].plot===catalog.sites[s.kind]?.plot);
  if (!s.crop && crops.length) html += form('Plant crop','plant',crops,'<label><input type="checkbox" name="compost"> Apply compost</label>')+'<p id="preview"></p>';
  if (s.options.length && !['paddock','apiary','fish pond'].includes(s.kind)) html += form('Set recipe','recipe',s.options)+ '<div id="ingredients"></div><p id="preview"></p>';
  if (!s.recipe && ['paddock','apiary','fish pond'].includes(s.kind)) {
    html+=form('Stock herd · 5 coins','herd',s.options.map(k=>k.split(' / ')[1]));
  }
  if (s.household) {
    const h=s.household;
    html+=`<h3>Household</h3><p>${h.score.toFixed(1)} / 100 · ${h.hours} / 24 hours · ${h.families.length} food families</p>
      <p>${Object.entries(h.coverage).map(([k,v])=>k+' '+Math.round(v*100)+'%').join(' · ')}</p>`;
    if (s.kind!=='town store') html+=button(`Claim ${s.tax} coins`,{op:'tax',site:selected});
  }
  for (const buf of ['output','input','shared','pantry']) {
    if (!s.capacity[buf] || (buf==='input' || buf==='output') && !s.options.length && !crops.length && !s[buf].length && !['primary school','technical college','university'].includes(s.kind)) continue;
    html+=`<details open><summary>${buf} · ${total(s[buf])} / ${s.capacity[buf]}</summary>`+stock(s[buf],true,buf);
    if (buf!=='output' && city.cargo.length) html+=stock(city.cargo,true,buf,'deliver');
    if (buf==='shared' && s.kind==='town store') html+=s.shared.map(l=>button('Sell '+l.good,{op:'sell',site:selected,good:l.good,qty:l.qty})).join(' ');
    html+='</details>';
  }
  if (catalog.sites[s.kind]?.credential!==null && catalog.sites[s.kind]?.credential!==undefined || ['primary school','technical college','university'].includes(s.kind)) {
    html+=`<details><summary>Staffing and training</summary><p>${s.worker===null?'Unstaffed':'Lead '+s.worker}${s.visiting?' · Visiting lecturer':''}</p>`+
      form('Assign lead','staff',city.citizens.map(c=>`${c.id} · E${c.education} · ${c.assignment?.join(' ')??'available'}`))+
      button('Remove lead',{op:'staff',site:selected,citizen:null})+' '+button(`Train · ${s.skill} coins`,{op:'train',site:selected});
    if (['primary school','technical college','university'].includes(s.kind)) {
      html += s.course?`<p>Course · ${eta(s.course.at)}</p>`:form('Enrol one student','enrol',city.citizens.filter(c=>!c.assignment).map(c=>`${c.id} · E${c.education}`));
    }
    html+='</details>';
  }
  if (s.level<10 && !s.reclaim) html+=`<details><summary>Upgrade to level ${s.level+1}</summary>
    <p>${escape(cost(s.next_cost))}</p>`+stock(s.upgrade,true,'upgrade')+
    stock(city.cargo,true,'upgrade','deliver')+
    (s.level>=3 && ['library','market hall','clock tower'].includes(s.kind)?['bricks','glazed tiles','dressed marble','roof slates'].map(good=>button('Use '+good,{op:'upgrade materials',site:selected,good})).join(' '):'')+button('Finish upgrade',{op:'upgrade',site:selected,level:s.level+1})+'</details>';
  if (s.kind==='town store') {
    html+='<h3>Market orders</h3>'+Object.entries(city.market_orders).map(([slot,order])=>{
      if (!order) return '';
      if (order.refresh) return `<p>Next order · ${eta(order.refresh)}</p>`;
      return `<div class="row">${order.qty} × ${escape(order.good)} · ${order.payout} coins
      ${button('Submit',{op:'fill market order',slot,order:order.id})}
      ${button('Dismiss',{op:'dismiss market order',slot,order:order.id})}</div>`;
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
  const sites=Object.values(city.tiles).map(t=>`<button data-site="${escape(t.id)}">${escape(city.sites[t.id]?.kind??t.report?.mineral??t.resource)} · ${escape(t.id)}</button>`).join(' ');
  const roads=Object.entries(city.roads).map(([id,r])=>{
    const tier=Math.max(r.paid,[1,3,10,30].filter(n=>r.passages>=n).length);
    const staged=total(r.paving??[]);
    const material=total(city.cargo.filter(l=>l.good==='paving blocks'));
    return `<div class="row">${escape(id)} · ${['','Trail','Dirt','Gravel','Paving'][tier]} · ${r.passages} passages
      ${tier<4?button(`Upgrade · ${[4,12,30][tier-1]} coins`,{op:'road',road:id,tier:tier+1}):''}
      ${tier<4 && material && staged<3?button('Deposit paving block',{op:'deposit paving',road:id,tier:tier+1,qty:1}):''}
      ${tier<4 && staged===3?button('Finish paving upgrade',{op:'finish paving',road:id,tier:tier+1}):''}
      ${staged?button('Recover paving block',{op:'reclaim paving',road:id,qty:1}):''}</div>`;
  }).join('');
  return `<h2>City</h2><p>${city.citizens.length} residents · Education ${city.education.toFixed(1)} · ${Object.keys(city.tiles).length} tiles</p>
    <h3>Cargo</h3>${stock(city.cargo)}<h3>Revealed sites</h3><div class="actions">${sites}</div>
    <h3>Hired transport</h3><p>${city.vouchers} vouchers</p>${jobs}
    <form data-form="haul">
      <label>Source<select name="source">${options(Object.keys(city.sites))}</select></label>
      <label>Source buffer<select name="source_buffer">${options(['output','shared','input'])}</select></label>
      <label>Destination<select name="destination">${options(Object.keys(city.sites))}</select></label>
      <label>Destination buffer<select name="buffer">${options(['input','shared','pantry','materials','upgrade','conversion'])}</select></label>
      <label>Commodity<select name="good">${options(Object.keys(catalog.prices).sort())}</select></label>
      <label>Units <input type="number" min="1" max="12" value="1" name="qty" required></label>
      <label><input type="checkbox" name="voucher"> Use one voucher</label><button>Quote haul</button>
    </form><div id="quote"></div>
    <div class="actions">${button('Sandbox · Add five vouchers',{op:'purchase',receipt:String(Date.now())})}</div>
    <h3>Roads</h3>${roads}<div class="actions"><button id="delete">Delete city</button></div>`;
}
function researchPanel() {
  return '<h2>Research</h2>'+Object.entries(catalog.technologies).map(([name,[tier,req]])=>{
    const active=city.research?.name===name;
    const known=city.technologies.includes(name);
    return `<div class="row"><strong>${escape(name)}</strong><p>${known?'Complete':active?eta(city.research.at):
      `${[0,2,5,10,20][tier]} coins · ${[0,15,45,120,240][tier]} min`}</p>
      ${!known&&!active?`<p class="muted">Requires ${escape(req.join(', '))}</p>`:''}
      ${!known&&!city.research&&req.every(r=>city.technologies.includes(r))?button('Start research',{op:'research',name}):''}</div>`;
  }).join('');
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
  el('panel').innerHTML = panel==='site'?sitePanel():panel==='city'?cityPanel():panel==='research'?researchPanel():
    '<h2>Almanac</h2><label>Search goods, crops and recipes<input id="search" type="search"></label><div id="results"></div>';
  if (panel==='almanac') search('');
  preview();
}
function preview() {
  const form=el('panel').querySelector('form[data-form="plan"],form[data-form="recipe"],form[data-form="plant"]');
  const target=el('preview');
  if (!form||!target||!form.elements.name.value) return;
  const name=form.elements.name.value;
  if (form.dataset.form==='plan') {
    const free=['lumberjack station','sawmill'].includes(name)&&!city.grants.includes(name);
    const site=catalog.sites[name];
    el('ropeOption').hidden=name!=='warehouse';
    const buildCost=name==='warehouse' && form.elements.rope.checked?'6 plank + 4 rope':cost(site.cost);
    target.textContent = (free?'Starter grant':buildCost)+(site.credential===null?'':` · E${site.credential} lead`);
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
    target.textContent=`${crop.seconds/(3600*speed)} h · ${(city.tiles[selected].soil===crop.soil?4:2)+(form.elements.compost.checked?2:0)} units · ${crop.tech}`;
  }
}
document.addEventListener('click', async event=>{
  const b=event.target.closest('button');
  if (!b) return;
  if (b.dataset.site) {selected=b.dataset.site;panel='site';render();}
  if (b.dataset.panel) {panel=b.dataset.panel;render();}
  if (b.dataset.action) act(JSON.parse(b.dataset.action));
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
  else if (operation==='staff') a.citizen=parseInt(name,10);
  else if (operation==='enrol') a.students=[parseInt(name,10)];
  else if (operation==='haul') {
    a.site=data.get('source');
    for (const key of ['source_buffer','destination','buffer','good']) a[key]=data.get(key);
    a.qty=Number(data.get('qty'));
    a.voucher=data.has('voucher');
    try {
      const quote=await request('quote','POST',{source:a.site,destination:a.destination});
      el('quote').innerHTML=`<p>${quote.metres} m · ${quote.seconds/60} min · ${a.voucher?'1 voucher':quote.fee+' coins'}</p>`+button('Confirm haul',a);
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
    try {city=await request('city');}
    catch(error) {if(error.status!==401)throw error;token=null;}
  }
  if(!token) {
    const result=await request('city','POST');
    token=result.token;city=result.city;
    localStorage.setItem('vestigia.city',token);
    localStorage.removeItem('vestigia.pending');
  }
  await flush();
  render();
}
window.addEventListener('online',()=>{if(!busy)start().catch(error=>say(error.message));});
start().catch(error=>say(error.message));
