import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';
import {useEffect,useRef,useState} from 'react';
import {AppState,Platform,View} from 'react-native';
import {Button, Text} from './GameUI';
import {request} from './api';

type Purchase = {id:string;product:string;receipt:string};
type Store = {
  price(product:string):Promise<string>;
  buy(product:string,account:string):Promise<void>;
  unfinished(product:string):Promise<Purchase[]>;
  finish(id:string):Promise<void>;
  addListener(event:'onPurchase',callback:(purchase:Purchase)=>void):EventSubscription;
  addListener(event:'onStoreError',callback:(error:{message:string})=>void):EventSubscription;
};
type StoreConfig = {product:string;account:string;apple:boolean;google:boolean};
const store=requireOptionalNativeModule<Store>('VestigiaVoucherStore');
const platform=Platform.OS==='ios'?'apple':'google';

export default function VoucherStore<T>({changed,visible}:{changed:(value:T)=>void;visible:boolean}) {
  const [config,setConfig]=useState<StoreConfig>();
  const [price,setPrice]=useState('');
  const [message,setMessage]=useState('');
  const [buying,setBuying]=useState(false);
  const redeeming=useRef(new Set<string>());

  useEffect(()=>{
    if(!store) return;
    let mounted=true;
    void request<StoreConfig>('billing/config').then(result=>{
      if(mounted && result[platform]) setConfig(result);
    }).catch(()=>undefined);
    return ()=>{mounted=false;};
  },[]);

  useEffect(()=>{
    if(!store||!config) return;
    const native=store;
    const product=config.product;
    let mounted=true;
    const report=(text:string)=>{if(mounted)setMessage(text);};
    const redeem=async (purchase:Purchase)=>{
      if(purchase.product!==product||redeeming.current.has(purchase.id)) return;
      redeeming.current.add(purchase.id);
      try {
        const city=await request<T>('billing/redeem','POST',{platform,receipt:purchase.receipt});
        await native.finish(purchase.id);
        if(mounted) changed(city);
        report('Voucher purchase confirmed.');
      } catch(cause) {
        report(cause instanceof Error?cause.message:'Purchase will retry after reconnecting.');
      } finally {redeeming.current.delete(purchase.id);}
    };
    const recover=()=>void native.unfinished(product)
      .then(purchases=>Promise.all(purchases.map(redeem)))
      .catch(()=>report('Could not check unfinished purchases.'));
    const event=native.addListener('onPurchase',purchase=>void redeem(purchase));
    const errors=native.addListener('onStoreError',error=>report(error.message));
    const app=AppState.addEventListener('change',state=>{if(state==='active')recover();});
    const retry=setInterval(()=>{if(AppState.currentState==='active')recover();},20000);
    void native.price(product).then(value=>{if(mounted)setPrice(value);})
      .catch(()=>report('The voucher pack is unavailable in this store.'));
    recover();
    return ()=>{mounted=false;event.remove();errors.remove();app.remove();clearInterval(retry);};
  },[config,changed]);

  if(!store||!config||!visible) return null;
  return <View>
    {!!price&&<Button title={`Buy five haul vouchers · ${price}`} disabled={buying} onPress={()=>{
      setBuying(true);
      void store.buy(config.product,config.account).catch(cause=>setMessage(cause.message))
        .finally(()=>setBuying(false));
    }}/>}
    {!!message&&<Text accessibilityLiveRegion="polite">{message}</Text>}
  </View>;
}
