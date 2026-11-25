import React, {useEffect, useRef, useState} from 'react';
import {
  Animated, Image, Pressable, SafeAreaView, StatusBar, StyleSheet,
  Text as NativeText, View, type TextProps,
} from 'react-native';

export const palette = {
  world:'#111d1a', panel:'#1d2e29', raised:'#263b32', line:'#41564a',
  silk:'#f5e9d0', muted:'#b6c7b8', brass:'#e8bb71', shadow:'#0b1513',
};

export function Text({style,...props}:TextProps) {
  return <NativeText {...props} style={[styles.text,style]}/>;
}

export function Button({title,onPress,disabled,color}:{
  title:string; onPress:()=>void; disabled?:boolean; color?:string;
}) {
  const danger=color==='#883d2c';
  const primary=color==='#396449';
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled}
    onPress={onPress} style={({pressed})=>[
      styles.action,primary&&styles.primary,danger&&styles.danger,pressed&&styles.pressed,disabled&&styles.disabled,
    ]}>
    <Text style={[styles.actionLabel,primary&&styles.primaryLabel]}>{title}</Text>
  </Pressable>;
}

export function LaunchScreen({onStart}:{onStart:()=>void}) {
  const [ready,setReady]=useState(false);
  const opacity=useRef(new Animated.Value(0)).current;
  useEffect(()=>{
    const timer=setTimeout(()=>setReady(true),2000);
    return ()=>clearTimeout(timer);
  },[]);
  useEffect(()=>{
    if(!ready) return;
    const reveal=Animated.timing(opacity,{toValue:1,duration:300,useNativeDriver:true});
    reveal.start();
    return ()=>reveal.stop();
  },[opacity,ready]);

  return <View style={styles.launch}>
    <StatusBar hidden barStyle="light-content"/>
    <Image source={require('./assets/vestigia-title.png')} resizeMode="cover" style={styles.art}/>
    <SafeAreaView style={styles.launchSafe}>
      <View style={styles.masthead}>
        <Text style={styles.title} accessibilityRole="header">VESTIGIA</Text>
        <View style={styles.rule}/>
      </View>
      <View style={styles.launchFoot}>
        {ready ? <Animated.View style={{opacity}}>
          <Pressable accessibilityRole="button" accessibilityLabel="Enter Vestigia" onPress={onStart}
            style={({pressed})=>[styles.launchButton,pressed&&styles.launchPressed]}>
            <View style={styles.launchFace}>
              <View style={styles.compass}><Text style={styles.compassNeedle}>✦</Text></View>
              <Text style={styles.launchLabel}>Enter Vestigia</Text>
              <Text style={styles.chevron}>›</Text>
            </View>
          </Pressable>
        </Animated.View> : <View accessible accessibilityLabel="Loading Vestigia" style={styles.loading}>
          {[0,1,2].map(i=><View key={i} style={[styles.spark,{opacity:.35+.25*i}]}/>)}
        </View>}
      </View>
    </SafeAreaView>
  </View>;
}

const styles=StyleSheet.create({
  text:{color:palette.silk},
  action:{alignSelf:'flex-start',minHeight:44,justifyContent:'center',borderWidth:1,
    borderColor:palette.line,borderRadius:10,backgroundColor:palette.raised,paddingVertical:10,paddingHorizontal:14},
  primary:{borderColor:'#68806b',backgroundColor:'#344e3f'},
  danger:{backgroundColor:'#482c28',borderColor:'#754c41'},
  actionLabel:{fontWeight:'600',fontSize:14},
  primaryLabel:{color:'#ffe4b0'},
  pressed:{opacity:.72},
  disabled:{opacity:.46},
  launch:{flex:1,backgroundColor:'#0c201e'},
  art:{position:'absolute',top:0,left:0,width:'100%',height:'100%'},
  launchSafe:{flex:1,justifyContent:'space-between'},
  masthead:{alignItems:'center',marginTop:44,paddingHorizontal:18},
  title:{color:'#ffe7ad',fontFamily:'serif',fontSize:49,fontWeight:'700',letterSpacing:4,textAlign:'center',
    textShadowColor:'#101a17',textShadowOffset:{width:0,height:3},textShadowRadius:12},
  rule:{marginTop:12,width:76,height:1,backgroundColor:'#e4ba79'},
  launchFoot:{paddingHorizontal:38,paddingBottom:48,alignItems:'center'},
  loading:{height:70,flexDirection:'row',gap:10,alignItems:'center'},
  spark:{width:6,height:6,backgroundColor:palette.brass,transform:[{rotate:'45deg'}]},
  launchButton:{borderRadius:18,borderWidth:1,borderColor:'#f4cc87',padding:4,backgroundColor:'#132720',
    shadowColor:'#000',shadowOpacity:.5,shadowRadius:15,shadowOffset:{width:0,height:6},elevation:5},
  launchPressed:{transform:[{scale:.97}],opacity:.86},
  launchFace:{minHeight:58,flexDirection:'row',alignItems:'center',gap:13,paddingHorizontal:14,
    backgroundColor:'#e8bb71',borderRadius:13,borderWidth:1,borderColor:'#ffe0aa'},
  compass:{width:28,height:28,alignItems:'center',justifyContent:'center',borderRadius:14,
    borderColor:'#7d6139',borderWidth:1},
  compassNeedle:{color:'#3b2c19',fontSize:17},
  launchLabel:{color:'#291f16',fontSize:19,fontFamily:'serif',fontWeight:'700'},
  chevron:{color:'#553d20',fontSize:27,marginLeft:4},
});
