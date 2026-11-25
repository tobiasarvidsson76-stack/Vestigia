import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, {ExecutionEnvironment} from 'expo-constants';
import {requireOptionalNativeModule} from 'expo';
import * as Location from 'expo-location';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Alert, AppState, BackHandler, Linking, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Switch,
  TextInput, View} from 'react-native';
import type {LatLng, Region} from 'react-native-maps';
import WalkingMap from './WalkingMap';
import Almanac, {type AlmanacEntry} from './Almanac';
import ResearchTree, {type ResearchRequirement} from './ResearchTree';
import TaskProgress, {type TileTask} from './TaskProgress';
import VoucherStore from './VoucherStore';
import FixtureMap, {TileArt, tileGlyph} from './FixtureMap';
import {Button, LaunchScreen, palette, Text} from './GameUI';
import {blockedHex, createHexClipper, hexKey, hexOutline, projectTouch} from './hexMap';
import {API, nonce, request, RequestError, TOKEN, REFRESH, type Action} from './api';
import {acknowledge, clearWalk, enqueue, queued, sampleOf, TRACKING_TASK, WALK_STORAGE,
  type Walking} from './location';

const fogColor = '#0a1614';
const initialMapSpan = {latitudeDelta:.005,longitudeDelta:.005};
const builtRoadStyles = [
  {color:'#c6a77a',width:2.5,dash:[4,4]},
  {color:'#c6a77a',width:3},
  {color:'#dfbe83',width:3.5},
  {color:'#f7d998',width:4.5},
  {color:'#f4eedc',width:5.5},
];
const headingDelta=(from:number,to:number)=>((to-from)%360+540)%360-180;
const tabs=[
  {name:'Map',glyph:'✥'}, {name:'City',glyph:'⌂'}, {name:'Research',glyph:'◇'}, {name:'Almanac',glyph:'▤'},
] as const;
const AndroidNavigationBar=Platform.OS==='android'&&requireOptionalNativeModule('ExpoNavigationBar')
  ? (require('expo-navigation-bar') as typeof import('expo-navigation-bar')).NavigationBar : null;
const supportsBackgroundWalk=Constants.executionEnvironment!==ExecutionEnvironment.StoreClient&&
  Constants.expoConfig?.extra?.outdoorPreview!==true;
const hasBackgroundWalk=()=>supportsBackgroundWalk&&Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);

type Lot = {good: string; qty: number; q: number};
type InventoryUnit = {good:string; qty:number; q?:number};
type Tile = {id:string; x:number; y:number; latitude?:number; longitude?:number; resource:string;
  map_x?:number; map_y?:number; tasks?:TileTask[]; city_center?:boolean; path_targets?:string[]; resource_tech?:string; soil:string; nearby:boolean; eligible?:string[]; grade?:number; report?:{mineral?:string; message:string}; survey?:{at:number}};
type Cost = [number,string[]][];
type Recipe = {site:string; inputs:Cost; outputs:[number,string][]; tech:string; seconds:number};
type CropMetrics = {suitability:number; qty:number; q:number};
type CropForecast = Record<'match'|'mismatch',CropMetrics & {with_compost?:CropMetrics}>;
type ConstructionNeed = {goods:string[]; required:number; delivered:number; incoming:number};
type Site = {id:string; kind:string; built:boolean; cost:Cost; level:number; options:string[]; input_goods:string[];
  shared:Lot[]; input:Lot[]; output:Lot[]; materials:Lot[]; upgrade:Lot[]; pantry:Lot[]; conversion:Lot[];
  construction_needs?:ConstructionNeed[]; construction_seconds?:number; construction?:{at:number;duration:number}; next_cost:Cost; conversion_cost?:Cost; conversion_kind?:string;
  staff_priority:number; staffing_requirement:number|null; planned_crop?:string; crop?:{name:string;at:number;q:number}; crop_forecast?:CropForecast; batch?:{at:number|null;q:number}; worker:number|null;
  capacity:Partial<Record<'output'|'input'|'shared'|'pantry',number>>;
  assessment?:string; household?:{hours:number;score:number;families:string[];coverage:Record<string,number>};
  service_coverage?:{label:string;radius:number;covered:boolean;at_capacity?:boolean}[];
  marketplace?:boolean;
  school_coverage?:{radius:number;used:number;capacity:number;class_size:number};
  visiting?:boolean; course?:{at:number|null}; last_class?:{graduated:number;failed:number}};
type City = {mode:'fixture'|'gps'; origin:[number,number]|null; map_revision?:number; now:number; coins:number; xp:number;
  capacity:number; cargo:Lot[]; crop_forecast:CropForecast; walking:boolean; walk_started:number|null; walk_session?:string;
  tiles:Record<string,Tile>; tile_paths:{a:string;b:string;sections?:{road:string;level:number;upgrade_cost:number|null;line:LatLng[]}[]}[];
  sites:Record<string,Site>; town_store?:string; marked_tile?:string; technologies:string[];
  research?:{name:string;at:number;duration?:number}; research_requirements:ResearchRequirement[][];
  grants:string[]; starter_rebuilds?:string[]; roads:Record<string,{passages:number;paid:number;line?:LatLng[]}>;
  citizens:{id:number;education:number;assignment?:[string,string]}[]; vouchers:number;
  jobs:{id:number;dst:string;at:number;done:boolean;fee:number}[];
  fix?:{x:number;y:number;edge?:string}; offers:{id:string;good:string;qty:number;floor:number}[];
  orders:Record<string,{id:string;good:string;qty:number;floor:number;status:string;expires:number}>;
  supply_prices:Record<string,number>; blocked_hexes:[number,number][];
  market_orders:Record<string,{id?:string;good:string;qty:number;payout:number;refresh?:number}|null>};
type Crop = {plot:string;soil:string;seconds:number;tech:string};
type BuildingInfo = {description:string;inputs:string|null;lead:number|null;shared:number;market_note:string|null;
  construction_seconds:number|null;placement:string;build_cost:Cost;coverage:string|null};
type Catalog = {building_details:Record<string,BuildingInfo>;market_guide:string[];sites:Record<string,{cost:Cost;plot:string|null}>; recipes:Record<string,Recipe>;
  technologies:Record<string,[number,string[]]>; research_costs:[number,number][]; tile_path_cost:number; starter_construction_seconds:number; crops:Record<string,Crop>;
  prices:Record<string,number>};
type Pending = {key:string; action:Action};
const buildCategories=[
  {name:'Housing & civic',kinds:['town store','cottage','townhouse','apartment house','primary school','high school','technical college',
    'university','library','local marketplace','market hall','police station','fire station','clock tower']},
  {name:'Storage & trade',kinds:['warehouse','export depot']},
  {name:'Gathering & extraction',kinds:['lumberjack station','mine','quarry','clay pit','sand pit','gravel pit','limestone quarry',
    'reed bed','resin tap','forager hut','cork stand','willow coppice','bamboo grove','basalt quarry','salt spring','amber bank']},
  {name:'Farming & livestock',kinds:['paddock','apiary','fish pond','feed mill','hay barn','compost yard']},
  {name:'Food & drink',kinds:['bakery','grain mill','malt house','brewery','orchard press','cider house','sugar house','preserve kitchen',
    'oil press','dairy','town kitchen','smokehouse','condiment kitchen','drying house','roastery','bottling house','saltworks']},
  {name:'Materials & workshops',kinds:[]},
];
const buildingGroup=(kind:string,plot?:string|null)=>buildCategories.find(group=>group.kinds.includes(kind))?.name??
  (plot?'Farming & livestock':'Materials & workshops');
const buildStages=['Starter','Settlement','Industry'];
const mapPosition=(tile:Tile):[number,number]=>[tile.map_x??tile.x,tile.map_y??tile.y];

const MUTATION = 'vestigia.mutation';
const formatCost = (cost:Cost) => cost.map(([q,names])=>q+' '+names.join(' or ')).join(' + ') || 'Free';
const total = (lots:Lot[]) => lots.reduce((n,lot)=>n+lot.qty,0);

function siteAttention(site:Site,now:number) {
  if(!site.built) {
    if(site.construction) return [];
    const pending=site.construction_needs?.filter(need=>need.delivered<need.required)??[];
    if(!pending.length) return ['Ready to start construction'];
    return [pending.every(need=>need.delivered+need.incoming>=need.required)
      ?'Building materials on the way':'Waiting for building materials'];
  }
  const messages=site.crop&&site.crop.at<=now?['Ready to harvest']:[];
  for(const buffer of ['output','input','shared','pantry'] as const) {
    const capacity=site.capacity[buffer];
    if(capacity&&total(site[buffer])>=capacity) {
      messages.push(buffer==='shared'?'Storage full':`${buffer[0].toUpperCase()}${buffer.slice(1)} storage full`);
    }
  }
  return messages;
}

function timeRemaining(seconds:number) {
  const minutes=Math.ceil(seconds/60);
  const hours=Math.floor(minutes/60);
  return hours ? `${hours} h ${minutes%60} min` : `${minutes} min`;
}

export default function App() {
  const [entered,setEntered]=useState(false);
  return <>
    {AndroidNavigationBar&&<AndroidNavigationBar hidden/>}
    {entered ? <Game/> : <LaunchScreen onStart={()=>setEntered(true)}/>}
  </>;
}

function Game() {
  const [siteMenu,setSiteMenu]=useState(false);
  const [siteSection,setSiteSection]=useState<string>();
  const [buildGroup,setBuildGroup]=useState<string>();
  const [buildChoice,setBuildChoice]=useState<string>();
  const [cropChoice,setCropChoice]=useState<string>();
  const [bearing,setBearing]=useState(0);
  const [showSites,setShowSites]=useState(false);
  const [citySection,setCitySection]=useState<string>();
  const [viewport,setViewport]=useState<Region>();
  const [mapData,setMapData]=useState<{paths:LatLng[][]}>({paths:[]});
  const [connecting,setConnecting]=useState(true);
  const [city,setCity]=useState<City>();
  const [catalog,setCatalog]=useState<Catalog>();
  const [selected,setSelected]=useState('');
  const [error,setError]=useState('');
  const [actionError,setActionError]=useState<{scope:string; message:string}>();
  const [busy,setBusy]=useState(false);
  const [walking,setWalking]=useState<Walking|null>(null);
  const [needsLocation,setNeedsLocation]=useState(false);
  const [locationGranted,setLocationGranted]=useState(false);
  const [mapLocation,setMapLocation]=useState<LatLng>();
  const [compassHeading,setCompassHeading]=useState<number>();
  const [travelHeading,setTravelHeading]=useState<{degrees:number; at:number}>();
  const [pending,setPending]=useState(0);
  const [screen,setScreen]=useState<'Map'|'City'|'Research'|'Almanac'>('Map');
  const [almanacHistory,setAlmanacHistory]=useState<AlmanacEntry[]>([]);
  const almanacEntry=almanacHistory.at(-1);
  const [needsAuth,setNeedsAuth]=useState(false);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const initialCentre=useRef<Region|null>(null);
  const [openRecipe,setOpenRecipe]=useState(false);
  const [recipeChoice,setRecipeChoice]=useState<string>();
  const [ingredients,setIngredients]=useState<string[]>([]);
  const [floors,setFloors]=useState<string[]>([]);
  const [premium,setPremium]=useState(false);
  const [compost,setCompost]=useState(false);
  const [tick,setTick]=useState(Date.now());
  const [cityReceivedAt,setCityReceivedAt]=useState(Date.now());
  const [haul,setHaul]=useState<{site:string;source_buffer:string;good:string;qty:number;quality?:number}|null>(null);
  const [haulQty,setHaulQty]=useState('1');
  const [useVoucher,setUseVoucher]=useState(false);
  const working=useRef(false);
  const askedForLocation=useRef(false);
  const initialized=useRef(false);
  const requests=useRef<Promise<unknown>>(Promise.resolve());
  const refreshingTasks=useRef(false);
  const syncing=useRef<Promise<void>|null>(null);
  const session=useRef<Walking|null>(null);
  const subscription=useRef<Location.LocationSubscription|null>(null);
  const state=useRef<City|undefined>(undefined);
  const currentFix=useRef<Location.LocationObject|null>(null);

  const update=useCallback((value:City)=>{
    state.current=value;
    setCity(value);
    setCityReceivedAt(Date.now());
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

  const productionPresence=useCallback((active:boolean)=>{
    const next=requests.current.then(async ()=>{
      if(state.current?.mode!=='gps'||(active&&AppState.currentState!=='active')) return;
      update(await request<City>('presence','POST',{active}));
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
      if(!active) {setPending(0);return;}
      let queue=await queued();
      const stale=queue.filter(entry=>entry.session!==active.session);
      if(stale.length) await acknowledge(stale);
      queue=queue.filter(entry=>entry.session===active.session);
      setPending(queue.length);
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
    if(!supportsBackgroundWalk&&active.background) active={...active,background:false};
    await AsyncStorage.setItem(WALK_STORAGE,JSON.stringify(active));
    const running=await hasBackgroundWalk();
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
          await AsyncStorage.setItem(WALK_STORAGE,JSON.stringify(active));
          setError('Screen-locked tracking could not start. Your walk is recording in the foreground.');
        }
      }
      if(active.background) {
        session.current=active;
        setWalking(active);
        return;
      }
    }
    if(running) await Location.stopLocationUpdatesAsync(TRACKING_TASK);
    subscription.current=await Location.watchPositionAsync({
      accuracy:Location.Accuracy.High,distanceInterval:3,timeInterval:4000,
    },fix=>{
      currentFix.current=fix;
      void enqueue(active.session,[fix]).then(syncWalk).catch(()=>setError('GPS fixes are waiting to sync.'));
    });
    session.current=active;
    setWalking(active);
    void syncWalk().catch(()=>setError('GPS fixes are waiting to sync.'));
  },[syncWalk]);

  const initialize=useCallback(async ()=>{
    initialized.current=false;
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
    try {
      await flushMutation();
    } catch(cause) {
      initialized.current=value.mode==='gps';
      throw cause;
    }
    value=state.current??value;
    if(value.mode==='gps') {
      const permission=await Location.getForegroundPermissionsAsync();
      setLocationGranted(permission.granted);
      setNeedsLocation(!permission.granted);
      const saved:Walking|null=JSON.parse((await AsyncStorage.getItem(WALK_STORAGE))||'null');
      if(value.walking && value.walk_session && value.walk_started!==null && saved?.session===value.walk_session) {
        try {
          await startTracking(saved);
        } catch(cause) {
          initialized.current=true;
          throw cause;
        }
      } else {
        if(await hasBackgroundWalk()) {
          await Location.stopLocationUpdatesAsync(TRACKING_TASK);
        }
        session.current=null;
        setWalking(null);
        await clearWalk();
      }
    }
    initialized.current=true;
  },[flushMutation,startTracking,update]);

  const autoWalk=useCallback(async (askForLocation=false)=>{
    if(!initialized.current || state.current?.mode!=='gps' || working.current ||
        session.current || (AppState.currentState && AppState.currentState!=='active')) return;
    working.current=true;
    try {
      let permission=await Location.getForegroundPermissionsAsync();
      if(!permission.granted && permission.canAskAgain && (askForLocation || !askedForLocation.current)) {
        askedForLocation.current=true;
        permission=await Location.requestForegroundPermissionsAsync();
      }
      setNeedsLocation(!permission.granted);
      setLocationGranted(permission.granted);
      if(!permission.granted) {
        if(askForLocation && !permission.canAskAgain) await Linking.openSettings();
        return;
      }
      if(AppState.currentState && AppState.currentState!=='active') return;
      await flushMutation();
      const fix=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});
      currentFix.current=fix;
      const {latitude,longitude}=fix.coords;
      setMapLocation(previous=>previous??{latitude,longitude});
      const located=await send({op:'gps samples',session:state.current?.walk_session,samples:[sampleOf(fix)]});
      if(!located.town_store) {
        return;
      }
      if(AppState.currentState && AppState.currentState!=='active') return;
      const id=located.walk_session??nonce();
      if(!located.walking) await runMutation({op:'walk',enabled:true,session:id});
      await startTracking({session:id,started:state.current?.walk_started??Date.now()/1000,background:false});
      setError('');
    } catch(cause) {
      setError(cause instanceof Error?cause.message:String(cause));
    } finally {
      working.current=false;
    }
  },[flushMutation,runMutation,send,startTracking]);

  useEffect(()=>{
    void initialize().then(()=>{void autoWalk();})
      .catch(cause=>setError(String(cause.message??cause))).finally(()=>setConnecting(false));
    return ()=>subscription.current?.remove();
  },[autoWalk,initialize]);

  useEffect(()=>{
    const listener=AppState.addEventListener('change',status=>{
      void productionPresence(status==='active').catch(()=>undefined);
      if(status!=='active') return;
      if(session.current) {
        void Location.getForegroundPermissionsAsync().then(permission=>{
          setLocationGranted(permission.granted);
          setNeedsLocation(!permission.granted);
        }).catch(()=>setLocationGranted(false));
        void syncWalk().catch(()=>setError('GPS fixes are waiting to sync.'));
      } else void autoWalk();
    });
    const poll=setInterval(()=>{
      setTick(Date.now());
      if(session.current && AppState.currentState==='active') {
        void syncWalk().catch(()=>setError('GPS fixes are waiting to sync.'));
      }
    },5000);
    const locate=setInterval(()=>void autoWalk(),15000);
    const heartbeat=setInterval(()=>{
      if(AppState.currentState==='active') void productionPresence(true).catch(()=>undefined);
    },12000);
    return ()=>{listener.remove();clearInterval(poll);clearInterval(locate);clearInterval(heartbeat);};
  },[autoWalk,productionPresence,syncWalk]);

  const cityMode=city?.mode;
  useEffect(()=>{
    if(cityMode==='gps'&&AppState.currentState==='active') void productionPresence(true).catch(()=>undefined);
  },[cityMode,productionPresence]);

  const errorScope=siteMenu?`site:${selected}/${siteSection??''}/${buildChoice??''}`:
    showSites?'sites':screen==='City'?`city:${citySection??''}`:screen;
  const displayedActionError=actionError?.scope===errorScope?actionError.message:undefined;
  const currentErrorScope=useRef(errorScope);
  currentErrorScope.current=errorScope;
  useEffect(()=>setActionError(undefined),[errorScope]);
  const reportActionError=(cause:unknown)=>{
    if(currentErrorScope.current===errorScope) {
      setActionError({scope:errorScope,message:cause instanceof Error?cause.message:String(cause)});
    }
  };

  const interact=async (action:Action)=>{
    if(working.current) return;
    working.current=true;
    setBusy(true);
    setActionError(undefined);
    try {
      if(state.current?.mode==='gps' && ['build','demolish','pickup','deliver','plant','harvest','herd','upgrade',
        'convert','clear crop','fit kit','deposit paving','finish paving'].includes(action.op)) {
        const permission=await Location.getForegroundPermissionsAsync();
        if(!permission.granted) throw new Error('Allow foreground location to interact on-site.');
        const recent=currentFix.current;
        const fix=recent && Date.now()-recent.timestamp<=8000 && (recent.coords.accuracy??Infinity)<=30
          ?recent:await Location.getCurrentPositionAsync(
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
      if(currentErrorScope.current===errorScope&&['plan','build','cancel','demolish'].includes(action.op)) {
        setSiteSection(action.op==='build'||(action.op==='plan'&&action.crop)?'Construction':undefined);
        setCropChoice(undefined);
        setBuildChoice(undefined);
        setBuildGroup(undefined);
      }
      if(action.op==='step') {
        const matching=Object.values(state.current?.tiles??{}).find(t=>t.nearby);
        if(matching) setSelected(matching.id);
      }
    } catch(cause) {reportActionError(cause);}
    finally {working.current=false;setBusy(false);}
  };

  const changeBackgroundTracking=async (enabled:boolean)=>{
    const active=session.current;
    if(!active || working.current) return;
    working.current=true;
    setBusy(true);
    try {
      if(enabled&&!(await Location.requestBackgroundPermissionsAsync()).granted) {
        setError('Allow background location in your phone settings to record with the screen locked.');
        return;
      }
      setError('');
      await startTracking({...active,background:enabled});
    } catch(cause) {
      session.current=null;
      setWalking(null);
      setError(cause instanceof Error?cause.message:String(cause));
    } finally {
      working.current=false;
      setBusy(false);
    }
  };

  const login=async ()=>{
    try {
      const ticket=await request<{token:string;refresh_token:string}>('login','POST',{email,password});
      await AsyncStorage.multiSet([[TOKEN,ticket.token],[REFRESH,ticket.refresh_token]]);
      setPassword('');
      await initialize();
      await autoWalk();
    } catch(cause) {setError(cause instanceof Error?cause.message:String(cause));}
  };

  const action=(label:string,command:Action,key=label)=><Button key={key} color="#396449"
    title={label} disabled={busy} onPress={()=>void interact(command)}/>;
  const moveMap=(center:LatLng)=>{
    const span=viewport??initialCentre.current??initialMapSpan;
    const region={latitudeDelta:span.latitudeDelta,longitudeDelta:span.longitudeDelta,...center};
    setViewport(region);
  };
  const choose=(id:string)=>{
    const target=city?.tiles[id];
    if(target?.latitude!==undefined&&target.longitude!==undefined) {
      moveMap({latitude:target.latitude,longitude:target.longitude});
    }
    setSelected(id);setScreen('Map');setShowSites(false);setSiteMenu(true);setSiteSection(undefined);
    setBuildChoice(undefined);setBuildGroup(undefined);setCropChoice(undefined);
    setOpenRecipe(false);setRecipeChoice(undefined);
  };
  const transfer=(lots:Lot[],buffer:string,site:string,op:'deliver'|'pickup',sell=false)=><InventoryRows lots={lots}
    actions={lot=>{
      const ordered={op,site,buffer,good:lot.good,quality:lot.q};
      const collect=Math.min(lot.qty,Math.max(0,(city?.capacity??0)-total(city?.cargo??[])));
      return <View style={styles.buttons}>
        {op==='deliver'||collect>0?action(op==='pickup'?'Collect 1':'Deliver 1',{...ordered,qty:1}):null}
        {op==='pickup'&&collect>1&&action(`Collect ${collect}`,{...ordered,qty:collect})}
        {sell&&action(`Sell ${Math.min(lot.qty,1200)}`,{op:'sell',site,good:lot.good,quality:lot.q,qty:Math.min(lot.qty,1200)})}
        {op==='pickup'&&['input','output','shared'].includes(buffer)&&<Button title="Plan haul"
          onPress={()=>{setHaul({site,source_buffer:buffer,good:lot.good,qty:lot.qty,quality:lot.q});setHaulQty('1');
            setSiteMenu(false);setSiteSection(undefined);setCitySection('Hauls');setScreen('City');}}/>}
      </View>;
    }}/>;
  const tile=city?.tiles[selected];
  const cityTime=(city?.now??0)+Math.max(0,tick-cityReceivedAt)/1000;
  useEffect(()=>{
    if(refreshingTasks.current||working.current||AppState.currentState!=='active'||
      !Object.values(city?.tiles??{}).some(tile=>tile.tasks?.some(task=>
        task.kind!=='crop'&&task.at!=null&&task.at<=cityTime))) return;
    refreshingTasks.current=true;
    const next=requests.current.then(async ()=>{
      if(!working.current) update(await request<City>('city'));
    }).catch(()=>undefined).finally(()=>{refreshingTasks.current=false;});
    requests.current=next;
  },[city?.tiles,cityTime,update]);
  const anchor=city?.fix??tile??{x:0,y:0};
  const gridX=Math.round(anchor.x/60);
  const gridY=Math.round(anchor.y/60);
  const origin=city?.origin;
  const tiles=city?.tiles;
  const hexes=useMemo(()=>{
    const grouped=new Map<string,Tile[]>();
    for(const item of Object.values(tiles??{})) {
      const key=hexKey(...mapPosition(item));
      const group=grouped.get(key);
      if(group) group.push(item);
      else grouped.set(key,[item]);
    }
    return grouped;
  },[tiles]);
  const sites=city?.sites;
  const attention=useMemo(()=>{
    const notices:Record<string,string[]>={};
    for(const [id,site] of Object.entries(sites??{})) {
      const messages=siteAttention(site,cityTime);
      if(messages.length) notices[id]=messages;
    }
    return notices;
  },[cityTime,sites]);
  const mapCells=useMemo(()=>{
    if(!origin) return [];
    return [...hexes].map(([key,group])=>{
      const [first]=group;
      const featured=group.find(item=>item.city_center) ?? group.find(item=>sites?.[item.id]?.built) ??
        group.find(item=>sites?.[item.id]) ?? group.find(item=>item.resource!=='land') ?? first;
      const building=sites?.[featured.id];
      const name=featured.city_center?'City Center':building?.kind??featured.report?.mineral??
        (featured.resource==='land'?undefined:featured.resource);
      return {key,outline:hexOutline(origin,...mapPosition(first)),glyph:tileGlyph(featured,building),
        name,raised:Boolean(building?.built),notice:group.some(item=>Boolean(attention[item.id]))};
    });
  },[attention,hexes,origin,sites]);
  const clipPath=useMemo(()=>origin
    ? createHexClipper(origin,[...hexes.values()].map(([item])=>mapPosition(item)))
    : ()=>[],[hexes,origin]);
  const visiblePaths=useMemo(()=>mapData.paths.flatMap(clipPath),[clipPath,mapData.paths]);
  const builtPathLines=useMemo(()=>(city?.tile_paths??[]).flatMap(({a,b,sections})=>
    sections?.flatMap(({level,line},section)=>clipPath(line).map((coordinates,piece)=>({
      key:`tile-path-${a}-${b}-${section}-${piece}`,coordinates,outline:'#493821',...builtRoadStyles[level],
    })))??[]),[city?.tile_paths,clipPath]);
  const blockedHexes=city?.blocked_hexes;
  const blocked=useMemo(()=>origin?(blockedHexes??[]).map(cell=>blockedHex(origin,cell)):[],
    [blockedHexes,origin]);
  const blockedKeys=useMemo(()=>new Set(blocked.map(cell=>cell.key)),[blocked]);
  const selectHex=(coordinate:LatLng)=>{
    if(!origin) return;
    const [x,y]=projectTouch(origin,coordinate);
    const key=hexKey(x,y);
    const group=hexes.get(key);
    if(!group?.length) {
      if(blockedKeys.has(key)) Alert.alert('Tile unavailable',
        'This hex has no mapped public walking path connected to your city.');
      return;
    }
    const center=group.find(item=>item.city_center);
    if(center) {choose(center.id);return;}
    const closest=group.reduce((best,item)=>
      Math.hypot(item.x-x,item.y-y)<Math.hypot(best.x-x,best.y-y)?item:best);
    choose(closest.id);
  };

  const site=city?.sites[selected];
  const connectedPaths=(city?.tile_paths??[]).filter(path=>path.a===selected||path.b===selected);
  const siteName=tile?.city_center?'CITY CENTER':(site?.kind??tile?.report?.mineral??tile?.resource)?.toUpperCase();
  const plot=site?catalog?.sites[site.kind]?.plot:null;
  const allowedPlots=site?(plot?[plot]:[]):
    (tile?.eligible??[]).flatMap(kind=>catalog?.sites[kind]?.plot??[]);
  const tileCrops=Object.entries(catalog?.crops??{}).filter(([,crop])=>allowedPlots.includes(crop.plot));
  const hasCompost=Boolean(city?.cargo.some(lot=>lot.good==='compost'));
  const chosenCrop=cropChoice?catalog?.crops[cropChoice]:undefined;
  const plannedCrop=site?.planned_crop?catalog?.crops[site.planned_crop]:undefined;
  useEffect(()=>{
    if(siteSection==='Construction'&&site?.built) setSiteSection(undefined);
  },[site?.built,siteSection]);
  const construction=site?.construction_needs??[];
  const materialsMissing=construction.some(need=>need.delivered<need.required);
  const constructionCargo=(city?.cargo??[]).filter(lot=>construction.some(need=>
    need.delivered+need.incoming<need.required&&need.goods.some(good=>
      good===lot.good||(['log','plank'].includes(good)&&lot.good.endsWith(' '+good)))));


  const markedTile=city?.marked_tile?city.tiles[city.marked_tile]:undefined;
  const focusMarkedTile=()=>{
    if(!markedTile) return;
    setSelected(markedTile.id);
    if(markedTile.latitude!==undefined&&markedTile.longitude!==undefined) {
      moveMap({latitude:markedTile.latitude,longitude:markedTile.longitude});
    }
  };
  const showMap=city?.mode==='gps'&&Boolean(origin);
  if(showMap&&!initialCentre.current&&mapLocation) {
    initialCentre.current={...mapLocation,...initialMapSpan};
  }
  const mapRegion=viewport??initialCentre.current;
  const mapCosine=Math.max(.1,Math.cos((mapRegion?.latitude??0)*Math.PI/180));
  const mapRadius=mapRegion ? Math.hypot(mapRegion.latitudeDelta,mapRegion.longitudeDelta*mapCosine)/2 : 0;
  const hasVisibleTiles=Boolean(mapRegion&&Object.values(tiles??{}).some(item=>
    item.latitude!==undefined&&item.longitude!==undefined&&(
      Math.abs(item.latitude-mapRegion.latitude)<=mapRadius+.0004 &&
      Math.abs(item.longitude-mapRegion.longitude)<=mapRadius/mapCosine+.0007)));
  const hasVisibleAccessMarks=Boolean(mapRegion&&blocked.some(({center})=>
    Math.abs(center.latitude-mapRegion.latitude)<=mapRadius+.0004 &&
    Math.abs(center.longitude-mapRegion.longitude)<=mapRadius/mapCosine+.0007));
  const centeredOnLocation=mapLocation&&mapRegion&&
    Math.abs(mapLocation.latitude-mapRegion.latitude)<mapRegion.latitudeDelta*.1&&
    Math.abs(mapLocation.longitude-mapRegion.longitude)<mapRegion.longitudeDelta*.1;
  const locationHeading=travelHeading&&tick-travelHeading.at<8000 ? travelHeading.degrees : compassHeading;
  useEffect(()=>{
    const region=mapRegion;
    if(!showMap||!region||!hasVisibleTiles) return;
    let cancelled=false;
    const timer=setTimeout(()=>{
      const {latitude,longitude,latitudeDelta,longitudeDelta}=region;
      const dy=Math.min(Math.max(latitudeDelta*.85,mapRadius),.059);
      const dx=Math.min(Math.max(longitudeDelta*.85,mapRadius/mapCosine),.119);
      void request<typeof mapData>('map/paths','POST',{
        south:latitude-dy,north:latitude+dy,west:longitude-dx,east:longitude+dx,
      }).then(data=>{if(!cancelled) setMapData(data);}).catch(cause=>{
        if(!cancelled) setError(cause.message);
      });
    },150);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[city?.map_revision,hasVisibleTiles,mapCosine,mapRadius,mapRegion,showMap]);
  const closeMenu=useCallback(()=>{
    if(siteSection==='Crop plan') {setCropChoice(undefined);setSiteSection(undefined);return true;}
    if(buildChoice) {setBuildChoice(undefined);return true;}
    if(buildGroup) {setBuildGroup(undefined);return true;}
    if(siteSection) {setSiteSection(undefined);return true;}
    if(siteMenu) {setSiteMenu(false);return true;}
    if(showSites) {setShowSites(false);return true;}
    if(citySection&&screen==='City') {setCitySection(undefined);return true;}
    if(screen==='Almanac'&&almanacEntry) {setAlmanacHistory(history=>history.slice(0,-1));return true;}
    if(screen!=='Map') {setScreen('Map');return true;}
    return false;
  },[almanacEntry,buildChoice,buildGroup,citySection,screen,showSites,siteMenu,siteSection]);
  useEffect(()=>{
    const listener=BackHandler.addEventListener('hardwareBackPress',closeMenu);
    return ()=>listener.remove();
  },[closeMenu]);
  const showMapLocation=showMap&&locationGranted;
  useEffect(()=>{
    if(!showMapLocation) {
      setMapLocation(undefined);
      setCompassHeading(undefined);
      setTravelHeading(undefined);
      return;
    }
    let closed=false;
    const watchers:Location.LocationSubscription[]=[];
    let filteredHeading:number|undefined;
    let publishedHeading:number|undefined;
    let targetHeading:number|undefined;
    const keep=(watcher:Location.LocationSubscription)=>{
      if(closed) watcher.remove();
      else watchers.push(watcher);
    };
    void Location.watchPositionAsync({
      accuracy:Location.Accuracy.High,distanceInterval:2,timeInterval:2000,
    },({timestamp,coords:{latitude,longitude,heading,speed,accuracy}})=>{
      if(closed) return;
      setMapLocation(previous=>{
        if(accuracy!==null&&accuracy>35) return previous;
        if(!previous) return {latitude,longitude};
        const north=(latitude-previous.latitude)*111_195;
        const east=(longitude-previous.longitude)*111_195*Math.cos(latitude*Math.PI/180);
        const distance=Math.hypot(north,east);
        const deadband=Math.min(8,Math.max(3,(accuracy??8)*.45));
        if(distance<=deadband) return previous;
        const weight=distance>25?.85:.45;
        return {latitude:previous.latitude+(latitude-previous.latitude)*weight,
          longitude:previous.longitude+(longitude-previous.longitude)*weight};
      });
      if((speed??0)>=.8&&heading!==null&&Number.isFinite(heading)&&heading>=0&&(accuracy??35)<=20) {
        setTravelHeading(previous=>({
          at:timestamp,
          degrees:previous&&timestamp-previous.at<8000
            ? previous.degrees+headingDelta(previous.degrees,heading)*.55 : heading,
        }));
      } else if(speed!==null&&speed>=0&&speed<.5) {
        setTravelHeading(undefined);
      }
    }).then(keep).catch(()=>undefined);
    void Location.watchHeadingAsync(({trueHeading,magHeading,accuracy})=>{
      const heading=trueHeading>=0?trueHeading:magHeading;
      if(closed) return;
      if(accuracy>=2&&Number.isFinite(heading)&&heading>=0) {
        targetHeading=heading;
      } else {
        targetHeading=filteredHeading=publishedHeading=undefined;
        setCompassHeading(undefined);
      }
    }).then(keep).catch(()=>undefined);
    const headingTimer=setInterval(()=>{
      if(targetHeading===undefined) return;
      filteredHeading=filteredHeading===undefined?targetHeading:
        filteredHeading+headingDelta(filteredHeading,targetHeading)*.2;
      if(publishedHeading===undefined||Math.abs(headingDelta(publishedHeading,filteredHeading))>=8) {
        publishedHeading=filteredHeading;
        setCompassHeading(publishedHeading);
      }
    },125);
    return ()=>{
      closed=true;
      clearInterval(headingTimer);
      watchers.forEach(watcher=>watcher.remove());
    };
  },[showMapLocation]);

  const quoteHaul=async (destination:string,buffer:string)=>{
    if(!haul) return;
    const qty=Number(haulQty);
    if(!Number.isInteger(qty)||qty<1||qty>haul.qty) {reportActionError(`Choose 1–${haul.qty} available units.`);return;}
    try {
      const quote=await request<{metres:number;fee:number;seconds:number;capacity:number}>('quote','POST',{source:haul.site,destination});
      if(qty>quote.capacity) {reportActionError(`This route can carry up to ${quote.capacity} units per haul.`);return;}
      Alert.alert('Confirm haul',`${qty} of ${quote.capacity} units · ${quote.metres} m · ${Math.ceil(quote.seconds/60)} min · ${useVoucher?'1 voucher':quote.fee+' coins'}`,[
        {text:'Cancel',style:'cancel'},{text:'Dispatch',onPress:()=>void interact(
          {...haul,op:'haul',destination,buffer,qty,voucher:useVoucher})},
      ]);
    } catch(cause) {reportActionError(cause);}
  };

  return <SafeAreaView style={styles.background}>
    <StatusBar hidden barStyle="light-content"/>
    <View style={styles.hud}>
      <Text style={styles.wordmark} accessibilityRole="header">Vestigia</Text>
      {city&&<View style={styles.balance}>
        <Stat label="Coins" value={Number(city.coins.toFixed(2))}/>
        <Stat label="Cargo" value={`${total(city.cargo)}/${city.capacity}`}/>
        <Stat label="XP" value={city.xp}/>
      </View>}
    </View>
    <View style={styles.gameBody}>
      {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!siteMenu&&!showSites&&screen==='Map'&&displayedActionError&&
        <ActionNotice message={displayedActionError} onDismiss={()=>setActionError(undefined)}/>}
      {needsAuth&&<View style={styles.card}>
        <Text style={styles.heading}>Sign in</Text>
        <TextInput accessibilityLabel="Email" placeholder="Email" placeholderTextColor={palette.muted}
          value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" style={styles.input}/>
        <TextInput accessibilityLabel="Password" placeholder="Password" placeholderTextColor={palette.muted}
          value={password} onChangeText={setPassword} secureTextEntry style={styles.input}/>
        <Button title="Sign in" onPress={()=>void login()}/>
      </View>}
      {connecting&&<Text accessibilityLiveRegion="polite" style={styles.muted}>Opening your settlement…</Text>}
      {!connecting&&!city&&!needsAuth&&<Button title="Reconnect" onPress={()=>void initialize().then(()=>autoWalk()).catch(cause=>setError(cause.message))}/>}
      {city&&catalog&&<>
        <View style={styles.mapArea}>
          {(city.mode==='fixture'||needsLocation)&&<View style={styles.buttons}>
            {city.mode==='fixture'&&action(city.walking?'Stop walk':'Start walk',{op:'walk',enabled:!city.walking})}
            {city.mode==='gps'&&needsLocation&&<Button title="Enable location" disabled={busy}
              onPress={()=>session.current
                ? void Linking.openSettings().catch(cause=>setError(cause.message))
                : void autoWalk(true)}/>}
            {city.mode==='fixture'&&action('Advance 15 min',{op:'advance',seconds:900})}
            {city.mode==='fixture'&&action('Refresh location',{op:'fix',x:city.fix?.x??0,y:city.fix?.y??0})}
          </View>}
          {city.mode==='gps'&&supportsBackgroundWalk&&walking&&<View style={styles.buttons}><Text>Track with screen locked</Text>
            <Switch accessibilityLabel="Track with screen locked" value={walking.background} disabled={busy} onValueChange={value=>void changeBackgroundTracking(value)}/></View>}
          {city.mode==='gps'&&!initialCentre.current&&<View style={[styles.mapFrame,styles.mapMessage]}>
            <Text style={styles.muted}>{needsLocation?'Enable location to open the walking map.':'Finding your location and loading local walking paths…'}</Text>
          </View>}
          {showMap&&city.origin&&mapRegion&&<View style={styles.mapFrame}>
            <WalkingMap region={mapRegion} cells={mapCells} blocked={blocked}
              selected={tile&&hexOutline(city.origin,...mapPosition(tile))}
              marked={markedTile&&hexOutline(city.origin,...mapPosition(markedTile))}
              location={mapLocation} heading={locationHeading} bearing={bearing} onRotate={setBearing}
              onMove={setViewport} onSelect={selectHex}
              lines={[
                ...visiblePaths.map((coordinates,index)=>({key:`path-${index}`,coordinates,color:'#d8dbb4',outline:'#3b4834',width:2.5})),
                ...builtPathLines,
              ]}/>
            {!hasVisibleTiles&&!hasVisibleAccessMarks&&<View pointerEvents="none" style={[StyleSheet.absoluteFill,styles.mapMessage]}>
              {centeredOnLocation&&locationHeading!==undefined&&<DirectionArrow heading={locationHeading-bearing}/>}
              <Text style={styles.muted}>{city.town_store
                ? 'No discovered tiles in this area.'
                : 'Walk near a mapped public path to reveal your first tile.'}</Text>
            </View>}
            {mapLocation&&<Pressable accessibilityRole="button" accessibilityLabel="Center on my location"
              onPress={()=>moveMap(mapLocation)}
              style={({pressed})=>[styles.recenter,pressed&&styles.tabPressed]}>
              <DirectionArrow/>
            </Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel="Reset map to north up"
              onPress={()=>setBearing(0)}
              style={[styles.recenter,styles.orientation]}>
              <Text style={styles.orientationText}>N</Text>
            </Pressable>
            {siteName&&<Pressable accessibilityRole="button" accessibilityLabel={`Inspect ${siteName}`}
              onPress={()=>{setSiteSection(undefined);setSiteMenu(true);}}
              style={({pressed})=>[styles.mapInspect,pressed&&styles.tabPressed]}>
              <Text style={styles.mapInspectName}>{siteName}</Text>
              <Text style={styles.mapInspectArrow}>⌄</Text>
            </Pressable>}
          </View>}
          {city.mode==='fixture'&&<ScrollView style={styles.fixture}><FixtureMap x={gridX} y={gridY} selected={selected}
            tiles={city.tiles} sites={city.sites} marked={city.marked_tile} paths={city.tile_paths} attention={attention} onSelect={choose} busy={busy}
            onStep={city.mode==='fixture'?(dx,dy)=>void interact({op:'step',dx,dy}):undefined}/></ScrollView>}
          <View style={styles.mapMeta}>
            {city.walking&&<View style={styles.tracking}>
              <View style={styles.statusDot}/>
              <Text accessibilityLiveRegion="polite" style={styles.metaText}>
                {walking?.background?'Screen-locked walk':'Foreground walk'}
                {walking&&` · ${Math.max(0,Math.floor((tick/1000-walking.started)/60))} min`}
                {pending>0?` · ${pending} GPS ${pending===1?'fix':'fixes'} waiting to sync`:''}
              </Text>
            </View>}
            {markedTile&&<Pressable accessibilityRole="button" accessibilityLabel="Show marked tile on map"
              onPress={focusMarkedTile} style={styles.siteList}>
              <Text style={styles.markedLink}>⚑ Marked tile</Text>
            </Pressable>}
            {!!Object.keys(city.tiles).length&&<Pressable accessibilityRole="button" onPress={()=>setShowSites(true)}
              style={styles.siteList}><Text style={styles.metaText}>Sites ▾</Text></Pressable>}
            {city.mode==='gps'&&<Text accessibilityRole="link" style={styles.attribution}
              onPress={()=>void Linking.openURL('https://www.openstreetmap.org/copyright').catch(cause=>setError(cause.message))}>
              © OpenStreetMap
            </Text>}
          </View>
        </View>
        {showSites&&<GameMenu title="Sites" onClose={closeMenu} error={displayedActionError} onDismissError={()=>setActionError(undefined)}>
          <SiteDirectory city={city} catalog={catalog} attention={attention} onSelect={choose}/>
        </GameMenu>}
        {tile&&siteMenu&&<GameMenu title={siteName??'Site'} onClose={closeMenu} error={displayedActionError} onDismissError={()=>setActionError(undefined)} back={Boolean(siteSection)}>
            <View style={styles.siteHeader}>
              <View style={styles.siteBadge}><TileArt tile={tile} site={site} size={46}/></View>
              <View style={styles.siteHeading}>
                {tile.city_center&&<Text style={styles.buildName}>Town store</Text>}
                {tileCrops.length>0&&<Text style={styles.soilName}>{tile.soil} soil</Text>}
                {tile.resource==='pond'&&<Text style={styles.muted}>{site?'Fresh water':'Fresh water · Suitable for a fish pond'}</Text>}
                {!plot&&tile.resource!=='land'&&tile.resource!=='pond'&&tile.grade!==undefined&&
                  <Text style={styles.muted}>Resource quality · {tile.grade}/100</Text>}
                {tile.resource_tech&&!city.technologies.includes(tile.resource_tech)&&
                  <Text style={styles.muted}>Extraction requires {tile.resource_tech} research</Text>}
              </View>
              {!blockedKeys.has(hexKey(...mapPosition(tile)))&&
                <Text style={[styles.range,tile.nearby&&styles.inRange]}>{tile.nearby?'In range':'Out of range'}</Text>}
            </View>
            {!siteSection&&site&&catalog.building_details[site.kind]&&
              <Text style={styles.muted}>{catalog.building_details[site.kind].description}</Text>}
            {tile.tasks?.map((task,index)=><TaskProgress key={`${task.kind}-${index}`} task={task} now={cityTime}/>)}
            {site?.planned_crop&&plannedCrop&&(!siteSection||siteSection==='Construction')&&<View style={styles.card}>
              <Text style={styles.buildName}>Planned crop · {site.planned_crop}</Text>
              {site.built?<View style={styles.buttons}>
                <Button title={`Plant ${site.planned_crop}`} color="#396449"
                  disabled={busy||!tile.nearby||site.worker===null||!city.technologies.includes(plannedCrop.tech)}
                  onPress={()=>void interact({op:'plant',site:site.id,name:site.planned_crop,compost:compost&&hasCompost})}/>
                <Button title="Choose another crop" onPress={()=>setSiteSection('Production')}/>
              </View>:<Text style={styles.muted}>Finish construction to plant.</Text>}
              {!city.technologies.includes(plannedCrop.tech)&&
                <Text style={styles.muted}>Requires {plannedCrop.tech} research to plant.</Text>}
            </View>}
            {attention[tile.id]&&<Text accessibilityLiveRegion="polite" style={styles.attentionText}>
              {attention[tile.id].join(' · ')}
            </Text>}
            {!siteSection&&<View style={styles.buttons}>
              {!site&&!!tile.eligible?.length&&<Button title="Build menu" color="#396449" onPress={()=>setSiteSection('Plan')}/>}
              {(!!tile.path_targets?.length||connectedPaths.some(path=>path.sections?.length))&&
                <Button title={connectedPaths.some(path=>path.sections?.length)?'Roads & paths':'Build path'} onPress={()=>setSiteSection('Paths')}/>}
              {action(tile.id===city.marked_tile?'Clear tile marker':'Mark tile',
                {op:'mark tile',site:tile.id===city.marked_tile?null:tile.id})}
              {tile.resource==='prospect'&&<Button title="Survey" onPress={()=>setSiteSection('Survey')}/>}
              {site&&<Button title="Building info" onPress={()=>setSiteSection('Building info')}/>}
              {site&&!site.built&&<Button title="Construction" onPress={()=>setSiteSection('Construction')}/>}
              {site?.built&&<>
                <Button title="Overview" onPress={()=>setSiteSection('Overview')}/>
                <Button title="Stock" onPress={()=>setSiteSection('Stock')}/>
                {site.marketplace&&<Button title="Buy supplies" onPress={()=>setSiteSection('Supplies')}/>}
                {(site.options.length>0||catalog.sites[site.kind]?.plot)&&
                  <Button title={plot?'Crops':'Production'} onPress={()=>setSiteSection('Production')}/>}
                <Button title="Upgrades" onPress={()=>setSiteSection('Upgrades')}/>
                {site.staffing_requirement!=null&&<Button title="Staffing" onPress={()=>setSiteSection('Staffing')}/>}
                {site.kind!=='town store'&&<Button title="Manage building" onPress={()=>setSiteSection('Manage')}/>}
              </>}
            </View>}
            {!siteSection&&tileCrops.length>0&&<CropList crops={tileCrops} soil={tile.soil}
              technologies={city.technologies} forecast={site?.crop_forecast??city.crop_forecast} showPlot={!site}
              onChoose={!site&&tile.resource==='land'?name=>{setCropChoice(name);setSiteSection('Crop plan');}:undefined}/>}
            {siteSection==='Crop plan'&&!site&&cropChoice&&chosenCrop&&<View style={styles.card}>
              <Text style={styles.heading}>Build a {chosenCrop.plot}?</Text>
              <Text>Plan to plant {cropChoice} after construction.</Text>
              <Text>Materials · {formatCost(catalog.sites[chosenCrop.plot].cost)}</Text>
              <Text>Build time · {timeRemaining(catalog.building_details[chosenCrop.plot].construction_seconds??0)}</Text>
              <BuildingDetails kind={chosenCrop.plot} catalog={catalog} city={city} tile={tile}/>
              {!city.technologies.includes(chosenCrop.tech)&&<Text style={styles.muted}>
                Requires {chosenCrop.tech} research before planting.
              </Text>}
              <Button title={`Place ${chosenCrop.plot} blueprint`} color="#396449" disabled={busy}
                onPress={()=>void interact({op:'plan',site:tile.id,kind:chosenCrop.plot,crop:cropChoice})}/>
            </View>}
            {siteSection==='Survey'&&<>
            {tile.report&&<Text>{tile.report.message}</Text>}
            {tile.resource==='prospect'&&!tile.survey&&!tile.report?.mineral&&[1,2,3].map(tier=>
              action(`Survey tier ${tier} · ${[3,8,18][tier-1]} coins`,{op:'survey',site:tile.id,tier}))}
            </>}
            {siteSection==='Paths'&&<>
              {connectedPaths.map(({a,b,sections})=>{
                if(!sections?.length) return null;
                const id=a===tile.id?b:a;
                const destination=city.tiles[id];
                const name=city.sites[id]?.kind??destination?.resource??'Neighboring tile';
                const ordered=a===tile.id?sections:[...sections].reverse();
                const roads=[...new Map(ordered.map(section=>[section.road,section])).values()];
                return <View key={id} style={styles.card}>
                  <Text style={styles.buildName}>Path to {name}</Text>
                  {roads.map(({road,level,upgrade_cost},i)=>
                    <View key={road} style={styles.row}>
                      <Text>Section {i+1} · {level===0?'Unwalked':`Level ${level}`}</Text>
                      {upgrade_cost!=null?<Button title={`Upgrade to level ${level+1} · ${upgrade_cost} coins`}
                        disabled={busy||city.coins<upgrade_cost}
                        onPress={()=>void interact({op:'road',road,tier:level+1})}/>
                        :level<2&&<Text style={styles.muted}>Walk this section to reach level 2.</Text>}
                    </View>)}
                </View>;
              })}
              <Text style={styles.heading}>Connect neighboring tiles</Text>
              {tile.path_targets?.length?tile.path_targets.map(id=>{
                const destination=city.tiles[id];
                const [x,y]=mapPosition(tile),[east,south]=mapPosition(destination);
                const directions=['east','southeast','south','southwest','west','northwest','north','northeast'];
                const bearing=(Math.round(Math.atan2(south-y,east-x)/(Math.PI/4))+8)%8;
                const name=city.sites[id]?.kind??destination.report?.mineral??destination.resource;
                return <Button key={id} title={`${name.toUpperCase()} · ${directions[bearing]} · ${catalog.tile_path_cost} coins`}
                  disabled={busy||city.coins<catalog.tile_path_cost}
                  onPress={()=>void interact({op:'build path',site:tile.id,destination:id})}/>;
              }):<Text>No unconnected neighbors.</Text>}
              <Button title="View paths on map" onPress={()=>{setSiteMenu(false);setSiteSection(undefined);}}/>
            </>}
            {siteSection==='Plan'&&!site&&<BuildMenu catalog={catalog} city={city} tile={tile}
              group={buildGroup} choice={buildChoice} onGroup={setBuildGroup} onChoice={setBuildChoice}
              busy={busy} onPlan={kind=>void interact({op:'plan',site:tile.id,kind})}/>}
            {siteSection==='Manage'&&site?.built&&site.kind!=='town store'&&<>
              <Text style={styles.heading}>Demolish {site.kind}</Text>
              <Text>Stored goods go to the town store. Active production stops, and construction materials are spent.</Text>
              <Button title="Demolish building" color="#883d2c" disabled={busy||!tile.nearby} onPress={()=>Alert.alert(
                'Demolish this building?', 'The tile will be available to build on again.', [
                  {text:'Cancel',style:'cancel'},
                  {text:'Demolish',style:'destructive',onPress:()=>void interact({op:'demolish',site:tile.id})},
                ])}/>
            </>}
            {siteSection==='Building info'&&site&&<>
              <BuildingDetails kind={site.kind} catalog={catalog} city={city} tile={tile}/>
              {site.built&&catalog.building_details[site.kind].market_note&&city.town_store&&
                <Button title="See buyers at City Center" onPress={()=>{choose(city.town_store!);setSiteSection('Overview');}}/>}
            </>}
            {site&&!site.built&&!site.construction&&(!siteSection||siteSection==='Construction')&&<View style={styles.card}>
              <Text style={styles.buildName}>Materials to deliver</Text>
              {!!site.construction_seconds&&<Text style={styles.muted}>Build time · {timeRemaining(site.construction_seconds)}</Text>}
              {construction.length===0?<Text>Starter grant covers the construction materials.</Text>:
                construction.map(({goods,required,delivered,incoming})=><View key={goods.join('|')} style={styles.row}>
                  <Text style={styles.cropName}>{goods.join(' or ')}</Text>
                  <Text>{delivered} of {required} delivered · {required-delivered} missing</Text>
                  {incoming>0&&<Text style={styles.muted}>{incoming} on the way by haul</Text>}
                </View>)}
              {!materialsMissing&&<Text style={styles.muted}>All materials ready. Visit the tile to start construction.</Text>}
            </View>}
            {siteSection==='Construction'&&site?.construction&&
              <Text style={styles.muted}>The building opens when the timer reaches zero.</Text>}
            {siteSection==='Construction'&&site&&!site.built&&!site.construction&&<>
              {constructionCargo.length>0&&<>
                <Text style={styles.buildName}>Ready to deliver from your cargo</Text>
                {transfer(constructionCargo,'materials',site.id,'deliver')}
              </>}
              {site.materials.length>0&&<>
                <Text style={styles.buildName}>Materials on site</Text>
                {transfer(site.materials,'materials',site.id,'pickup')}
              </>}
              <Button title="Start construction" color="#396449" disabled={busy||materialsMissing}
                onPress={()=>void interact({op:'build',site:tile.id})}/>
              {action('Cancel blueprint',{op:'cancel',site:tile.id})}
            </>}
            {site?.built&&<>
              {siteSection==='Overview'&&<>
              {site.kind==='export depot'&&<>
                <Text style={styles.heading}>Exports</Text>
                {city.offers.map(o=><View key={o.id}><Text>{o.qty} × {o.good} · Q{o.floor}+</Text>
                  {!city.orders[o.id]&&action('Accept offer',{op:'accept export',order:o.id})}</View>)}
                {Object.values(city.orders).filter(o=>o.status==='active'&&o.expires>city.now).map(o=>
                  <View key={o.id}><Text>{o.qty} × {o.good} · Q{o.floor}+</Text>
                    {action('Ship order',{op:'ship export',site:site.id,order:o.id})}
                    {action('Abandon order',{op:'abandon export',order:o.id})}</View>)}
              </>}
              {site.marketplace&&<>
                <MarketGuide steps={catalog.market_guide}/>
                {!Object.values(city.market_orders).some(Boolean)&&
                  <Text style={styles.muted}>Buyers appear when your city can make finished goods.</Text>}
                {Object.entries(city.market_orders).map(([slot,order])=>order&&<View key={slot} style={styles.card}>
                  <Text style={styles.buildName}>{slot===city.town_store?'Town Store':city.sites[slot]?.kind?.toUpperCase()}</Text>
                  {order.refresh?<Text>Next buyer in {timeRemaining(Math.max(0,order.refresh-cityTime))}</Text>:<>
                    <Text>Sell {order.qty} {order.good} for {order.payout} coins</Text>
                    <Text style={styles.muted}>
                      {total(site.shared.filter(lot=>lot.good===order.good))} of {order.qty} in this marketplace’s stock
                    </Text>
                    {!!order.id&&action('Sell to buyer',{op:'fill market order',site:site.id,slot,order:order.id})}
                    {!!order.id&&action('Dismiss order',{op:'dismiss market order',site:site.id,slot,order:order.id})}
                  </>}
                </View>)}
              </>}
              {site.kind==='machine works'&&action('Fit vehicle kit',{op:'fit kit',site:site.id})}
              <Text>Level {site.level}</Text>
              {site.batch?.at!=null&&site.batch.at<=cityTime&&
                <Button title="Refresh stock" onPress={()=>void request<City>('city').then(update).catch(cause=>setError(cause.message))}/>}
              {site.assessment&&<Text>{site.assessment}</Text>}
              {site.household&&<>
                <Text>Household · {site.household.score.toFixed(1)} / 100 · {site.household.hours} / 24 hours</Text>
                <Text>{Object.entries(site.household.coverage).map(([need,value])=>`${need} ${Math.round(value*100)}%`).join(' · ')}</Text>
                <Text>Food families · {site.household.families.join(', ')||'None yet'}</Text>
              </>}
              </>}
              {siteSection==='Production'&&<>
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
              {plot&&!site.crop&&hasCompost&&
                <View style={styles.buttons}><Text>Apply compost · +2 units</Text>
                  <Switch accessibilityLabel="Apply compost" value={compost} onValueChange={setCompost}/>
                </View>}
              {plot&&<>
                {site.crop
                  ?<>{action(`Harvest ${site.crop.name} · Q${site.crop.q}`,{op:'harvest',site:site.id})}
                    {action('Clear plot',{op:'clear crop',site:site.id})}</>
                  :site.worker===null&&<Text style={styles.muted}>This plot needs a worker. Raise its priority under Staffing.</Text>}
                <CropList crops={tileCrops} soil={tile.soil} technologies={city.technologies}
                  forecast={site.crop_forecast??city.crop_forecast} compost={!site.crop&&compost&&hasCompost} canPlant={!busy&&site.worker!==null&&tile.nearby}
                  onPlant={site.crop?undefined:name=>void interact({op:'plant',site:site.id,name,compost:compost&&hasCompost})}/>
              </>}
              </>}
              {siteSection==='Supplies'&&site.marketplace&&<>
                <Text style={styles.buildName}>Buy supplies</Text>
                <Text style={styles.muted}>Collect purchases from this marketplace’s stock.</Text>
                {Object.entries(city.supply_prices??{}).map(([good,price])=><View key={good} style={styles.card}>
                  <Text style={styles.cropName}>{good} · {price} coins each</Text>
                  <View style={styles.buttons}>
                    {[1,3].map(qty=><Button key={qty} title={`Buy ${qty} · ${qty*price} coins`}
                      disabled={busy||city.coins<qty*price}
                      onPress={()=>void interact({op:'buy supplies',site:site.id,good,qty})}/>)}
                  </View>
                </View>)}
                {city.supply_prices?.['pine log']===undefined&&<Text style={styles.muted}>Build a sawmill to buy logs.</Text>}
              </>}
              {siteSection==='Stock'&&(['output','input','shared','pantry'] as const).map(buf=>{
                const show=site[buf].length>0||(buf==='input'&&(site.input_goods??[]).length>0)||
                  (buf==='output'&&(site.options.length>0||Boolean(plot)))||
                  (buf==='shared'&&(site.marketplace||['warehouse','export depot'].includes(site.kind)))||
                  (buf==='pantry'&&['town store','cottage','townhouse','apartment house'].includes(site.kind));
                if(!show) return null;
                const supplies=buf==='input'?city.cargo.filter(lot=>(site.input_goods??[]).some(good=>
                  good===lot.good||(['log','plank'].includes(good)&&lot.good.endsWith(' '+good)))):city.cargo;
                return <View key={buf} style={styles.stockSection}>
                  <Text style={styles.heading}>{{output:'Finished goods',input:'Inputs',shared:'Storage',pantry:'Pantry'}[buf]}
                    {site.capacity[buf]!==undefined&&` · ${total(site[buf])}/${site.capacity[buf]}`}
                  </Text>
                  {site[buf].length?transfer(site[buf],buf,site.id,'pickup',buf==='shared'&&site.marketplace):
                    <Text style={styles.muted}>Empty</Text>}
                  {buf!=='output'&&supplies.length>0&&<>
                    <Text style={styles.muted}>In your cargo</Text>
                    {transfer(supplies,buf,site.id,'deliver')}
                  </>}
                </View>;
              })}
              {siteSection==='Upgrades'&&<>
              {site.service_coverage?.map(({label,radius,covered,at_capacity})=>
                <Text key={label}>{label} within {radius} m · {covered?'Covered':at_capacity?'At capacity':'Needed'}</Text>)}
              {site.level<10&&<><Text>Upgrade · {formatCost(site.next_cost)}</Text>
                {transfer(site.upgrade,'upgrade',site.id,'pickup')}{transfer(city.cargo,'upgrade',site.id,'deliver')}
                {action('Finish upgrade',{op:'upgrade',site:site.id,level:site.level+1})}</>}
              {site.conversion_kind&&site.conversion_cost&&<>
                <Text>Convert to {site.conversion_kind} · {formatCost(site.conversion_cost)}</Text>
                {transfer(site.conversion,'conversion',site.id,'pickup')}{transfer(city.cargo,'conversion',site.id,'deliver')}
                {action('Finish conversion',{op:'convert',site:site.id,kind:site.conversion_kind})}
              </>}
              </>}
              {siteSection==='Staffing'&&site.staffing_requirement!=null&&<>
                <Text style={styles.buildName}>Staffing priority</Text>
                <Text style={styles.muted}>{site.visiting?'Visiting instructor':site.worker===null?'Vacant':'Staffed'} · Education {site.staffing_requirement}+</Text>
                <Text style={styles.muted}>Higher-priority sites get qualified workers first.</Text>
                {site.school_coverage&&<Text>{site.school_coverage.used} / {site.school_coverage.capacity} coverage places
                  {' · '}{site.school_coverage.radius} m walking range{' · '}{site.school_coverage.class_size} seats per class</Text>}
                {site.last_class&&<Text>Last class · {site.last_class.graduated} graduated · {site.last_class.failed} reached their education limit</Text>}
                <View style={styles.buttons}>
                  {['Low','Normal','High'].map((label,priority)=>{
                    const active=priority===site.staff_priority;
                    return <Pressable key={label} accessibilityRole="button" accessibilityState={{selected:active,disabled:busy}}
                      disabled={busy} onPress={()=>void interact({op:'staff priority',site:site.id,priority})}
                      style={[styles.priorityOption,active&&styles.priorityActive]}>
                      <Text style={active?styles.buildName:styles.muted}>{label}</Text>
                    </Pressable>;
                  })}
                </View>
                {site.worker!==null&&action('Train crew',{op:'train',site:site.id})}
                {site.school_coverage&&!site.course&&(site.visiting||site.worker!==null)&&
                  action('Enroll eligible residents',{op:'enrol',site:site.id})}
              </>}
            </>}
        </GameMenu>}
        {screen==='City'&&<GameMenu title={citySection??'Settlement'} onClose={closeMenu} error={displayedActionError} onDismissError={()=>setActionError(undefined)} back={Boolean(citySection)}>
          {!citySection&&<>
            <Text>{city.citizens.length} residents · {city.vouchers} haul vouchers</Text>
            <View style={styles.buttons}>
              {['Sites','Hauls','Settings'].map(section=>
                <Button key={section} title={section} onPress={()=>setCitySection(section)}/>)}
            </View>
          </>}
          {citySection==='Sites'&&<SiteDirectory city={city} catalog={catalog} attention={attention} onSelect={choose}/>}
          {citySection==='Hauls'&&<>
          {city.mode==='gps'&&<VoucherStore<City> changed={update} visible/>}
          {city.mode==='fixture'&&action('Sandbox · add five vouchers',{op:'purchase',receipt:nonce()})}
          {city.jobs.map(job=><Text key={job.id}>Haul to {job.dst} · {job.fee?job.fee+' coins':'voucher'} · {job.done?'Delivered':Math.max(0,Math.ceil((job.at-city.now)/60))+' min'}</Text>)}
          {haul&&<View style={styles.card}>
            <Text>Haul {haul.good} from {haul.site}</Text>
            <TextInput accessibilityLabel="Haul quantity" value={haulQty} onChangeText={setHaulQty}
              keyboardType="number-pad" style={styles.input}/>
            <View style={styles.buttons}><Text>Use a voucher</Text><Switch value={useVoucher} onValueChange={setUseVoucher}/></View>
            {Object.values(city.sites).filter(s=>s.id!==haul.site).flatMap(s=>
              (s.built?['input','shared','pantry','upgrade','conversion']:['materials']).map(buffer=>
                <Button key={s.id+buffer} title={`Quote to ${s.kind.toUpperCase()} ${s.id} · ${buffer}`} onPress={()=>void quoteHaul(s.id,buffer)}/>))}
          </View>}
          </>}
          {citySection==='Settings'&&<>
          <Button title="Refresh city"  onPress={()=>void request<City>('city').then(update).catch(cause=>setError(cause.message))}/>
          <Button title="Delete city" color="#883d2c" onPress={()=>Alert.alert('Delete city','Remove your save and location history?',[
            {text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>void (async()=>{
              try {
                subscription.current?.remove();
                if(await hasBackgroundWalk()) await Location.stopLocationUpdatesAsync(TRACKING_TASK);
                await request('city','DELETE');
                await clearWalk();
                await AsyncStorage.multiRemove([TOKEN,REFRESH,MUTATION]);
                session.current=null;state.current=undefined;setCity(undefined);setWalking(null);
              } catch(cause) {setError(cause instanceof Error?cause.message:String(cause));}
            })()},
          ])}/>
          </>}
        </GameMenu>}
        {screen==='Research'&&<GameMenu title="Research" onClose={closeMenu} error={displayedActionError} onDismissError={()=>setActionError(undefined)}>
          <ResearchTree technologies={catalog.technologies} costs={catalog.research_costs}
            requirements={city.research_requirements??[]} known={city.technologies}
            active={city.research} now={cityTime} busy={busy} coins={city.coins} crops={catalog.crops} recipes={catalog.recipes}
            onStart={name=>void interact({op:'research',name})}/>
        </GameMenu>}
        {screen==='Almanac'&&<GameMenu title={almanacEntry?.title??'Almanac'} onClose={closeMenu}
          back={Boolean(almanacEntry)} scrollable={false} error={displayedActionError} onDismissError={()=>setActionError(undefined)}>
          <Almanac catalog={catalog} technologies={city.technologies} entry={almanacEntry} buildingGroup={buildingGroup}
            onOpen={entry=>setAlmanacHistory(history=>[...history,entry])}/>
        </GameMenu>}
      </>}
      {!API&&<Text>Set EXPO_PUBLIC_VESTIGIA_API before starting the development build.</Text>}
    </View>
    {city&&catalog&&<View style={styles.navigation} accessibilityRole="tablist">
      {tabs.map(({name,glyph})=><Pressable key={name} accessibilityRole="tab" accessibilityLabel={name}
        accessibilityState={{selected:screen===name}} onPress={()=>{
          setSiteMenu(false);setSiteSection(undefined);setShowSites(false);setCitySection(undefined);
          setAlmanacHistory([]);setScreen(name);
        }} style={({pressed})=>[styles.tab,screen===name&&styles.tabActive,pressed&&styles.tabPressed]}>
        <Text style={[styles.tabGlyph,screen===name&&styles.tabTextActive]}>{glyph}</Text>
        <Text style={[styles.tabText,screen===name&&styles.tabTextActive]}>{name}</Text>
      </Pressable>)}
    </View>}
  </SafeAreaView>;
}

function Stat({label,value}:{label:string;value:string|number}) {
  return <View style={styles.stat}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>;
}

function ActionNotice({message,onDismiss}:{message:string;onDismiss:()=>void}) {
  return <View style={styles.actionNotice}>
    <Text style={styles.actionNoticeMessage} accessibilityRole="alert" accessibilityLiveRegion="polite">{message}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" hitSlop={8} onPress={onDismiss}>
      <Text style={styles.actionNoticeMessage}>×</Text>
    </Pressable>
  </View>;
}

function GameMenu({title,onClose,back=false,scrollable=true,error,onDismissError,children}:{
  title:string; onClose:()=>void; back?:boolean; scrollable?:boolean; error?:string; onDismissError:()=>void; children:React.ReactNode;
}) {
  return <View style={styles.menu} accessibilityViewIsModal>
    <View style={styles.menuHeader}>
      <Text accessibilityRole="header" style={[styles.heading,styles.menuTitle]}>{title}</Text>
      <Button title={back?'Back':'Close'} onPress={onClose}/>
    </View>
    {!!error&&<View style={styles.menuNotice}><ActionNotice message={error} onDismiss={onDismissError}/></View>}
    {scrollable?<ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.menuContent}>
      {children}
    </ScrollView>:children}
  </View>;
}

function CropList({crops,soil,technologies,forecast,showPlot=false,compost=false,canPlant=false,onPlant,onChoose}:{
  crops:[string,Crop][]; soil:string; technologies:string[]; forecast:CropForecast; showPlot?:boolean;
  compost?:boolean; canPlant?:boolean; onPlant?:(name:string)=>void; onChoose?:(name:string)=>void;
}) {
  const ranked=[...crops].sort(([name,a],[other,b])=>
    Number(b.soil===soil)-Number(a.soil===soil)||name.localeCompare(other));
  return <>
    <Text accessibilityRole="header" style={styles.buildName}>Crops by soil suitability</Text>
    {ranked.map(([name,crop])=>{
      const match=crop.soil===soil;
      const locked=!technologies.includes(crop.tech);
      const base=forecast[match?'match':'mismatch'];
      const harvest=compost&&base.with_compost?base.with_compost:base;
      const contents=<>
        <View style={styles.siteHeading}>
          <Text style={styles.cropName}>{name}</Text>
          <Text style={match?styles.cropMatch:styles.muted}>
            Soil suitability {base.suitability}/100 · {match?'Best fit':`Prefers ${crop.soil} soil`}
          </Text>
          <Text>Est. harvest · {harvest.qty} units at Q{harvest.q}/100</Text>
          <Text style={styles.muted}>{timeRemaining(crop.seconds)} base grow time</Text>
          {showPlot&&<Text style={styles.muted}>Plot required · {crop.plot}</Text>}
          {locked&&<Text style={styles.muted}>Requires {crop.tech} research</Text>}
        </View>
        {onPlant&&<Button title={`Plant ${name}`} color="#396449" disabled={!canPlant||locked}
          onPress={()=>onPlant(name)}/>}
        {onChoose&&<Text style={styles.cropMatch}>Plan ›</Text>}
      </>;
      return onChoose?<Pressable key={name} accessibilityRole="button" onPress={()=>onChoose(name)}
        style={({pressed})=>[styles.buildCard,pressed&&styles.tabPressed]}>{contents}</Pressable>:
        <View key={name} style={styles.buildCard}>{contents}</View>;
    })}
  </>;
}

function InventoryRows({lots,actions}:{lots:Lot[];actions:(lot:InventoryUnit)=>React.ReactNode}) {
  const [expanded,setExpanded]=useState<string>();
  const goods=new Map<string,Map<number,number>>();
  for(const lot of lots) {
    const grades=goods.get(lot.good)??new Map<number,number>();
    grades.set(lot.q,(grades.get(lot.q)??0)+lot.qty);
    goods.set(lot.good,grades);
  }
  return <>{[...goods].map(([good,quantities])=>{
    const grades=[...quantities].sort(([a],[b])=>b-a);
    const qty=grades.reduce((sum,[,amount])=>sum+amount,0);
    const multi=grades.length>1;
    return <View key={good} style={styles.card}>
      <View style={styles.inventoryHeading}>
        <Text style={styles.cropName}>{good}</Text>
        <Text style={styles.buildName}>×{qty}</Text>
      </View>
      <Text style={styles.muted}>{grades.length>4?`${grades.length} quality grades`:
        grades.map(([quality,amount])=>multi?`Q${quality} ×${amount}`:`Quality Q${quality}`).join(' · ')}</Text>
      {actions({good,qty,q:multi?undefined:grades[0][0]})}
      {multi&&<Button title={expanded===good?'Hide quality choices':'Choose by quality'}
        onPress={()=>setExpanded(value=>value===good?undefined:good)}/>}
      {multi&&expanded===good&&grades.map(([q,amount])=><View key={q} style={styles.row}>
        <Text style={styles.muted}>Q{q} · {amount} units</Text>
        {actions({good,qty:amount,q})}
      </View>)}
    </View>;
  })}</>;
}

function SiteDirectory({city,catalog,attention,onSelect}:{
  city:City; catalog:Catalog; attention:Record<string,string[]>; onSelect:(id:string)=>void;
}) {
  const [query,setQuery]=useState('');
  const [expanded,setExpanded]=useState(()=>Object.values(city.sites).some(site=>!site.built)?'Construction':'City Center');
  const filter=query.trim().toLowerCase();
  const marked=city.marked_tile?city.tiles[city.marked_tile]:undefined;
  const nameOf=(tile:Tile)=>tile.city_center?'City Center':
    city.sites[tile.id]?.kind??tile.report?.mineral??tile.resource;
  const groupOf=(tile:Tile)=>{
    const site=city.sites[tile.id];
    if(tile.city_center) return 'City Center';
    if(!site) return tile.resource==='land'?'Land':'Natural resources';
    if(!site.built) return 'Construction';
    return buildingGroup(site.kind,catalog.sites[site.kind]?.plot);
  };
  const groups=new Map<string,Tile[]>();
  for(const tile of Object.values(city.tiles)) {
    if(filter&&!`${nameOf(tile)} ${groupOf(tile)} ${(attention[tile.id]??[]).join(' ')}`.toLowerCase().includes(filter)) continue;
    const group=groupOf(tile);
    const entries=groups.get(group)??[];
    entries.push(tile);
    groups.set(group,entries);
  }
  const order=['City Center','Construction',...buildCategories.map(category=>category.name),'Natural resources','Land'];
  const row=(tile:Tile)=><Pressable key={tile.id} accessibilityRole="button" onPress={()=>onSelect(tile.id)}
    style={({pressed})=>[styles.buildCard,pressed&&styles.tabPressed]}>
    <View style={styles.siteBadge}><TileArt tile={tile} site={city.sites[tile.id]} size={46}/></View>
    <View style={styles.siteHeading}>
      <Text style={styles.buildName}>{nameOf(tile).toUpperCase()}</Text>
      {attention[tile.id]&&<Text style={styles.attentionText}>{attention[tile.id].join(' · ')}</Text>}
      {tile.nearby&&<Text style={styles.muted}>In range</Text>}
    </View>
    {tile.id===city.marked_tile&&<Text style={styles.markedLink}>⚑</Text>}
    <Text style={styles.muted}>›</Text>
  </Pressable>;
  return <>
    <TextInput accessibilityLabel="Search sites" placeholder="Search sites" placeholderTextColor={palette.muted}
      value={query} onChangeText={setQuery} style={styles.input}/>
    {marked&&!filter&&<>
      <Text style={styles.markedLink}>Marked tile</Text>
      {row(marked)}
    </>}
    {order.map(group=>{
      const tiles=groups.get(group);
      if(!tiles?.length) return null;
      const open=Boolean(filter)||group===expanded;
      const needsAttention=tiles.filter(tile=>attention[tile.id]).length;
      return <React.Fragment key={group}>
        <Pressable accessibilityRole="button" accessibilityState={{expanded:open}}
          onPress={()=>setExpanded(value=>value===group?'':group)} style={styles.buildCard}>
          <Text style={styles.siteHeading}>{group}</Text>
          {needsAttention>0&&<Text style={styles.attentionText}>! {needsAttention}</Text>}
          <Text style={styles.muted}>{tiles.length} {open?'⌄':'›'}</Text>
        </Pressable>
        {open&&tiles.sort((a,b)=>Number(Boolean(attention[b.id]))-Number(Boolean(attention[a.id]))||
          nameOf(a).localeCompare(nameOf(b))).map(row)}
      </React.Fragment>;
    })}
    {!groups.size&&<Text style={styles.muted}>No matching sites.</Text>}
  </>;
}

function MarketGuide({steps}:{steps:string[]}) {
  return <View style={styles.card}>
    <Text style={styles.buildName}>How market orders work</Text>
    {steps.map(step=><Text style={styles.muted} key={step}>{step}</Text>)}
  </View>;
}

function BuildingDetails({kind,catalog,city,tile}:{
  kind:string; catalog:Catalog; city:City; tile:Tile;
}) {
  const [expanded,setExpanded]=useState(false);
  const details=catalog.building_details[kind];
  const local=tile.report?.mineral??(kind==='lumberjack station'?`${tile.resource} log`:tile.resource);
  const all=Object.entries(catalog.recipes).filter(([,recipe])=>recipe.site===kind);
  const localRecipes=all.filter(([,recipe])=>recipe.inputs.length===0&&recipe.outputs.some(([,good])=>good===local));
  const recipes=localRecipes.length?localRecipes:all;
  return <>
    <Text>{details.description}</Text>
    {details.coverage&&<Text style={styles.muted}>{details.coverage}</Text>}
    {details.market_note&&<Text style={styles.muted}>{details.market_note}</Text>}
    {(details.market_note||kind==='town store'||kind==='local marketplace')&&<MarketGuide steps={catalog.market_guide}/>}
    {details.shared>0&&<Text style={styles.muted}>Shared storage · {details.shared} units at level 1</Text>}
    {details.lead!==null&&<Text style={styles.muted}>Crew · 1 resident, education {details.lead}+</Text>}
    {!!details.inputs&&<Text style={styles.muted}>Operating inputs · {details.inputs}</Text>}
    {!details.inputs&&!recipes.length&&!details.market_note&&
      <Text style={styles.muted}>Operating inputs · None</Text>}
    {recipes.length>0&&<>
      <Text style={styles.buildName}>{localRecipes.length?'Production on this tile':'Production recipes'}</Text>
      {(expanded?recipes:recipes.slice(0,3)).map(([key,recipe])=><View key={key} style={styles.card}>
        <Text style={styles.buildName}>Produces {recipe.outputs.map(([qty,good])=>`${qty} ${good}`).join(' + ')}</Text>
        <Text style={styles.muted}>{recipe.inputs.length?`Inputs · ${formatCost(recipe.inputs)}`:'Inputs · The tile’s natural resources'}</Text>
        <Text style={styles.muted}>{timeRemaining(recipe.seconds)} per batch at level 1
          {!city.technologies.includes(recipe.tech)&&` · Requires ${recipe.tech} research`}</Text>
      </View>)}
      {recipes.length>3&&<Button title={expanded?'Show fewer recipes':`Show all ${recipes.length} recipes`}
        onPress={()=>setExpanded(value=>!value)}/>}
    </>}
  </>;
}

function BuildMenu({catalog,city,tile,group,choice,busy,onGroup,onChoice,onPlan}:{
  catalog:Catalog; city:City; tile:Tile; group?:string; choice?:string; busy:boolean;
  onGroup:(group:string)=>void; onChoice:(name:string)=>void; onPlan:(kind:string)=>void;
}) {
  const options=Object.entries(catalog.sites).filter(([name])=>tile.eligible?.includes(name)).map(([name,site])=>{
    const category=buildingGroup(name,site.plot);
    const grant=['lumberjack station','sawmill'].includes(name)&&
      (!city.grants.includes(name)||city.starter_rebuilds?.includes(name));
    const tech=[...new Set(Object.values(catalog.recipes).filter(recipe=>recipe.site===name).map(recipe=>recipe.tech))]
      .sort((a,b)=>(catalog.technologies[a]?.[0]??0)-(catalog.technologies[b]?.[0]??0))[0];
    const tier=catalog.technologies[tech]?.[0]??0;
    const stage=grant||['cottage','lumberjack station','sawmill','field'].includes(name)?0:tier>=2?2:1;
    return {name,category,stage,cost:grant?'Starter grant':formatCost(site.cost),
      seconds:grant?catalog.starter_construction_seconds:catalog.building_details[name].construction_seconds};
  }).sort((a,b)=>a.name.localeCompare(b.name));
  const selected=options.find(option=>option.name===choice);
  if(selected) return <>
    <View style={styles.buildCard}>
      <View style={styles.siteBadge}><TileArt tile={tile} site={{kind:selected.name,built:true}} size={46}/></View>
      <View style={styles.siteHeading}>
        <Text style={[styles.heading,styles.buildName]}>{selected.name.toUpperCase()}</Text>
        <Text>Materials · {selected.cost}</Text>
        {!!selected.seconds&&<Text style={styles.muted}>Build time · {timeRemaining(selected.seconds)}</Text>}
      </View>
    </View>
    <BuildingDetails key={selected.name} kind={selected.name} catalog={catalog} city={city} tile={tile}/>
    <Button title="Place blueprint" color="#396449" disabled={busy} onPress={()=>onPlan(selected.name)}/>
    {catalog.sites[selected.name].plot&&<CropList crops={Object.entries(catalog.crops)
      .filter(([,crop])=>crop.plot===catalog.sites[selected.name].plot)}
      soil={tile.soil} technologies={city.technologies} forecast={city.crop_forecast}/>}

  </>;
  if(group) return <>
    <Text style={styles.heading}>{group}</Text>
    {buildStages.map((stage,index)=>{
      const candidates=options.filter(option=>option.category===group&&option.stage===index);
      return candidates.length>0&&<View key={stage} style={styles.buildGroup}>
        <Text style={styles.muted}>{stage}</Text>
        {candidates.map(option=><Pressable key={option.name} accessibilityRole="button"
          onPress={()=>onChoice(option.name)} style={({pressed})=>[styles.buildCard,pressed&&styles.tabPressed]}>
          <View style={styles.siteBadge}><TileArt tile={tile} site={{kind:option.name,built:true}} size={46}/></View>
          <View style={styles.siteHeading}>
            <Text style={styles.buildName}>{option.name.toUpperCase()}</Text>
            <Text style={styles.muted}>{option.cost}</Text>
            <Text numberOfLines={2} style={styles.muted}>{catalog.building_details[option.name].description}</Text>
          </View>
          <Text style={styles.muted}>›</Text>
        </Pressable>)}
      </View>;
    })}
  </>;
  return <>
    <Text style={styles.heading}>Build on this tile</Text>
    {buildCategories.map(category=>{
      const count=options.filter(option=>option.category===category.name).length;
      return count>0&&<Pressable key={category.name} accessibilityRole="button"
        onPress={()=>onGroup(category.name)} style={({pressed})=>[styles.buildCard,pressed&&styles.tabPressed]}>
        <Text style={[styles.buildName,styles.siteHeading]}>{category.name}</Text>
        <Text style={styles.muted}>{count}</Text><Text style={styles.muted}>›</Text>
      </Pressable>;
    })}
  </>;
}

function DirectionArrow({heading=0}:{heading?:number}) {
  return <View style={[styles.arrow,heading!==0&&{transform:[{rotate:`${heading}deg`}]}]}>
    <View style={styles.arrowOutline}/>
    <View style={styles.arrowFill}/>
  </View>;
}

const styles=StyleSheet.create({
  background:{flex:1,backgroundColor:palette.world},
  hud:{minHeight:64,backgroundColor:palette.shadow,borderBottomWidth:1,borderBottomColor:palette.line,
    flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:9,gap:10,flexWrap:'wrap'},
  wordmark:{fontFamily:'serif',fontSize:26,fontWeight:'700',color:palette.brass},
  balance:{flexDirection:'row',gap:6},
  stat:{minWidth:43,alignItems:'center',backgroundColor:palette.panel,borderRadius:8,
    paddingHorizontal:8,paddingVertical:4},
  statValue:{fontWeight:'700',fontVariant:['tabular-nums'],fontSize:14},
  statLabel:{fontSize:10,color:palette.muted,textTransform:'uppercase',letterSpacing:.5},
  gameBody:{flex:1,padding:10,gap:8},
  mapArea:{flex:1,gap:6},
  fixture:{flex:1},
  menu:{...StyleSheet.absoluteFill,backgroundColor:palette.world,zIndex:10,borderRadius:12,
    margin:8,borderWidth:1,borderColor:palette.line,overflow:'hidden'},
  menuHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,
    padding:12,borderBottomWidth:1,borderBottomColor:palette.line},
  menuContent:{padding:12,gap:10,paddingBottom:18},
  menuTitle:{flexShrink:1},
  siteList:{minHeight:44,justifyContent:'center',paddingHorizontal:10},
  heading:{fontSize:23,fontFamily:'serif',fontWeight:'700',color:palette.silk},
  muted:{color:palette.muted,fontSize:13},
  card:{backgroundColor:palette.panel,borderWidth:1,borderColor:palette.line,borderRadius:16,padding:13,gap:10},
  buttons:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8},
  row:{paddingVertical:8,gap:5,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:palette.line},
  mapFrame:{flex:1,borderWidth:1,borderColor:'#6d7d5b',borderRadius:16,overflow:'hidden',backgroundColor:fogColor},
  mapMessage:{backgroundColor:fogColor,alignItems:'center',justifyContent:'center',gap:10,padding:16},
  orientation:{right:60},
  orientationText:{fontSize:20,fontWeight:'700'},
  buildGroup:{gap:8,paddingVertical:6},
  buildCard:{flexDirection:'row',alignItems:'center',gap:10,borderWidth:1,borderColor:palette.line,
    backgroundColor:palette.panel,padding:10,borderRadius:10,minHeight:48},
  buildName:{fontWeight:'700'},
  soilName:{textTransform:'capitalize',fontWeight:'600'},
  cropName:{textTransform:'capitalize',fontWeight:'700'},
  priorityOption:{paddingVertical:9,paddingHorizontal:15,borderWidth:1,borderColor:palette.line,borderRadius:8},
  priorityActive:{borderColor:palette.brass,backgroundColor:palette.panel},
  menuNotice:{paddingHorizontal:12,paddingTop:8},
  actionNotice:{flexDirection:'row',alignItems:'center',padding:10,gap:10,borderWidth:1,
    borderColor:'#aa6550',borderRadius:8,backgroundColor:'#442923'},
  actionNoticeMessage:{color:'#ffe1ce',flexShrink:1},
  markedLink:{color:'#9ae5d6',fontWeight:'700'},
  stockSection:{gap:8},
  inventoryHeading:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:8},
  cropMatch:{color:'#c4dfa1',fontSize:13},
  attentionText:{color:'#f3c471',fontWeight:'700'},
  arrow:{width:24,height:26,alignItems:'center',justifyContent:'center'},
  arrowOutline:{borderLeftWidth:10,borderRightWidth:10,borderBottomWidth:21,
    borderLeftColor:'transparent',borderRightColor:'transparent',borderBottomColor:'#fff'},
  arrowFill:{position:'absolute',top:7,borderLeftWidth:6,borderRightWidth:6,borderBottomWidth:14,
    borderLeftColor:'transparent',borderRightColor:'transparent',borderBottomColor:'#2679fb'},
  recenter:{position:'absolute',top:10,right:10,width:44,height:44,alignItems:'center',justifyContent:'center',
    borderWidth:1,borderColor:palette.line,borderRadius:10,backgroundColor:palette.shadow},
  mapInspect:{position:'absolute',bottom:34,left:10,maxWidth:'76%',minHeight:44,alignItems:'center',gap:12,
    flexDirection:'row',paddingHorizontal:11,borderWidth:1,borderColor:'#8a7957',borderRadius:9,backgroundColor:palette.shadow},
  mapInspectName:{fontWeight:'600',flexShrink:1},
  mapInspectArrow:{color:palette.brass,fontSize:19},
  mapMeta:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap'},
  tracking:{flexDirection:'row',gap:6,alignItems:'center'},
  statusDot:{height:7,width:7,borderRadius:4,backgroundColor:'#9bd297'},
  metaText:{color:palette.muted,fontSize:12},
  siteHeader:{flexDirection:'row',alignItems:'center',gap:10,marginBottom:3},
  siteBadge:{width:46,height:46,overflow:'hidden',borderRadius:9},
  siteHeading:{flex:1,gap:2},
  range:{alignSelf:'flex-start',paddingHorizontal:7,paddingVertical:4,borderRadius:6,
    backgroundColor:palette.world,color:palette.muted,fontSize:11},
  inRange:{color:'#b3e3ad',backgroundColor:'#284332'},
  input:{borderWidth:1,borderColor:palette.line,backgroundColor:palette.shadow,color:palette.silk,
    padding:10,borderRadius:8,minHeight:48},
  error:{color:'#ffccbf',backgroundColor:'#462c25',borderRadius:8,padding:10},
  attribution:{fontSize:11,color:palette.muted,textDecorationLine:'underline'},
  navigation:{flexDirection:'row',paddingHorizontal:10,paddingTop:6,paddingBottom:Platform.OS==='android'?12:6,
    borderTopWidth:1,borderTopColor:palette.line,backgroundColor:palette.shadow,gap:5},
  tab:{flex:1,borderRadius:10,minHeight:51,alignItems:'center',justifyContent:'center',paddingHorizontal:2},
  tabActive:{backgroundColor:palette.raised},
  tabPressed:{opacity:.65},
  tabGlyph:{fontSize:21,lineHeight:25,color:palette.muted},
  tabText:{color:palette.muted,fontSize:11,fontWeight:'600'},
  tabTextActive:{color:palette.brass},
});
