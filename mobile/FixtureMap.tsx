import React, {useState} from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';

const tileAtlas = require('./assets/fixture-map.png');
export const pondArt = [require('./assets/hex-art/16.png'),require('./assets/hex-art/17.png')];
const size = 5;
const radius = Math.floor(size / 2);

const terrainArt: Record<string, number> = {
  land: 0, pine: 1, pond: 16, stone: 3, clay: 4, prospect: 6,
  oak: 5, birch: 5, maple: 5, fir: 1, spruce: 1,
};
const buildingArt: Record<string, number> = {
  field: 2, 'fish pond': 17, 'town store': 8, 'lumberjack station': 9, sawmill: 10, cottage: 11,
  warehouse: 12, 'export depot': 12, workshop: 14, townhouse: 15, 'apartment house': 15,
};

type Terrain = {resource: string; report?: {mineral?: string}};
type Building = {built: boolean; kind: string};

export function tileGlyph(tile: Terrain, site?: Building) {
  return site ? (site.built ? (buildingArt[site.kind]??14) : 13) : (terrainArt[tile.resource]??7);
}

export function TileArt({tile, site, size}: {tile: Terrain; site?: Building; size: number}) {
  const glyph=tileGlyph(tile,site);
  if(glyph>=16) return <Image source={pondArt[glyph-16]} resizeMode="stretch" fadeDuration={0}
    style={{width:size,height:size}}/>;
  return <Image source={tileAtlas} resizeMode="stretch" fadeDuration={0} style={{
    position:'absolute',width:size*4,height:size*4,left:-size*(glyph%4),top:-size*Math.floor(glyph/4),
  }}/>;
}

type Props = {
  x: number;
  y: number;
  selected: string;
  marked?: string;
  tiles: Record<string, Terrain>;
  sites: Record<string, Building>;
  paths: {a:string;b:string}[];
  attention: Record<string,string[]>;
  onSelect: (id: string) => void;
  onStep?: (dx: number, dy: number) => void;
  busy?: boolean;
};

const directions = [
  {name:'West', arrow:'←', dx:-1, dy:0},
  {name:'North', arrow:'↑', dx:0, dy:-1},
  {name:'South', arrow:'↓', dx:0, dy:1},
  {name:'East', arrow:'→', dx:1, dy:0},
];

export default function FixtureMap({x, y, selected, tiles, sites, marked, paths, attention, onSelect, onStep, busy}: Props) {
  const [mapWidth, setMapWidth] = useState(0);
  const cell = mapWidth / size;
  const selectedTile = tiles[selected];
  const selectedSite = sites[selected];
  const [selectedX,selectedY] = selected.split(',').map(Number);
  const inspectDistantTile = onStep && selectedTile && (Math.abs(selectedX-x)>radius || Math.abs(selectedY-y)>radius);
  const centerX = inspectDistantTile ? selectedX : x;
  const centerY = inspectDistantTile ? selectedY : y;

  return <View style={styles.frame}>
    <View style={styles.header}>
      <Text style={styles.region}>Settlement map</Text>
      <Text accessibilityLabel="North is up" style={styles.north}>↑ N</Text>
    </View>
    <View style={styles.map} onLayout={event=>setMapWidth(event.nativeEvent.layout.width)}>
      {cell>0 && Array.from({length:size*size},(_,index)=>{
        const dx=index%size-radius;
        const dy=Math.floor(index/size)-radius;
        const id=`${centerX+dx},${centerY+dy}`;
        const tile=tiles[id];
        if (!tile) return null;
        const dimensions={width:cell,height:cell,left:(dx+radius)*cell,top:(dy+radius)*cell};
        const site=sites[id];
        const name=site?.kind??tile.report?.mineral??tile.resource;
        const ends=paths.flatMap(({a,b})=>a===id?[b]:b===id?[a]:[]);
        const here=centerX+dx===x&&centerY+dy===y;
        return <Pressable key={id} style={[styles.cell,dimensions]} onPress={()=>onSelect(id)}
          accessibilityRole="button" accessibilityState={{selected:id===selected}}
          accessibilityLabel={`${name} at ${id}${here?', your location':''}${attention[id]?', '+attention[id].join(', '):''}`}>
          <TileArt tile={tile} site={site} size={cell}/>
          {ends.map(end=>{
            const [endX,endY]=end.split(',').map(Number);
            const horizontal=endY===centerY+dy;
            return <View key={end} pointerEvents="none" style={[styles.road,horizontal
              ?{width:'50%',height:4,top:'50%',[endX>centerX+dx?'right':'left']:0}
              :{width:4,height:'50%',left:'50%',[endY>centerY+dy?'bottom':'top']:0}]}/>;
          })}
          <View style={styles.relief} pointerEvents="none"/>
          {(site||tile.resource!=='land')&&cell>=53&&<Text style={styles.tileLabel} numberOfLines={1} pointerEvents="none">
            {name}
          </Text>}
          {id===selected&&<View style={styles.selection} pointerEvents="none"/>}
          {id===marked&&<View style={styles.marked} pointerEvents="none"><Text style={styles.markedText}>⚑</Text></View>}
          {here&&<View style={styles.location} pointerEvents="none"/>}
          {attention[id]&&<View style={styles.notice} pointerEvents="none"><Text style={styles.noticeText}>!</Text></View>}
        </Pressable>;
      })}
    </View>
    <View style={styles.footer}>
      <Text style={styles.name}>{selectedSite?.kind??selectedTile?.report?.mineral??selectedTile?.resource??'Your settlement'}</Text>
      <Text style={styles.coordinates}>{selected||`${x},${y}`}</Text>
    </View>
    {onStep&&<View style={styles.controls}>
      {directions.map(({name,arrow,dx,dy})=><Pressable key={name}
        accessibilityRole="button" accessibilityLabel={name} disabled={busy}
        onPress={()=>onStep(dx,dy)} style={({pressed})=>[
          styles.direction,pressed&&styles.pressed,busy&&styles.disabled,
        ]}>
        <Text style={styles.arrow}>{arrow}</Text>
        <Text style={styles.directionName}>{name}</Text>
      </Pressable>)}
    </View>}
  </View>;
}

const styles=StyleSheet.create({
  frame:{backgroundColor:'#1c2820',borderRadius:16,overflow:'hidden',borderWidth:1,borderColor:'#3b4b37'},
  header:{paddingHorizontal:14,paddingVertical:11,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  region:{fontSize:15,color:'#f5e9cd',fontWeight:'700'},
  north:{fontSize:13,color:'#e1be77',fontWeight:'700'},
  map:{backgroundColor:'#000',width:'100%',aspectRatio:1},
  cell:{position:'absolute',overflow:'hidden',backgroundColor:'#66744b'},
  marked:{...StyleSheet.absoluteFill,borderWidth:2,borderColor:'#9ae5d6',alignItems:'center'},
  markedText:{color:'#9ae5d6',fontSize:18,fontWeight:'900'},
  relief:{...StyleSheet.absoluteFill,borderWidth:2,borderTopColor:'#dfcf9c',borderLeftColor:'#b8ac82',
    borderBottomColor:'#344236',borderRightColor:'#344236',opacity:.72},
  tileLabel:{position:'absolute',left:5,right:5,bottom:8,textAlign:'center',paddingHorizontal:2,
    borderRadius:3,backgroundColor:'#25362b',color:'#fff2d5',fontSize:10,fontWeight:'700',textTransform:'capitalize'},
  selection:{...StyleSheet.absoluteFill,borderWidth:2,borderColor:'#ffdc88'},
  road:{position:'absolute',backgroundColor:'#ecd29b'},
  location:{position:'absolute',top:6,right:6,width:12,height:12,borderRadius:6,borderWidth:2,
    borderColor:'#fff6dc',backgroundColor:'#3a86cb'},
  notice:{position:'absolute',top:5,left:5,width:16,height:16,borderRadius:8,alignItems:'center',justifyContent:'center',
    backgroundColor:'#f3c471',borderColor:'#3d2d1f',borderWidth:1},
  noticeText:{fontSize:11,fontWeight:'900',lineHeight:13,color:'#372518'},
  footer:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingHorizontal:14,paddingVertical:10},
  name:{color:'#f5e9cd',fontSize:15,fontWeight:'600',textTransform:'uppercase'},
  coordinates:{color:'#bcbfae',fontSize:13},
  controls:{flexDirection:'row',gap:6,paddingHorizontal:10,paddingBottom:10},
  direction:{flex:1,minHeight:48,alignItems:'center',justifyContent:'center',borderRadius:8,backgroundColor:'#324235'},
  pressed:{backgroundColor:'#485c49'},
  disabled:{opacity:0.55},
  arrow:{fontSize:20,color:'#f4d59a'},
  directionName:{fontSize:12,color:'#f5e9cd'},
});
