import type {LatLng} from 'react-native-maps';

type Point = [number,number];
type Region = {coordinates: LatLng[]; holes: LatLng[][]};
const radius=39;
const stepX=Math.sqrt(3)*radius/2;
const stepY=radius/2;
const degreesPerMetre=180/(Math.PI*6371008.8);
const corners:Point[]=[[0,-2],[1,-1],[1,1],[0,2],[-1,1],[-1,-1]];

function hexCentre(x:number,y:number):Point {
  const r=y/(3*stepY);
  const q=x/(2*stepX)-r/2;
  const s=-q-r;
  let row=Math.round(r);
  let col=Math.round(q);
  const sum=Math.round(s);
  const qError=Math.abs(col-q);
  const rError=Math.abs(row-r);
  const sError=Math.abs(sum-s);
  if(qError>rError&&qError>sError) col=-row-sum;
  else if(rError>sError) row=-col-sum;
  return [2*col+row,3*row];
}

export function hexKey(x:number,y:number) {
  return hexCentre(x,y).join(',');
}

function hexCorners(x:number,y:number):Point[] {
  const [cx,cy]=hexCentre(x,y);
  return corners.map(([dx,dy])=>[cx+dx,cy+dy]);
}

function toCoordinates(origin:Point,points:Point[]):LatLng[] {
  const longitudePerMetre=degreesPerMetre/Math.cos(origin[0]*Math.PI/180);
  return points.map(([x,y])=>({
    latitude:origin[0]-y*degreesPerMetre,
    longitude:origin[1]+x*longitudePerMetre,
  }));
}

export function projectTouch(origin:Point,{latitude,longitude}:LatLng):Point {
  return [
    (longitude-origin[1])*Math.cos(origin[0]*Math.PI/180)/degreesPerMetre,
    (origin[0]-latitude)/degreesPerMetre,
  ];
}

export function hexOutline(origin:Point,x:number,y:number) {
  return toCoordinates(origin,hexCorners(x,y).map(([u,v])=>[u*stepX,v*stepY]));
}

function contains(ring:Point[],[x,y]:Point) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [a,b]=ring[i];
    const [c,d]=ring[j];
    if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a) inside=!inside;
  }
  return inside;
}

export function hexFog(origin:Point,tiles:Point[]):Region[] {
  const edges=new Map<string,{a:Point;b:Point}>();
  const cells=new Set<string>();
  for(const [x,y] of tiles) {
    const key=hexKey(x,y);
    if(cells.has(key)) continue;
    cells.add(key);
    const points=hexCorners(x,y);
    for(let i=0;i<points.length;i++) {
      const a=points[i];
      const b=points[(i+1)%points.length];
      const reverse=`${b}:${a}`;
      if(!edges.delete(reverse)) edges.set(`${a}:${b}`,{a,b});
    }
  }

  // Remove shared borders before handing holes to the native map polygon renderer.
  const next=new Map([...edges.values()].map(({a,b})=>[a.join(','),b]));
  const rings:{ring:Point[]; area:number; parent?:number}[]=[];
  while(next.size) {
    const start=next.keys().next().value!;
    const ring:Point[]=[];
    let key=start;
    let area=0;
    do {
      const a=key.split(',').map(Number) as Point;
      const b=next.get(key)!;
      ring.push(a);
      area+=a[0]*b[1]-a[1]*b[0];
      next.delete(key);
      key=b.join(',');
    } while(key!==start);
    rings.push({ring,area});
  }

  rings.sort((a,b)=>Math.abs(a.area)-Math.abs(b.area));
  rings.forEach((ring,index)=>{
    const parent=rings.findIndex((candidate,i)=>i>index&&contains(candidate.ring,ring.ring[0]));
    if(parent>=0) ring.parent=parent;
  });
  const outline=(ring:Point[])=>toCoordinates(origin,ring.map(([u,v])=>[u*stepX,v*stepY]));
  const extent=100_000;
  const world=toCoordinates(origin,[[-extent,-extent],[extent,-extent],[extent,extent],[-extent,extent]]);
  const result:Region[]=[{
    coordinates:world,
    holes:rings.filter(r=>r.parent===undefined).map(r=>outline(r.ring)),
  }];
  rings.forEach((ring,index)=>{
    if(ring.area<0) result.push({
      coordinates:outline(ring.ring),
      holes:rings.filter(child=>child.parent===index).map(child=>outline(child.ring)),
    });
  });
  return result;
}

type Segment = [Point,Point];

function clipToCell([a,b]:Segment,corners:Point[]):Point|undefined {
  let entry=0;
  let exit=1;
  for(let i=0;i<corners.length;i++) {
    const [x,y]=corners[i];
    const [u,v]=corners[(i+1)%corners.length];
    const side=([p,q]:Point)=>(u-x)*(q-y)-(v-y)*(p-x);
    const start=side(a);
    const end=side(b);
    if(start<0&&end<0) return undefined;
    if(start<0) entry=Math.max(entry,start/(start-end));
    if(end<0) exit=Math.min(exit,start/(start-end));
    if(entry>=exit) return undefined;
  }
  return [entry,exit];
}

export function createHexClipper(origin:Point,discovered:Point[]) {
  const cells=discovered.map(([x,y])=>{
    const [u,v]=hexCentre(x,y);
    const cx=u*stepX;
    const cy=v*stepY;
    return {cx,cy,outline:hexCorners(x,y).map(([a,b]):Point=>[a*stepX,b*stepY])};
  });

  return (line:LatLng[]):LatLng[][]=>{
    const points=line.map(point=>projectTouch(origin,point));
    const visible:Point[][]=[];
    let continuing:Point[]|undefined;
    for(let i=1;i<points.length;i++) {
      const a=points[i-1];
      const b=points[i];
      const [left,right]=[Math.min(a[0],b[0]),Math.max(a[0],b[0])];
      const [top,bottom]=[Math.min(a[1],b[1]),Math.max(a[1],b[1])];
      const intervals:Point[]=[];
      for(const {cx,cy,outline} of cells) {
        if(cx+stepX<left||cx-stepX>right||cy+radius<top||cy-radius>bottom) continue;
        const interval=clipToCell([a,b],outline);
        if(interval) intervals.push(interval);
      }
      intervals.sort(([start],[next])=>start-next);
      const runs:Point[]=[];
      for(const interval of intervals) {
        const previous=runs.at(-1);
        if(previous && interval[0]<=previous[1]+1e-8) previous[1]=Math.max(previous[1],interval[1]);
        else runs.push(interval);
      }
      const at=(t:number):Point=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
      const prior=continuing;
      continuing=undefined;
      for(const [start,end] of runs) {
        const path=start<1e-8&&prior ? prior : [at(start)];
        path.push(at(end));
        if(path!==prior) visible.push(path);
        if(end>1-1e-8) continuing=path;
      }
    }
    return visible.map(path=>toCoordinates(origin,path));
  };
}

export function blockedHex(origin:Point,[i,j]:Point) {
  const a=(2*i+j)*stepX,b=3*j*stepY;
  return {
    key:hexKey(a,b),center:toCoordinates(origin,[[a,b]])[0],outline:hexOutline(origin,a,b),
    strike:toCoordinates(origin,[[a-7,b-7],[a+7,b+7]]),
    counterStrike:toCoordinates(origin,[[a-7,b+7],[a+7,b-7]]),
  };
}
