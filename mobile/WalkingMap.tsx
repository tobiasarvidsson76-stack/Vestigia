import React, {useRef, useState} from 'react';
import {Image, StyleSheet, View, type GestureResponderEvent} from 'react-native';
import Svg, {Circle, G, Path, Polygon, Polyline, Rect, Text as SvgText} from 'react-native-svg';
import type {LatLng, Region} from 'react-native-maps';
import {pondArt} from './FixtureMap';

// Each image contains one atlas cell with transparent corners matching a point-up hex.
const hexArt = [
  require('./assets/hex-art/0.png'),
  require('./assets/hex-art/1.png'),
  require('./assets/hex-art/2.png'),
  require('./assets/hex-art/3.png'),
  require('./assets/hex-art/4.png'),
  require('./assets/hex-art/5.png'),
  require('./assets/hex-art/6.png'),
  require('./assets/hex-art/7.png'),
  require('./assets/hex-art/8.png'),
  require('./assets/hex-art/9.png'),
  require('./assets/hex-art/10.png'),
  require('./assets/hex-art/11.png'),
  require('./assets/hex-art/12.png'),
  require('./assets/hex-art/13.png'),
  require('./assets/hex-art/14.png'),
  require('./assets/hex-art/15.png'),
  ...pondArt,
];

type Cell = {key:string; outline:LatLng[]; glyph?:number; name?:string; raised?:boolean; notice?:boolean};
type Line = {key:string; coordinates:LatLng[]; color:string; outline?:string; width:number; dash?:number[]};
type Props = {
  region:Region; cells:Cell[]; lines:Line[];
  blocked:{key:string;outline:LatLng[];strike:LatLng[];counterStrike:LatLng[]}[];
  selected?:LatLng[]; marked?:LatLng[]; location?:LatLng; heading?:number; bearing:number;
  onMove:(region:Region)=>void; onRotate:(bearing:number)=>void; onSelect:(coordinate:LatLng)=>void;
};

const tileColors:Record<number,string>={
  0:'#899963',1:'#526749',2:'#ad985e',3:'#8f8b7c',4:'#aa795c',
  5:'#607552',6:'#7e7773',13:'#a48962',16:'#477582',17:'#477582',
};

function tileRelief(vertices:number[][],centerX:number,centerY:number,width:number,raised:boolean) {
  const depth=Math.min(4.5,Math.max(1.2,width*(raised ? .058 : .043)));
  const inset=vertices.map(([x,y])=>{
    const scale=1-depth/Math.max(depth+1,Math.hypot(x-centerX,y-centerY));
    return [centerX+(x-centerX)*scale,centerY+(y-centerY)*scale];
  });
  return vertices.map(([x,y],index)=>{
    const next=(index+1)%vertices.length;
    const [nx,ny]=vertices[next];
    const light=(centerX-(x+nx)/2)*.55+(centerY-(y+ny)/2)*.83;
    return {
      path:`M${[vertices[index],vertices[next],inset[next],inset[index]].map(p=>p.join(',')).join(' L')} Z`,
      highlight:light>=0,
    };
  });
}

function touchPosition({nativeEvent:{touches}}:GestureResponderEvent) {
  const [first,second]=touches;
  return second ? {
    x:(first.pageX+second.pageX)/2,y:(first.pageY+second.pageY)/2,
    distance:Math.max(1,Math.hypot(first.pageX-second.pageX,first.pageY-second.pageY)),count:2,
    angle:Math.atan2(second.pageY-first.pageY,second.pageX-first.pageX),
  } : {x:first.pageX,y:first.pageY,distance:1,count:1,angle:0};
}

export default function WalkingMap({region,cells,lines,blocked,selected,marked,location,heading,bearing:onReleaseBearing,onMove,onRotate,onSelect}:Props) {
  const [{width,height},setSize]=useState({width:0,height:0});
  const [draft,setDraft]=useState<Region>();
  const [draftBearing,setDraftBearing]=useState<number>();
  const camera=draft??region;
  const bearing=draftBearing??onReleaseBearing;
  const gesture=useRef<{
    start:ReturnType<typeof touchPosition>; region:Region; latest:Region;
    bearing:number; latestBearing:number; moved:boolean;
  }>(null);
  const aspect=width&&height?width/height:1;
  const longitudeScale=aspect/Math.max(.1,Math.cos(camera.latitude*Math.PI/180));
  const longitudeDelta=camera.latitudeDelta*longitudeScale;
  const angle=bearing*Math.PI/180;
  const cos=Math.cos(angle),sin=Math.sin(angle);
  const offset=(x:number,y:number)=>[x*cos-y*sin,x*sin+y*cos];
  const coordinateAt=(x:number,y:number)=>{
    const [east,south]=offset(x-width/2,y-height/2);
    return {latitude:camera.latitude-south/height*camera.latitudeDelta,
      longitude:camera.longitude+east/width*longitudeDelta};
  };
  const unrotated=({latitude,longitude}:LatLng)=>[
    width*(longitude-camera.longitude)/longitudeDelta,
    height*(camera.latitude-latitude)/camera.latitudeDelta,
  ];
  const point=(coordinate:LatLng)=>{
    const [x,y]=unrotated(coordinate);
    return [width/2+x*cos+y*sin,height/2-x*sin+y*cos];
  };
  const points=(coordinates:LatLng[])=>coordinates.map(p=>point(p).join(',')).join(' ');
  const onscreen=(vertices:number[][])=>{
    const xs=vertices.map(p=>p[0]),ys=vertices.map(p=>p[1]);
    return Math.max(...xs)>=0&&Math.max(...ys)>=0&&Math.min(...xs)<=width&&Math.min(...ys)<=height;
  };
  const tiles=cells.flatMap(cell=>{
    const vertices=cell.outline.map(point);
    if(!onscreen(vertices)) return [];
    const [north,east,,south,west]=cell.outline.map(unrotated);
    const w=east[0]-west[0],h=south[1]-north[1];
    const centerX=(vertices[0][0]+vertices[3][0])/2;
    const centerY=(vertices[0][1]+vertices[3][1])/2;
    const font=Math.min(11,Math.max(8,w*.12));
    const labelLength=Math.floor((w-18)/(font*.58));
    const label=cell.name&&w>=58&&labelLength>=5
      ?cell.name.length>labelLength?cell.name.slice(0,labelLength-1).trimEnd()+'…':cell.name
      :undefined;
    return [{...cell,left:centerX-w/2,top:centerY-h/2,w,h,centerX,centerY,font,label,
      relief:tileRelief(vertices,centerX,centerY,w,Boolean(cell.raised)),
      badgeX:(centerX+2*vertices[1][0])/3,badgeY:(centerY+2*vertices[1][1])/3,polygon:vertices.map(p=>p.join(',')).join(' ')}];
  });
  const relief=tiles.flatMap(tile=>tile.relief);
  const rimLight=relief.filter(edge=>edge.highlight).map(edge=>edge.path).join(' ');
  const rimShade=relief.filter(edge=>!edge.highlight).map(edge=>edge.path).join(' ');
  const [locationX,locationY]=location?point(location):[];
  const markedVertices=marked?.map(point);
  const visibleMark=markedVertices&&onscreen(markedVertices);
  const markX=markedVertices?(markedVertices[0][0]+markedVertices[3][0])/2:0;
  const markY=markedVertices?(markedVertices[0][1]+markedVertices[3][1])/2:0;
  return <View style={StyleSheet.absoluteFill}
    onLayout={event=>{
      const {width,height}=event.nativeEvent.layout;
      setSize({width,height});
      if(width&&height) onMove({...region,
        longitudeDelta:region.latitudeDelta*width/height/Math.max(.1,Math.cos(region.latitude*Math.PI/180))});
    }}
    onStartShouldSetResponder={()=>true}
    onResponderGrant={event=>{
      gesture.current={start:touchPosition(event),region:camera,latest:camera,bearing,latestBearing:bearing,moved:false};
    }}
    onResponderMove={event=>{
      const active=gesture.current;
      if(!active||!width||!height) return;
      const touch=touchPosition(event);
      if(touch.count!==active.start.count) {
        active.start=touch;
        active.region=active.latest;
        active.bearing=active.latestBearing;
        active.moved=true;
        return;
      }
      const dx=touch.x-active.start.x,dy=touch.y-active.start.y;
      const angleDelta=touch.angle-active.start.angle;
      const twist=touch.count===2?Math.atan2(Math.sin(angleDelta),Math.cos(angleDelta)):0;
      if(!active.moved&&Math.hypot(dx,dy,touch.distance-active.start.distance,twist*touch.distance/2)<5) return;
      const base=active.region;
      const latitudeDelta=Math.min(.03,Math.max(.001,base.latitudeDelta*active.start.distance/touch.distance));
      const nextBearing=active.bearing-twist*180/Math.PI;
      const radians=nextBearing*Math.PI/180;
      const east=dx*Math.cos(radians)-dy*Math.sin(radians);
      const south=dx*Math.sin(radians)+dy*Math.cos(radians);
      const latitude=Math.max(-85,Math.min(85,base.latitude+south*base.latitudeDelta/height));
      const longitudeDelta=latitudeDelta*longitudeScale;
      const longitude=base.longitude-east*base.latitudeDelta*longitudeScale/width;
      active.moved=true;
      active.latest={latitude,longitude,latitudeDelta,longitudeDelta};
      active.latestBearing=nextBearing;
      setDraft(active.latest);
      setDraftBearing(nextBearing);
    }}
    onResponderRelease={event=>{
      const active=gesture.current;
      gesture.current=null;
      if(active?.moved) {
        onMove(active.latest);
        onRotate((active.latestBearing%360+360)%360);
      }
      else if(width&&height) onSelect(coordinateAt(event.nativeEvent.locationX,event.nativeEvent.locationY));
      setDraft(undefined);
      setDraftBearing(undefined);
    }}
    onResponderTerminate={()=>{gesture.current=null;setDraft(undefined);setDraftBearing(undefined);}}>
    {width>0&&height>0&&<>
      <Svg pointerEvents="none" width={width} height={height} style={StyleSheet.absoluteFill}>
        {tiles.map(({key,polygon,glyph,raised})=><Polygon key={key} points={polygon}
          fill={tileColors[glyph??0]??(raised?'#a49170':'#899963')}/>)}
      </Svg>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {tiles.map(({key,glyph,left,top,w,h})=>glyph!==undefined&&<Image key={key}
          source={hexArt[glyph]} resizeMode="stretch" fadeDuration={0}
          style={[styles.art,{left,top,width:w,height:h,transform:[{rotate:`${-bearing}deg`}]}]}/>)}
      </View>
      <Svg pointerEvents="none" width={width} height={height} style={StyleSheet.absoluteFill}>
        {!!rimLight&&<Path d={rimLight} fill="rgba(249,232,182,0.36)"/>}
        {!!rimShade&&<Path d={rimShade} fill="rgba(21,32,23,0.57)"/>}
        {tiles.map(({key,polygon})=><Polygon key={key} points={polygon}
          fill="none" stroke="#25362b" strokeWidth={1.4}/>)}
        {blocked.filter(cell=>onscreen(cell.outline.map(point))).map(cell=><React.Fragment key={cell.key}>
          <Polygon points={points(cell.outline)} fill="rgba(160,82,62,0.30)" stroke="#a57e6d"/>
          <Polyline points={points(cell.strike)} stroke="#ecad93" strokeWidth={2.2} strokeLinecap="round"/>
          <Polyline points={points(cell.counterStrike)} stroke="#ecad93" strokeWidth={2.2} strokeLinecap="round"/>
        </React.Fragment>)}
        {selected&&<Polygon points={points(selected)} fill="none" stroke="#e9ba67" strokeWidth={2}/>}
        {lines.map(line=>{
          const route=points(line.coordinates);
          return <React.Fragment key={line.key}>
            {line.outline&&<Polyline points={route} fill="none" stroke={line.outline}
              strokeWidth={line.width+1.5} strokeLinejoin="round" strokeDasharray={line.dash}/>}
            <Polyline points={route} fill="none" stroke={line.color}
              strokeWidth={line.width} strokeLinejoin="round" strokeDasharray={line.dash}/>
          </React.Fragment>;
        })}
        {tiles.map(({key,label,centerX,centerY,h,font})=>{
          if(!label) return null;
          const labelWidth=label.length*font*.58+8;
          const baseline=centerY+h*.27;
          return <G key={key}>
            <Rect x={centerX-labelWidth/2} y={baseline-font} width={labelWidth} height={font+4}
              rx={3} fill="rgba(20,31,24,0.88)"/>
            <SvgText x={centerX} y={baseline} fontSize={font} fontWeight="700" textAnchor="middle" fill="#fff2d5">
              {label[0].toUpperCase()+label.slice(1)}
            </SvgText>
          </G>;
        })}
        {tiles.map(({key,notice,badgeX,badgeY})=>notice&&<G key={key} translateX={badgeX} translateY={badgeY}>
          <Circle r={8} fill="#f3c471" stroke="#3d2d1f" strokeWidth={1.4}/>
          <Path d="M0 -3.5v4 M0 3h.01" stroke="#372518" strokeWidth={1.7} strokeLinecap="round"/>
        </G>)}
        {visibleMark&&markedVertices&&<>
          <Polygon points={markedVertices.map(p=>p.join(',')).join(' ')} fill="none" stroke="#9ae5d6"
            strokeWidth={3} strokeDasharray="7 4"/>
          <G translateX={markX} translateY={markY-13}>
            <Circle r={10} fill="#17443f" stroke="#9ae5d6" strokeWidth={1.5}/>
            <Path d="M-3 5V-5H5L2 -1H-3" stroke="#9ae5d6" fill="#9ae5d6" strokeWidth={1.5}/>
          </G>
        </>}
        {location&&<G translateX={locationX} translateY={locationY} rotation={(heading??bearing)-bearing}>
          {heading===undefined
            ? <Circle r={6} fill="#2679fb" stroke="#fff" strokeWidth={2}/>
            : <Polygon points="0,-13 9,10 0,6 -9,10" fill="#2679fb" stroke="#fff" strokeWidth={2}/>}
        </G>}
      </Svg>
    </>}
  </View>;
}

const styles=StyleSheet.create({art:{position:'absolute',opacity:.83}});
