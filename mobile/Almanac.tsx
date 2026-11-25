import React, {useMemo, useState} from 'react';
import {FlatList, Pressable, ScrollView, SectionList, StyleSheet, TextInput, View} from 'react-native';
import {palette, Text} from './GameUI';
import {durationLabel} from './TaskProgress';

const categories=['Goods','Crops','Recipes','Buildings'] as const;
type Category = typeof categories[number];
export type AlmanacEntry = {category:Category; key:string; title:string};
type Recipe = {site:string; inputs:[number,string[]][]; outputs:[number,string][]; seconds:number; tech:string};
type Crop = {plot:string;soil:string;seconds:number;tech:string};
type Building = {
  description:string; placement:string; build_cost:[number,string[]][]; construction_seconds:number|null;
  lead:number|null; inputs:string|null; shared:number; coverage:string|null; market_note:string|null;
};
type Catalog = {
  prices:Record<string,number>;
  crops:Record<string,Crop>;
  recipes:Record<string,Recipe>;
  sites:Record<string,{plot:string|null}>;
  building_details:Record<string,Building>;
  consumers?:Record<string,[string,string,number]>;
};
type Row = AlmanacEntry & {subtitle:string;search:string};

const capitalize=(name:string)=>name.charAt(0).toUpperCase()+name.slice(1);
const outputs=(recipe:Recipe)=>recipe.outputs.map(([quantity,good])=>`${quantity} ${good}`).join(' + ');
const ingredients=(recipe:Recipe)=>recipe.inputs.map(([quantity,names])=>`${quantity} ${names.join(' or ')}`).join(' + ');
const ingredientMatches=(ingredient:string,good:string)=>ingredient===good||
  (['log','plank'].includes(ingredient)&&good.endsWith(' '+ingredient));

function EntryRow({title,subtitle,onPress}:{title:string;subtitle?:string;onPress:()=>void}) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({pressed})=>[styles.row,pressed&&styles.pressed]}>
    <View style={styles.rowCopy}>
      <Text style={styles.rowTitle}>{title}</Text>
      {!!subtitle&&<Text style={styles.secondary}>{subtitle}</Text>}
    </View>
    <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">›</Text>
  </Pressable>;
}

export default function Almanac({catalog,technologies,entry,onOpen,buildingGroup}:{
  catalog:Catalog;technologies:string[];entry?:AlmanacEntry;onOpen:(entry:AlmanacEntry)=>void;
  buildingGroup:(kind:string,plot?:string|null)=>string;
}) {
  const [category,setCategory]=useState<Category>('Goods');
  const [query,setQuery]=useState('');
  const rows=useMemo(()=>{
    const goods=Object.entries(catalog.prices).map(([key,price]):Row=>({
      category:'Goods',key,title:capitalize(key),
      subtitle:`${price} ${price===1?'coin':'coins'} · Base sale value`,
      search:`${key} ${catalog.consumers?.[key]?.slice(0,2).join(' ')??''}`,
    }));
    const crops=Object.entries(catalog.crops).map(([key,crop]):Row=>({
      category:'Crops',key,title:capitalize(key),subtitle:`${capitalize(crop.plot)} · ${durationLabel(crop.seconds)}`,
      search:`${key} ${crop.plot} ${crop.soil} ${crop.tech}`,
    }));
    const recipes=Object.entries(catalog.recipes).map(([key,recipe]):Row=>({
      category:'Recipes',key,title:capitalize(recipe.outputs.map(([,good])=>good).join(' + ')),
      subtitle:`${capitalize(recipe.site)} · ${ingredients(recipe)||'Tile resources'}`,
      search:`${key} ${recipe.tech} ${ingredients(recipe)} ${outputs(recipe)}`,
    }));
    const buildings=Object.entries(catalog.building_details).map(([key,details]):Row=>{
      const group=buildingGroup(key,catalog.sites[key]?.plot);
      return {category:'Buildings',key,title:capitalize(key),subtitle:group,
        search:`${key} ${group} ${details.description}`};
    });
    const alphabetical=(a:Row,b:Row)=>a.title.localeCompare(b.title)||a.key.localeCompare(b.key);
    return {Goods:goods.sort(alphabetical),Crops:crops.sort(alphabetical),Recipes:recipes.sort(alphabetical),
      Buildings:buildings.sort(alphabetical)};
  },[catalog,buildingGroup]);
  const searchWords=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches=rows[category].filter(row=>searchWords.every(word=>row.search.toLowerCase().includes(word)));
  const techStatus=(name:string)=>technologies.includes(name)?name:`${name} required`;
  const openBuilding=(key:string)=>onOpen({category:'Buildings',key,title:capitalize(key)});

  if(entry) {
    const {key}=entry;
    const crop=catalog.crops[key];
    const recipe=catalog.recipes[key];
    const consumer=catalog.consumers?.[key];
    const building=catalog.building_details[key];
    const usedIn=entry.category==='Goods'?rows.Recipes.filter(row=>
      catalog.recipes[row.key].inputs.some(([,goods])=>goods.some(good=>ingredientMatches(good,key)))):[];
    const producedBy=entry.category==='Goods'?rows.Recipes.filter(row=>
      catalog.recipes[row.key].outputs.some(([,good])=>good===key)):[];
    const producers=[...new Set(producedBy.map(row=>catalog.recipes[row.key].site))];
    return <ScrollView key={`${entry.category}/${key}`} contentContainerStyle={styles.content}>
      {entry.category==='Goods'&&<>
        <View style={styles.card}>
          <Text style={styles.heading}>{catalog.prices[key]} {catalog.prices[key]===1?'coin':'coins'} per unit</Text>
          <Text style={styles.secondary}>Base sale value</Text>
          {consumer&&<Text>Household {consumer[0]} · {consumer[2]} uses per unit</Text>}
        </View>
        {(crop||producedBy.length>0)&&<View style={styles.section}>
          <Text style={styles.heading}>How to get it</Text>
          {crop&&<EntryRow title={`Grow on a ${crop.plot}`} subtitle={techStatus(crop.tech)}
            onPress={()=>onOpen({category:'Crops',key,title:capitalize(key)})}/>}
          {producers.map(site=><EntryRow key={site} title={capitalize(site)} onPress={()=>openBuilding(site)}/>)}
        </View>}
        {usedIn.length>0&&<View style={styles.section}>
          <Text style={styles.heading}>Used to make</Text>
          {usedIn.map(row=><EntryRow key={row.key} title={row.title} subtitle={capitalize(catalog.recipes[row.key].site)}
            onPress={()=>onOpen(row)}/>)}
        </View>}
      </>}
      {entry.category==='Crops'&&crop&&<View style={styles.card}>
        <EntryRow title={capitalize(crop.plot)} subtitle="Growing site" onPress={()=>openBuilding(crop.plot)}/>
        <Text>Preferred soil · {crop.soil}</Text>
        <Text>Base grow time · {durationLabel(crop.seconds)}</Text>
        <Text>Research · {techStatus(crop.tech)}</Text>
      </View>}
      {entry.category==='Recipes'&&recipe&&<>
        <View style={styles.card}>
          <EntryRow title={capitalize(recipe.site)} subtitle="Production building" onPress={()=>openBuilding(recipe.site)}/>
          <Text>{durationLabel(recipe.seconds)} per batch · {techStatus(recipe.tech)}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>Ingredients</Text>
          {recipe.inputs.length>0?recipe.inputs.map(([quantity,names],i)=>
            <Text key={i}>{quantity} × {names.join(' or ')}</Text>):<Text>Resources from the tile</Text>}
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>Produces</Text>
          {recipe.outputs.map(([quantity,good])=>good in catalog.prices
            ? <EntryRow key={good} title={capitalize(good)} subtitle={`${quantity} per batch`}
              onPress={()=>onOpen({category:'Goods',key:good,title:capitalize(good)})}/>
            : <Text key={good}>{quantity} × {good}</Text>)}
        </View>
      </>}
      {entry.category==='Buildings'&&building&&<>
        <View style={styles.card}>
          <Text>{building.description}</Text>
          {!!building.coverage&&<Text>{building.coverage}</Text>}
          {building.lead!==null&&<Text>Staffing · One resident with education level {building.lead}+</Text>}
          {building.shared>0&&<Text>Storage · {building.shared} units at level 1</Text>}
          {!!building.inputs&&<Text>{building.inputs}</Text>}
          {!!building.market_note&&<Text>{building.market_note}</Text>}
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>Placement & construction</Text>
          <Text>{building.placement}</Text>
          {building.build_cost?.length>0&&<Text>Materials · {building.build_cost.map(([qty,goods])=>
            `${qty} ${goods.join(' or ')}`).join(' + ')}</Text>}
          {building.construction_seconds!==null&&<Text>Build time · {durationLabel(building.construction_seconds)}</Text>}
          {['lumberjack station','sawmill'].includes(key)&&<Text>A starter grant covers the first build.</Text>}
        </View>
        {rows.Recipes.some(row=>catalog.recipes[row.key].site===key)&&<View style={styles.section}>
          <Text style={styles.heading}>Production</Text>
          {rows.Recipes.filter(row=>catalog.recipes[row.key].site===key).map(row=>
            <EntryRow key={row.key} title={outputs(catalog.recipes[row.key])}
              subtitle={techStatus(catalog.recipes[row.key].tech)} onPress={()=>onOpen(row)}/>)}
        </View>}
        {rows.Crops.some(row=>catalog.crops[row.key].plot===key)&&<View style={styles.section}>
          <Text style={styles.heading}>Crops grown here</Text>
          {rows.Crops.filter(row=>catalog.crops[row.key].plot===key).map(row=>
            <EntryRow key={row.key} title={row.title} subtitle={techStatus(catalog.crops[row.key].tech)}
              onPress={()=>onOpen(row)}/>)}
        </View>}
      </>}
    </ScrollView>;
  }

  const groups=new Map<string,Row[]>();
  if(category==='Buildings') {
    for(const row of matches) {
      const group=groups.get(row.subtitle)??[];
      group.push(row);
      groups.set(row.subtitle,group);
    }
  }
  const renderRow=({item}:{item:Row})=><EntryRow title={item.title}
    subtitle={item.category==='Buildings'?undefined:item.subtitle} onPress={()=>onOpen(item)}/>;
  const noMatches=<Text style={styles.secondary}>No {category.toLowerCase()} match your search.</Text>;
  return <View style={styles.browser}>
    <View style={styles.filters}>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {categories.map(name=><Pressable key={name} accessibilityRole="tab" accessibilityState={{selected:name===category}}
          onPress={()=>setCategory(name)} style={[styles.tab,name===category&&styles.selected]}>
          <Text style={name===category?styles.tabSelected:styles.secondary}>{name}</Text>
        </Pressable>)}
      </View>
      <TextInput accessibilityLabel={`Search ${category.toLowerCase()}`} placeholder={`Search ${category.toLowerCase()}`}
        value={query} onChangeText={setQuery} placeholderTextColor={palette.muted} style={styles.search}
        autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing"/>
    </View>
    {category==='Buildings'
      ? <SectionList sections={[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([title,data])=>({title,data}))}
        stickySectionHeadersEnabled={false} keyExtractor={row=>row.key} keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list} renderItem={renderRow} ListEmptyComponent={noMatches}
        renderSectionHeader={({section})=><Text style={styles.groupHeading}>{section.title}</Text>}/>
      : <FlatList key={category} data={matches} keyExtractor={row=>row.key} keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list} renderItem={renderRow} ListEmptyComponent={noMatches}/>}
  </View>;
}

const styles=StyleSheet.create({
  browser:{flex:1},
  filters:{paddingHorizontal:12,paddingTop:12,paddingBottom:8,gap:10},
  tabs:{flexDirection:'row',gap:4,borderRadius:10,padding:4,backgroundColor:palette.shadow},
  tab:{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:7},
  selected:{backgroundColor:palette.raised},
  tabSelected:{fontWeight:'700',color:palette.brass},
  search:{minHeight:46,borderWidth:1,borderColor:palette.line,borderRadius:9,paddingHorizontal:12,color:palette.silk},
  list:{paddingHorizontal:12,paddingBottom:18},
  content:{padding:12,gap:12},
  section:{gap:4},
  card:{backgroundColor:palette.panel,borderColor:palette.line,borderWidth:1,borderRadius:12,padding:14,gap:6},
  heading:{fontSize:17,fontWeight:'700',color:palette.brass},
  groupHeading:{fontSize:15,fontWeight:'700',color:palette.brass,marginTop:14,marginBottom:5},
  row:{flexDirection:'row',alignItems:'center',minHeight:55,paddingHorizontal:10,paddingVertical:8,gap:10,
    borderBottomWidth:StyleSheet.hairlineWidth,borderColor:palette.line},
  pressed:{backgroundColor:palette.raised},
  rowCopy:{flex:1,gap:3},
  rowTitle:{fontWeight:'700'},
  secondary:{fontSize:13,color:palette.muted},
  chevron:{fontSize:23,color:palette.brass},
});
