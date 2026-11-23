import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Alert, AppState, Button, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text,
  TextInput, View} from 'react-native';
import MapView, {Marker, Polygon, Polyline, PROVIDER_GOOGLE, type LatLng} from 'react-native-maps';
import VoucherStore from './VoucherStore';
import {API, nonce, request, RequestError, TOKEN, REFRESH, type Action} from './api';
import {acknowledge, clearWalk, enqueue, queued, sampleOf, TRACKING_TASK, WALK_STORAGE,
  type Walking} from './location';

type Lot = {good: string; qty: number; q: number};
type Tile = {id:string; x:number; y:number; latitude?:number; longitude?:number; resource:string;
  soil:string; nearby:boolean; eligible?:string[]; grade?:number; report?:{mineral?:string; message:string}; survey?:{at:number}};
type Cost = [number,string[]][];
type Recipe = {site:string; inputs:Cost; outputs:[number,string][]; tech:string; seconds:number};
type Site = {id:string; kind:string; built:boolean; cost:Cost; level:number; options:string[];
  shared:Lot[]; input:Lot[]; output:Lot[]; materials:Lot[]; upgrade:Lot[]; pantry:Lot[]; conversion:Lot[];
  next_cost:Cost; conversion_cost?:Cost; conversion_kind?:string;
  crop?:{name:string;at:number}; batch?:{at:number|null;q:number}; tax:number; worker:number|null;
  assessment?:string; household?:{hours:number;score:number;families:string[];coverage:Record<string,number>}};
type City = {mode:'fixture'|'gps'; origin:[number,number]|null; now:number; coins:number; xp:number;
  capacity:number; cargo:Lot[]; walking:boolean; walk_started:number|null; walk_session?:string;
  tiles:Record<string,Tile>; sites:Record<string,Site>; town_store?:string; technologies:string[];
  research?:{name:string;at:number}; grants:string[]; roads:Record<string,{passages:number;paid:number;line?:LatLng[]}>;
  citizens:{id:number;education:number;assignment?:[string,string]}[]; vouchers:number;
  jobs:{id:number;dst:string;at:number;done:boolean;fee:number}[];
  fix?:{x:number;y:number}; offers:{id:string;good:string;qty:number;floor:number}[];
  orders:Record<string,{id:string;good:string;qty:number;floor:number;status:string;expires:number}>;
  market_orders:Record<string,{id?:string;good:string;qty:number;payout:number;refresh?:number}|null>};
type Catalog = {sites:Record<string,{cost:Cost;plot:string|null}>; recipes:Record<string,Recipe>;
  technologies:Record<string,[number,string[]]>; crops:Record<string,{plot:string;soil:string;seconds:number}>;
  prices:Record<string,number>};
type Pending = {key:string; action:Action};
const MUTATION = 'vestigia.mutation';
const formatCost = (cost:Cost) => cost.map(([q,names])=>q+' '+names.join(' or ')).join(' + ') || 'Free';
const total = (lots:Lot[]) => lots.reduce((n,lot)=>n+lot.qty,0);

export default function App() {
  const [city,setCity]=useState<City>();
  const [catalog,setCatalog]=useState<Catalog>();
  const [selected,setSelected]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [walking,setWalking]=useState<Walking|null>(null);
  const [background,setBackground]=useState(false);
  const [pending,setPending]=useState(0);
  const [screen,setScreen]=useState<'Map'|'City'|'Research'|'Almanac'>('Map');
  const [query,setQuery]=useState('');
  const [needsAuth,setNeedsAuth]=useState(false);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [openPlan,setOpenPlan]=useState(false);
  const [planned,setPlanned]=useState<{metres:number;line:LatLng[]}>();
  const mapRef=useRef<MapView|null>(null);
  const [openRecipe,setOpenRecipe]=useState(false);
  const [recipeChoice,setRecipeChoice]=useState<string>();
  const [ingredients,setIngredients]=useState<string[]>([]);
  const [floors,setFloors]=useState<string[]>([]);
  const [premium,setPremium]=useState(false);
  const [compost,setCompost]=useState(false);
  const [openStaff,setOpenStaff]=useState(false);
  const [tick,setTick]=useState(Date.now());
  const [haul,setHaul]=useState<{site:string;source_buffer:string;good:string;qty:number}|null>(null);
  const [haulQty,setHaulQty]=useState('1');
  const [useVoucher,setUseVoucher]=useState(false);
  const working=useRef(false);
  const requests=useRef<Promise<unknown>>(Promise.resolve());
  const syncing=useRef<Promise<void>|null>(null);
  const session=useRef<Walking|null>(null);
  const subscription=useRef<Location.LocationSubscription|null>(null);
  const state=useRef<City|undefined>(undefined);
  const currentFix=useRef<Location.LocationObject|null>(null);

  const update=useCallback((value:City)=>{
    state.current=value;
    setCity(value);
    setSelected(old=>old in value.tiles?old:value.town_store??'');
  },[]);

  const send=useCallback(async (action:Action,key=nonce())=>{
    const next=requests.current.then(async ()=>{
      const value=await request<City>('command','POST',action,key);
      update(value);
      return value;
    });
    requests.current=next.catch(()=>undefined);
    return next;
  },[update]);

  const flushMutation=useCallback(async ()=>{
    const raw=await AsyncStorage.getItem(MUTATION);
    if (!raw) return;
    const command:Pending=JSON.parse(raw);
    try {
      await send(command.action,command.key);
      await AsyncStorage.removeItem(MUTATION);
    } catch(cause) {
      if(cause instanceof RequestError && cause.status===422) await AsyncStorage.removeItem(MUTATION);
      throw cause;
    }
  },[send]);

  const runMutation=useCallback(async (action:Action)=>{
    await flushMutation();
    await AsyncStorage.setItem(MUTATION,JSON.stringify({action,key:nonce()}));
    await flushMutation();
  },[flushMutation]);

  const syncWalk=useCallback(()=>{
    if(syncing.current) return syncing.current;
    const run=async ()=>{
      const active=session.current;
      let queue=await queued();
      setPending(queue.length);
      if(!active) return;
      const stale=queue.filter(entry=>entry.session!==active.session);
      if(stale.length) await acknowledge(stale);
      queue=queue.filter(entry=>entry.session===active.session);
      for(let offset=0;offset<queue.length;offset+=100) {
        const group=queue.slice(offset,offset+100);
        const key=`gps-${active.session}-${group[0].sample.at}-${group.at(-1)?.sample.at}-${group.length}`;
        await send({op:'gps samples',session:active.session,samples:group.map(entry=>entry.sample)},key);
        await acknowledge(group);
        setPending(Math.max(0,queue.length-offset-group.length));
      }
    };
    syncing.current=run().finally(()=>{syncing.current=null;});
    return syncing.current;
  },[send]);

  const startTracking=useCallback(async (active:Walking)=>{
    subscription.current?.remove();
    subscription.current=null;
    session.current=active;
    setWalking(active);
    await AsyncStorage.setItem(WALK_STORAGE,JSON.stringify(active));
    const running=await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
    if(active.background) {
      if(!running) {
        try {
          await Location.startLocationUpdatesAsync(TRACKING_TASK,{
            accuracy:Location.Accuracy.High, distanceInterval:3, timeInterval:4000,
            pausesUpdatesAutomatically:false, showsBackgroundLocationIndicator:true,
            foregroundService:{notificationTitle:'Vestigia walk active',notificationBody:'Tap to return to your city'},
          });
        } catch {
          active={...active,background:false};
          session.current=active;
          setWalking(active);
          await AsyncStorage.setItem(WALK_STORAGE,JSON.stringify(active));
        }
      }
      if(active.background) return;
    }
    if(running) await Location.stopLocationUpdatesAsync(TRACKING_TASK);
    subscription.current=await Location.watchPositionAsync({
      accuracy:Location.Accuracy.High,distanceInterval:3,timeInterval:4000,
    },fix=>{
      currentFix.current=fix;
      void enqueue(active.session,[fix]).then(syncWalk).catch(()=>setError('Walk samples are waiting to sync.'));
    });
  },[syncWalk]);

  const initialize=useCallback(async ()=>{
    setError('');
    const definition=await request<Catalog>('catalog');
    setCatalog(definition);
    let value:City;
    try {
      value=await request<City>('city');
    } catch(cause) {
      if(!(cause instanceof RequestError) || cause.status!==401) throw cause;
      try {
        const created=await request<{token:string;city:City}>('city','POST');
        await AsyncStorage.setItem(TOKEN,created.token);
        value=created.city;
      } catch(loginError) {
        if(loginError instanceof RequestError && loginError.status===401) {
          setNeedsAuth(true);
          return;
        }
        throw loginError;
      }
    }
    setNeedsAuth(false);
    update(value);
    await flushMutation();
    value=state.current??value;
    if(value.mode==='gps') {
      const saved:Walking|null=JSON.parse(await AsyncStorage.getItem(WALK_STORAGE)??'null');
      if(value.walking && value.walk_session && value.walk_started && saved?.session===value.walk_session) {
        await startTracking(saved);
        await syncWalk();
      } else {
        if(await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK)) {
          await Location.stopLocationUpdatesAsync(TRACKING_TASK);
        }
        await clearWalk();
      }
    }
  },[flushMutation,startTracking,syncWalk,update]);

  useEffect(()=>{
    void initialize().catch(cause=>setError(String(cause.message??cause)));
    return ()=>subscription.current?.remove();
  },[initialize]);

  useEffect(()=>{
    const listener=AppState.addEventListener('change',status=>{
      if(status==='active' && session.current) void syncWalk().catch(()=>setError('Walk samples are waiting to sync.'));
    });
    const poll=setInterval(()=>{
      setTick(Date.now());
      if(session.current && AppState.currentState==='active') {
        void syncWalk().catch(()=>setError('Walk samples are waiting to sync.'));
      }
    },5000);
    return ()=>{listener.remove();clearInterval(poll);};
  },[syncWalk]);

  const interact=async (action:Action)=>{
    if(working.current) return;
    working.current=true;
    setBusy(true);
    setError('');
    try {
      if(state.current?.mode==='gps' && ['build','pickup','deliver','plant','harvest','herd','upgrade',
        'convert','clear crop','fit kit','deposit paving','finish paving'].includes(action.op)) {
        const permission=await Location.getForegroundPermissionsAsync();
        if(!permission.granted) throw new Error('Allow foreground location to interact on-site.');
        const recent=currentFix.current;
        const fix=recent && Date.now()-recent.timestamp<=15000?recent:await Location.getCurrentPositionAsync(
          {accuracy:Location.Accuracy.High});
        if(session.current) {
          await syncWalk();
          await enqueue(session.current.session,[fix]);
          await syncWalk();
        } else {
          await send({op:'gps samples',session:state.current.walk_session,samples:[sampleOf(fix)]});
        }
      }
      await runMutation(action);
      if(action.op==='step') {
        const matching=Object.values(state.current?.tiles??{}).find(t=>t.nearby);
        if(matching) setSelected(matching.id);
      }
    } catch(cause) {setError(cause instanceof Error?cause.message:String(cause));}
    finally {working.current=false;setBusy(false);}
  };

  const walk=async (locateOnly=false)=>{
    if(!city || working.current) return;
    if(city.mode==='fixture') {await interact({op:'walk',enabled:!city.walking});return;}
    working.current=true;
    setBusy(true);
    setError('');
    try {
      if(city.walking && !locateOnly) {
        subscription.current?.remove();
        subscription.current=null;
        if(await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK)) {
          await Location.stopLocationUpdatesAsync(TRACKING_TASK);
        }
        await syncWalk();
        await runMutation({op:'walk',enabled:false});
        session.current=null;setWalking(null);await clearWalk();
        return;
      }
      const foreground=await Location.requestForegroundPermissionsAsync();
      if(!foreground.granted) throw new Error('Location is disabled. You can still inspect and manage your city.');
      let locked=false;
      if(background && !locateOnly) locked=(await Location.requestBackgroundPermissionsAsync()).granted;
      const fix=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});
      currentFix.current=fix;
      await send({op:'gps samples',session:city.walk_session,samples:[sampleOf(fix)]});
      if(!state.current?.town_store) throw new Error('Move to a mapped public pedestrian segment and try again.');
      if(!locateOnly) {
        const id=nonce();
        await runMutation({op:'walk',enabled:true,session:id});
        const started=state.current?.walk_started??Date.now()/1000;
        await startTracking({session:id,started,background:locked});
      }
    } catch(cause) {setError(cause instanceof Error?cause.message:String(cause));}
    finally {working.current=false;setBusy(false);}
  };

  const login=async ()=>{
    try {
      const ticket=await request<{token:string;refresh_token:string}>('login','POST',{email,password});
      await AsyncStorage.multiSet([[TOKEN,ticket.token],[REFRESH,ticket.refresh_token]]);
      setPassword('');
      await initialize();
    } catch(cause) {setError(cause instanceof Error?cause.message:String(cause));}
  };

  const action=(label:string,command:Action,key=label)=><Button key={key} color="#396449"
    title={label} disabled={busy} onPress={()=>void interact(command)}/>;
  const choose=(id:string)=>{setSelected(id);setScreen('Map');setOpenPlan(false);setPlanned(undefined);setOpenRecipe(false);setRecipeChoice(undefined);setOpenStaff(false);};
  const transfer=(lots:Lot[], buffer:string, site:string, op:'deliver'|'pickup')=>lots.map((lot,i)=>
    <View key={i} style={styles.row}><Text>{lot.qty} × {lot.good} · Q{lot.q}</Text>
      <View style={styles.buttons}>
        {action(op==='pickup'?'Collect 1':'Deliver 1',{op,site,buffer,good:lot.good,quality:lot.q,qty:1})}
        {op==='pickup'&&lot.qty>1&&city&&city.capacity>total(city.cargo)+1&&
          action('Collect load',{op,site,buffer,good:lot.good,quality:lot.q,qty:Math.min(lot.qty,city.capacity-total(city.cargo))})}
        {op==='pickup'&&['input','output','shared'].includes(buffer)&&<Button title="Plan haul"
          onPress={()=>{setHaul({site,source_buffer:buffer,good:lot.good,qty:lot.qty});setHaulQty('1');setScreen('City');}}/>}
      </View>
    </View>);
  const tile=city?.tiles[selected];
  const anchor=city?.fix??tile??{x:0,y:0};
  const gridX=Math.round(anchor.x/60);
  const gridY=Math.round(anchor.y/60);
  const fog=city?.origin ? gridRectangle(city.origin,gridX,gridY,10_000) : [];
  const revealed=city?.origin ? Object.values(city.tiles).map(t=>gridRectangle(
    city.origin!,Math.round(t.x/60),Math.round(t.y/60),29.7)) : [];

  const site=city?.sites[selected];
  useEffect(()=>{
    if(tile?.latitude!==undefined && tile.longitude!==undefined) {
      mapRef.current?.animateCamera({center:{latitude:tile.latitude,longitude:tile.longitude}});
    }
  },[tile?.latitude,tile?.longitude]);
  const openPlanner=async ()=>{
    if(!tile) return;
    if(openPlan) {setPlanned(undefined);setOpenPlan(false);return;}
    setOpenPlan(true);
    try {
      setPlanned(await request<{metres:number;line:LatLng[]}>('planner/route','POST',{site:tile.id}));
    } catch(cause) {setError(cause instanceof Error?cause.message:String(cause));}
  };
  const google=Platform.OS==='android'?Constants.expoConfig?.extra?.googleMapsAndroid:
    Constants.expoConfig?.extra?.googleMapsIos;
  const quoteHaul=async (destination:string,buffer:string)=>{
    if(!haul) return;
    const qty=Number(haulQty);
    if(!Number.isInteger(qty)||qty<1||qty>Math.min(12,haul.qty)) {setError('Choose 1–12 available units.');return;}
    try {
      const quote=await request<{metres:number;fee:number;seconds:number}>('quote','POST',{source:haul.site,destination});
      Alert.alert('Confirm haul',`${quote.metres} m · ${Math.ceil(quote.seconds/60)} min · ${useVoucher?'1 voucher':quote.fee+' coins'}`,[
        {text:'Cancel',style:'cancel'},{text:'Dispatch',onPress:()=>void interact(
          {...haul,op:'haul',destination,buffer,qty,voucher:useVoucher})},
      ]);
    } catch(cause) {setError(cause instanceof Error?cause.message:String(cause));}
  };

  return <SafeAreaView style={styles.background}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Vestigia</Text>
      {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {needsAuth&&<View style={styles.card}>
        <TextInput accessibilityLabel="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" style={styles.input}/>
        <TextInput accessibilityLabel="Password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input}/>
        <Button title="Sign in" onPress={()=>void login()}/>
      </View>}
      {!city&&!needsAuth&&<Button title="Connect" onPress={()=>void initialize().catch(cause=>setError(cause.message))}/>}
      {city&&catalog&&<>
        <Text>{Number(city.coins.toFixed(2))} coins · Cargo {total(city.cargo)}/{city.capacity} · {city.xp} XP</Text>
        <View style={styles.buttons}>{(['Map','City','Research','Almanac'] as const).map(name=>
          <Button key={name} title={name} color={screen===name?'#396449':'#627668'} onPress={()=>setScreen(name)}/>)}</View>
        {screen==='Map'&&<>
          <View style={styles.buttons}>
            <Button title={city.walking?'Stop walk':'Start walk'} disabled={busy} onPress={()=>void walk()}/>
            {city.mode==='gps'&&!city.town_store&&<Button title="Locate city" disabled={busy} onPress={()=>void walk(true)}/>}
            {city.mode==='fixture'&&action('Advance 15 min',{op:'advance',seconds:900})}
          </View>
          {city.mode==='gps'&&!city.walking&&<View style={styles.buttons}><Text>Track with screen locked</Text>
            <Switch accessibilityLabel="Track with screen locked" value={background} onValueChange={setBackground}/></View>}
          {city.walking&&<Text accessibilityLiveRegion="polite">{walking?.background?'Screen-locked tracking':'Foreground walk'}
            {' · '}{walking?Math.max(0,Math.floor((tick/1000-walking.started)/60)):Math.floor((city.now-(city.walk_started??city.now))/60)} min
            {pending>0?` · ${pending} pending sync`:''}</Text>}
          {city.mode==='gps'&&google&&city.origin&&<MapView ref={mapRef} style={styles.map} provider={PROVIDER_GOOGLE}
            initialRegion={{latitude:tile?.latitude??city.origin[0],longitude:tile?.longitude??city.origin[1],
              latitudeDelta:.008,longitudeDelta:.008}}>
            <Polygon coordinates={fog} holes={revealed} fillColor="rgba(18,29,23,0.57)" strokeWidth={0}/>
            {revealed.map((ring,i)=><Polygon key={i} coordinates={ring} fillColor="rgba(112,146,109,0.15)"
              strokeColor="rgba(48,82,53,0.65)" strokeWidth={1}/>)}
            {Object.values(city.tiles).map(t=>t.latitude!==undefined&&t.longitude!==undefined&&<Marker key={t.id}
              coordinate={{latitude:t.latitude,longitude:t.longitude}} title={city.sites[t.id]?.kind??t.report?.mineral??t.resource}
              onPress={()=>choose(t.id)}/>)}
            {planned && planned.line.length>1 && <Polyline coordinates={planned.line} strokeColor="#a9602b" strokeWidth={4}/>}
            {Object.entries(city.roads).map(([key,road])=>road.line&&<Polyline key={key} coordinates={road.line}
              strokeColor="#705d3f" strokeWidth={2+Math.max(road.paid,[1,3,10,30].filter(n=>road.passages>=n).length)}/>)}
          </MapView>}
          {city.mode==='fixture'&&<View style={styles.fixtureMap}>{Array.from({length:35},(_,index)=>{
            const id=`${gridX+index%7-3},${gridY+Math.floor(index/7)-2}`;
            const seen=city.tiles[id];
            const focused=id===selected;
            const here=id===`${gridX},${gridY}`;
            const tier=city.roads[id]?Math.max(city.roads[id].paid,[1,3,10,30].filter(n=>city.roads[id].passages>=n).length):0;
            return <Pressable key={id} disabled={!seen} accessibilityRole="button"
              accessibilityLabel={seen?(city.sites[id]?.kind??seen.resource)+' at '+id:'Fog'}
              onPress={()=>choose(id)} style={[styles.cell,{backgroundColor:seen?'#b5c6ac':'#56665b',
                borderColor:focused?'#594929':'#e5ebdf',borderBottomWidth:here?4:1+tier}]}>
              {!!seen&&<Text style={styles.cellText}>{city.sites[id]?.kind??seen.report?.mineral??seen.resource}</Text>}
            </Pressable>;
          })}</View>}
          {city.mode==='fixture'&&<View style={styles.buttons}>{[[-1,0,'West'],[0,-1,'North'],[0,1,'South'],[1,0,'East']].map(
            ([dx,dy,dir])=>action(String(dir),{op:'step',dx,dy},String(dir)))}</View>}
          <Text style={styles.heading}>Revealed sites</Text>
          <View style={styles.buttons}>{Object.values(city.tiles).map(t=><Button key={t.id} title={
            (city.sites[t.id]?.kind??t.report?.mineral??t.resource)+' · '+t.id} onPress={()=>choose(t.id)}/>)}</View>
          {tile&&<View style={styles.card}>
            <Text style={styles.heading}>{site?.kind??tile.report?.mineral??tile.resource}</Text>
            <Text>{tile.nearby?'In range':'Requires a reliable fix within 40 m'} · {tile.soil}
              {tile.grade===undefined?'':` · Q${tile.grade}`}</Text>
            {tile.report&&<Text>{tile.report.message}</Text>}
            {tile.survey&&<Text>Survey due in {Math.max(0,Math.ceil((tile.survey.at-city.now)/60))} min</Text>}
            {tile.resource==='prospect'&&!tile.survey&&!tile.report?.mineral&&[1,2,3].map(tier=>
              action(`Survey tier ${tier} · ${[3,8,18][tier-1]} coins`,{op:'survey',site:tile.id,tier}))}
            {city.mode==='gps'&&action('Replace inaccessible anchor',{op:'relocate site',site:tile.id})}
            {!site&&<>
              <Button title={openPlan?'Close planner':'Open planner'} onPress={()=>void openPlanner()}/>
              {openPlan&&planned&&<Text>Pedestrian route · {planned.metres} m</Text>}
              {openPlan&&Object.entries(catalog.sites).filter(([name])=>tile.eligible?.includes(name)).map(([name,definition])=>
                action(`${name} · ${['lumberjack station','sawmill'].includes(name)&&!city.grants.includes(name)?'Grant':formatCost(definition.cost)}`,
                  {op:'plan',site:tile.id,kind:name},name))}
            </>}
            {site&&!site.built&&<>
              <Text>{formatCost(site.cost)}</Text>
              {transfer(site.materials,'materials',site.id,'pickup')}
              {transfer(city.cargo,'materials',site.id,'deliver')}
              {action('Finish construction',{op:'build',site:tile.id})}
              {action('Cancel blueprint',{op:'cancel',site:tile.id})}
            </>}
            {site?.built&&<>
              {site.kind==='export depot'&&<>
                <Text style={styles.heading}>Exports</Text>
                {city.offers.map(o=><View key={o.id}><Text>{o.qty} × {o.good} · Q{o.floor}+</Text>
                  {!city.orders[o.id]&&action('Accept offer',{op:'accept export',order:o.id})}</View>)}
                {Object.values(city.orders).filter(o=>o.status==='active'&&o.expires>city.now).map(o=>
                  <View key={o.id}><Text>{o.qty} × {o.good} · Q{o.floor}+</Text>
                    {action('Ship order',{op:'ship export',site:site.id,order:o.id})}
                    {action('Abandon order',{op:'abandon export',order:o.id})}</View>)}
              </>}
              {site.kind==='town store'&&Object.entries(city.market_orders).map(([slot,o])=>o&&
                <View key={slot}>
                  <Text>{o.refresh?'Market order refreshing':`${o.qty} × ${o.good} · ${o.payout} coins`}</Text>
                  {!!o.id&&action('Fill order',{op:'fill market order',slot,order:o.id})}
                  {!!o.id&&action('Dismiss order',{op:'dismiss market order',slot,order:o.id})}
                </View>)}
              {site.kind==='machine works'&&action('Fit vehicle kit',{op:'fit kit',site:site.id})}
              <Text>Level {site.level}{site.batch?' · Batch Q'+site.batch.q:''}</Text>
              {site.assessment&&<Text>{site.assessment}</Text>}
              {site.household&&<>
                <Text>Household · {site.household.score.toFixed(1)} / 100 · {site.household.hours} / 24 hours</Text>
                <Text>{Object.entries(site.household.coverage).map(([need,value])=>`${need} ${Math.round(value*100)}%`).join(' · ')}</Text>
                <Text>Food families · {site.household.families.join(', ')||'None yet'}</Text>
              </>}
              {site.tax>0&&action(`Collect ${site.tax} coins`,{op:'tax',site:site.id})}
              {site.options.length>0&&<Button title={openRecipe?'Close recipes':'Recipes'} onPress={()=>setOpenRecipe(!openRecipe)}/>}
              {openRecipe&&site.options.map(name=>{
                const recipe=catalog.recipes[name];
                const locked=!city.technologies.includes(recipe.tech);
                return <View key={name} style={styles.row}>
                  <Text>{name} · {formatCost(recipe.inputs)} · {recipe.seconds/60} min</Text>
                  {locked&&<Text>Research {recipe.tech}</Text>}
                  {['paddock','apiary','fish pond'].includes(site.kind)
                    ?action('Stock '+name.split(' / ')[1],{op:'herd',site:site.id,name:name.split(' / ')[1]})
                    :<Button title="Configure recipe" onPress={()=>{
                      setRecipeChoice(name);
                      setIngredients(recipe.inputs.map(([,names])=>names[0]));
                      setFloors(recipe.inputs.map(()=> '0'));
                      setPremium(false);
                    }}/>}
                  {recipeChoice===name&&<>
                    {recipe.inputs.map(([qty,names],index)=><View key={index} style={styles.row}>
                      <Text>{qty} units · {ingredients[index]}</Text>
                      {names.length>1&&<View style={styles.buttons}>{names.map(ingredient=>
                        <Button key={ingredient} title={ingredient}
                          onPress={()=>setIngredients(old=>old.map((v,i)=>i===index?ingredient:v))}/>)}</View>}
                      <TextInput style={styles.input} accessibilityLabel={`Minimum quality for ingredient ${index+1}`}
                        keyboardType="number-pad" value={floors[index]}
                        onChangeText={value=>setFloors(old=>old.map((v,i)=>i===index?value:v))}/>
                    </View>)}
                    <View style={styles.buttons}><Text>Use highest quality first</Text>
                      <Switch value={premium} onValueChange={setPremium}/></View>
                    {action('Apply recipe',{op:'recipe',site:site.id,name,choices:ingredients,floors:floors.map(Number),highest:premium})}
                  </>}
                </View>;})}
              {!!catalog.sites[site.kind]?.plot&&total(city.cargo.filter(l=>l.good==='compost'))>0&&
                <View style={styles.buttons}><Text>Apply compost</Text><Switch value={compost} onValueChange={setCompost}/></View>}
              {!!catalog.sites[site.kind]?.plot&&(site.crop
                ?<>{action('Harvest '+site.crop.name,{op:'harvest',site:site.id,compost})}
                  {action('Clear plot',{op:'clear crop',site:site.id})}</>
                :Object.entries(catalog.crops).filter(([,crop])=>crop.plot===catalog.sites[site.kind].plot)
                  .map(([name,crop])=>action(`Plant ${name} ·  ${(crop.soil===tile.soil?4:2)+(compost?2:0)} units · ${crop.seconds/3600} h at level 1`,{op:'plant',site:site.id,name,compost})))}
              {(['output','input','shared','pantry'] as const).map(buf=><View key={buf}>
                {(site[buf].length>0||buf==='input'&&site.options.length>0||buf==='shared'&&
                  ['town store','warehouse','export depot'].includes(site.kind)||buf==='pantry'&&
                  ['town store','cottage','townhouse','apartment house'].includes(site.kind))&&<>
                  <Text style={styles.heading}>{buf}</Text>
                  {transfer(site[buf],buf,site.id,'pickup')}
                  {buf!=='output'&&transfer(city.cargo,buf,site.id,'deliver')}
                  {buf==='shared'&&site.kind==='town store'&&site.shared.map((lot,i)=>action(
                    `Sell ${lot.qty} ${lot.good}`,{op:'sell',site:site.id,good:lot.good,quality:lot.q,qty:lot.qty},String(i)))}
                </>}
              </View>)}
              {site.level<10&&<><Text>Upgrade · {formatCost(site.next_cost)}</Text>
                {transfer(site.upgrade,'upgrade',site.id,'pickup')}{transfer(city.cargo,'upgrade',site.id,'deliver')}
                {action('Finish upgrade',{op:'upgrade',site:site.id,level:site.level+1})}</>}
              {site.conversion_kind&&site.conversion_cost&&<>
                <Text>Convert to {site.conversion_kind} · {formatCost(site.conversion_cost)}</Text>
                {transfer(site.conversion,'conversion',site.id,'pickup')}{transfer(city.cargo,'conversion',site.id,'deliver')}
                {action('Finish conversion',{op:'convert',site:site.id,kind:site.conversion_kind})}
              </>}
              <Button title={openStaff?'Close employment':'Employment'} onPress={()=>setOpenStaff(!openStaff)}/>
              {openStaff&&<>
                {city.citizens.map(p=>action(`Assign resident ${p.id} · E${p.education}`,{op:'staff',site:site.id,citizen:p.id}))}
                {site.worker!==null&&action('Remove lead',{op:'staff',site:site.id,citizen:null})}
                {site.worker!==null&&action('Train lead',{op:'train',site:site.id})}
                {['primary school','technical college','university'].includes(site.kind)&&city.citizens.filter(p=>!p.assignment)
                  .map(p=>action(`Enrol resident ${p.id} · E${p.education}`,{op:'enrol',site:site.id,students:[p.id]}))}
              </>}
            </>}
          </View>}
        </>}
        {city.mode==='gps'&&<VoucherStore<City> changed={update} visible={screen==='City'}/>}
        {screen==='City'&&<>
          <Text>{city.citizens.length} residents · {city.vouchers} haul vouchers</Text>
          {city.mode==='fixture'&&action('Sandbox · add five vouchers',{op:'purchase',receipt:nonce()})}
          {[...new Set(Object.values(city.sites).map(s=>s.assessment).filter(Boolean))].map(reason=>
            <View key={reason} style={styles.row}><Text>{reason}</Text>
              {Object.values(city.sites).filter(s=>s.assessment===reason).map(s=>
                <Button key={s.id} title={`${s.kind} · ${s.id}`} onPress={()=>choose(s.id)}/>)}
            </View>)}
          {city.jobs.map(job=><Text key={job.id}>Haul to {job.dst} · {job.fee?job.fee+' coins':'voucher'} · {job.done?'Delivered':Math.max(0,Math.ceil((job.at-city.now)/60))+' min'}</Text>)}
          {haul&&<View style={styles.card}>
            <Text>Haul {haul.good} from {haul.site}</Text>
            <TextInput accessibilityLabel="Haul quantity" value={haulQty} onChangeText={setHaulQty}
              keyboardType="number-pad" style={styles.input}/>
            <View style={styles.buttons}><Text>Use a voucher</Text><Switch value={useVoucher} onValueChange={setUseVoucher}/></View>
            {Object.values(city.sites).filter(s=>s.id!==haul.site).flatMap(s=>
              (s.built?['input','shared','pantry','upgrade','conversion']:['materials']).map(buffer=>
                <Button key={s.id+buffer} title={`Quote to ${s.kind} ${s.id} · ${buffer}`} onPress={()=>void quoteHaul(s.id,buffer)}/>))}
          </View>}
          {Object.entries(city.roads).map(([id,road])=>{
            const tier=Math.max(road.paid,[1,3,10,30].filter(n=>road.passages>=n).length);
            return <View style={styles.row} key={id}><Text>{road.passages} passages · {['','Trail','Dirt','Gravel','Paving'][tier]}</Text>
              {tier<4&&action(`Upgrade · ${[4,12,30][tier-1]} coins`,{op:'road',road:id,tier:tier+1})}
            </View>;
          })}
          <Button title="Refresh city"  onPress={()=>void request<City>('city').then(update).catch(cause=>setError(cause.message))}/>
          <Button title="Delete city" color="#883d2c" onPress={()=>Alert.alert('Delete city','Remove your save and location history?',[
            {text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>void (async()=>{
              try {
                subscription.current?.remove();
                if(await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK)) await Location.stopLocationUpdatesAsync(TRACKING_TASK);
                await request('city','DELETE');
                await clearWalk();
                await AsyncStorage.multiRemove([TOKEN,REFRESH,MUTATION]);
                session.current=null;state.current=undefined;setCity(undefined);setWalking(null);
              } catch(cause) {setError(cause instanceof Error?cause.message:String(cause));}
            })()},
          ])}/>
        </>}
        {screen==='Research'&&Object.entries(catalog.technologies).map(([name,[tier,req]])=><View key={name} style={styles.card}>
          <Text style={styles.heading}>{name}</Text>
          <Text>{city.technologies.includes(name)?'Complete':city.research?.name===name?'In progress':
            `${[0,2,5,10,20][tier]} coins · ${[0,15,45,120,240][tier]} min`}</Text>
          {!city.technologies.includes(name)&&!city.research&&req.every(t=>city.technologies.includes(t))&&
            action('Begin research',{op:'research',name})}
          {!!req.length&&<Text>Requires {req.join(', ')}</Text>}
        </View>)}
        {screen==='Almanac'&&<>
          <TextInput style={styles.input} accessibilityLabel="Search almanac" placeholder="Search goods and recipes"
            value={query} onChangeText={setQuery}/>
          {Object.entries(catalog.prices).filter(([name])=>name.includes(query.toLowerCase())).sort().map(([name,price])=>
            <Text key={name}>{name} · {price} coins</Text>)}
          {Object.entries(catalog.recipes).filter(([name,r])=>name.toLowerCase().includes(query.toLowerCase())||
            r.inputs.some(([,names])=>names.some(n=>n.includes(query.toLowerCase())))).map(([name,r])=>
            <View key={name} style={styles.row}><Text>{name} · {formatCost(r.inputs)} · {r.tech}</Text></View>)}
        </>}
      </>}
      {!API&&<Text>Set EXPO_PUBLIC_VESTIGIA_API before starting the development build.</Text>}
    </ScrollView>
  </SafeAreaView>;
}

function gridRectangle(origin:[number,number],i:number,j:number,half:number): LatLng[] {
  const lat=180/(Math.PI*6371008.8);
  const lon=lat/Math.cos(origin[0]*Math.PI/180);
  return [[-half,-half],[half,-half],[half,half],[-half,half]].map(([x,y])=>({
    latitude:origin[0]-(j*60+y)*lat,longitude:origin[1]+(i*60+x)*lon,
  }));
}

const styles=StyleSheet.create({
  background:{flex:1,backgroundColor:'#f7f6eb'},page:{padding:16,gap:12},
  title:{fontSize:36,color:'#20392b',fontWeight:'600'},heading:{fontSize:20,color:'#20392b',fontWeight:'600'},
  card:{backgroundColor:'#e8eee1',borderRadius:12,padding:12,gap:10},
  buttons:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8},
  fixtureMap:{flexDirection:'row',flexWrap:'wrap'},
  cell:{width:'14.28%',height:51,borderWidth:1,alignItems:'center',justifyContent:'center',padding:2},
  cellText:{fontSize:10,textAlign:'center',color:'#20392b'},
  row:{paddingVertical:6,gap:5},map:{height:300,borderRadius:12},
  input:{borderWidth:1,borderColor:'#627668',padding:10,borderRadius:6,minHeight:48},
  error:{color:'#883d2c',padding:8},
});
