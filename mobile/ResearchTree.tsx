import React, {useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import {Button, palette, Text} from './GameUI';
import TaskProgress, {durationLabel} from './TaskProgress';

export type ResearchRequirement = {label:string; actual:number; required:number};

type Props = {
  technologies:Record<string,[number,string[]]>;
  costs:[number,number][];
  requirements:ResearchRequirement[][];
  known:string[];
  active?:{name:string;at:number;duration?:number};
  now:number;
  busy:boolean;
  coins:number;
  crops:Record<string,{tech:string}>;
  recipes:Record<string,{tech:string;site:string;outputs:[number,string][]}>;
  onStart:(name:string)=>void;
};

const nodeWidth=142,nodeHeight=62,columnStep=184,rowStep=76;

export default function ResearchTree({technologies,costs,requirements:cityRequirements,known,active,now,busy,coins,crops,recipes,onStart}:Props) {
  const [chosen,setChosen]=useState<string>();
  const current=chosen??active?.name??Object.keys(technologies)[0];
  const entries=useMemo(()=>{
    const layers:string[][]=[];
    const depths=new Map<string,number>();
    const depth=(name:string):number=>{
      const cached=depths.get(name);
      if(cached!==undefined) return cached;
      const value=Math.max(0,...technologies[name][1].map(dependency=>depth(dependency)+1));
      depths.set(name,value);
      return value;
    };
    for(const name of Object.keys(technologies)) (layers[depth(name)]??=[]).push(name);
    const height=Math.max(...layers.map(layer=>layer.length))*rowStep;
    const nodes=layers.flatMap((layer,column)=>layer.map((name,row)=>({
      name,x:column*columnStep+5,y:(height-layer.length*rowStep)/2+row*rowStep+5,
    })));
    return {height,width:layers.length*columnStep-24,nodes,byName:new Map(nodes.map(node=>[node.name,node]))};
  },[technologies]);
  const [tier,requirements]=technologies[current];
  const [cost,seconds]=costs[tier];
  const civicRequirements=cityRequirements[tier]??[];
  const meetsRequirements=(tier:number)=>(cityRequirements[tier]??[]).every(row=>row.actual>=row.required);
  const missing=requirements.filter(name=>!known.includes(name));
  const complete=known.includes(current);
  const researching=current===active?.name;
  const cropUnlocks=Object.entries(crops).filter(([,crop])=>crop.tech===current).map(([name])=>name).sort();
  const factories=new Map<string,Set<string>>();
  for(const recipe of Object.values(recipes)) {
    if(recipe.tech!==current) continue;
    const goods=factories.get(recipe.site)??new Set<string>();
    for(const [,name] of recipe.outputs) goods.add(name);
    factories.set(recipe.site,goods);
  }
  return <>
    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
      <View style={{width:entries.width,height:entries.height}}>
        <Svg width={entries.width} height={entries.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          {entries.nodes.flatMap(to=>technologies[to.name][1].map(name=>{
            const from=entries.byName.get(name)!;
            const x1=from.x+nodeWidth,y1=from.y+nodeHeight/2;
            const x2=to.x,y2=to.y+nodeHeight/2;
            const bend=x1+(x2-x1)*.45;
            const selected=to.name===current;
            const route=x2-x1>columnStep?
              `M${x1},${y1} H${x1+12} V${entries.height-4} H${x2-12} V${y2} H${x2}`:
              `M${x1},${y1} C${bend},${y1} ${bend},${y2} ${x2},${y2}`;
            return <Path key={`${name}/${to.name}`} d={route} fill="none"
              stroke={selected?palette.brass:known.includes(name)?'#789564':'#506051'}
              strokeWidth={selected?2.5:1.5}/>;
          }))}
        </Svg>
        {entries.nodes.map(({name,x,y})=>{
          const done=known.includes(name);
          const running=name===active?.name;
          const [nodeTier,parents]=technologies[name];
          const ready=!done&&!running&&!active&&coins>=costs[nodeTier][0]&&
            parents.every(parent=>known.includes(parent))&&meetsRequirements(nodeTier);
          return <Pressable key={name} accessibilityRole="button" accessibilityState={{selected:name===current}}
            onPress={()=>setChosen(name)} style={[styles.node,{left:x,top:y},
              done&&styles.complete,(running||name===current)&&styles.selected]}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.status}>{done?'Complete':running?'In progress':ready?'Available':'Locked'}</Text>
          </Pressable>;
        })}
      </View>
    </ScrollView>
    <View style={styles.details}>
      <Text style={styles.detailTitle}>{current}</Text>
      {researching&&active?<TaskProgress task={{kind:'research',label:'Research',at:active.at,
        duration:active.duration??seconds}} now={now}/>:!complete&&
        <Text style={styles.status}>{cost} coins · {durationLabel(seconds)}</Text>}
      {missing.length>0&&<Text>Requires {missing.join(', ')}</Text>}
      {!complete&&!researching&&civicRequirements.map(({label,actual,required})=>
        <Text key={label}>{label} · {actual} / {required}</Text>)}
      {!complete&&!active&&!missing.length&&<Button title="Begin research" color="#396449"
        disabled={busy||coins<cost||!meetsRequirements(tier)} onPress={()=>onStart(current)}/>}
      {cropUnlocks.length>0&&<Text>Crops · {cropUnlocks.join(', ')}</Text>}
      {[...factories.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([site,goods])=>
        <Text key={site}>{site[0].toUpperCase()+site.slice(1)} · {[...goods].sort().join(', ')}</Text>)}
    </View>
  </>;
}

const styles=StyleSheet.create({
  node:{position:'absolute',width:nodeWidth,height:nodeHeight,padding:7,justifyContent:'center',
    borderRadius:9,borderWidth:1,borderColor:palette.line,backgroundColor:palette.panel},
  complete:{backgroundColor:'#324a35'},
  selected:{borderColor:palette.brass,borderWidth:2},
  name:{fontSize:13,fontWeight:'700'},
  status:{fontSize:12,color:palette.muted},
  details:{gap:7,padding:12,backgroundColor:palette.panel,borderRadius:10},
  detailTitle:{fontSize:18,fontWeight:'700'},
});
