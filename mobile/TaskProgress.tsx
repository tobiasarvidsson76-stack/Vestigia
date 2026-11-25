import React from 'react';
import {StyleSheet, View} from 'react-native';
import {palette, Text} from './GameUI';

export type TileTask = {
  kind:string; label:string; at?:number|null; duration?:number|null; remaining?:number|null;
  collected?:number; required?:number;
};

export function durationLabel(seconds:number) {
  const minutes=Math.ceil(seconds/60);
  if(seconds<60) return `${Math.ceil(seconds)} sec`;
  return minutes>=60?`${Math.floor(minutes/60)} h ${minutes%60} min`:`${minutes} min`;
}

export default function TaskProgress({task,now}:{task:TileTask;now:number}) {
  const paused=task.at===null;
  const remaining=Math.max(0,task.at==null?(task.remaining??0):task.at-now);
  const material=task.required!==undefined;
  const progress=material?(task.collected??0)/Math.max(1,task.required??0):
    task.duration?1-remaining/task.duration:remaining===0&&!paused?1:undefined;
  const percent=progress===undefined?undefined:Math.round(100*Math.max(0,Math.min(1,progress)));
  const status=material?`${task.collected} of ${task.required} units`:
    paused?`Paused · ${durationLabel(remaining)} left`:
    remaining>0?`${durationLabel(remaining)} left`:task.kind==='crop'?'Ready to harvest':'Complete';
  return <View style={styles.card}>
    <Text style={styles.label}>{task.label}</Text>
    <Text style={styles.status}>{status}{percent===undefined?'':` · ${percent}%`}</Text>
    {percent!==undefined&&<View accessibilityRole="progressbar" accessibilityLabel={task.label}
      accessibilityValue={{min:0,max:100,now:percent}} style={styles.track}>
      <View style={[styles.fill,{width:`${percent}%`}]}/>
    </View>}
  </View>;
}

const styles=StyleSheet.create({
  card:{gap:5,padding:10,borderRadius:10,borderWidth:1,borderColor:palette.line,backgroundColor:palette.panel},
  label:{fontWeight:'700'},
  status:{color:palette.muted,fontSize:13},
  track:{height:6,borderRadius:3,backgroundColor:palette.shadow,overflow:'hidden'},
  fill:{height:6,backgroundColor:palette.brass},
});
