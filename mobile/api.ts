import AsyncStorage from '@react-native-async-storage/async-storage';

export const API = process.env.EXPO_PUBLIC_VESTIGIA_API?.replace(/\/$/, '') ?? '';
export const TOKEN = 'vestigia.token';
export const REFRESH = 'vestigia.refresh';
let renewal: Promise<string|null>|undefined;

async function refreshToken() {
  const refresh = await AsyncStorage.getItem(REFRESH);
  if (!refresh) return null;
  const response = await fetch(API+'/api/refresh', {method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({refresh_token:refresh})});
  if(response.status===401) {
    await AsyncStorage.multiRemove([TOKEN,REFRESH]);
    return null;
  }
  if(!response.ok) throw new RequestError('Sign-in provider is temporarily unavailable', response.status);
  const ticket: {token:string;refresh_token:string} = await readResponse(response);
  await AsyncStorage.multiSet([[TOKEN,ticket.token],[REFRESH,ticket.refresh_token]]);
  return ticket.token;
}

export type Action = {op: string; [key: string]: unknown};

export function nonce() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function readResponse(response: Response) {
  const body = await response.text();
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new RequestError(
      `Vestigia server returned ${body.trim() ? 'an unreadable' : 'an empty'} response (HTTP ${response.status}).`,
      response.status,
    );
  }
  if (!response.ok) throw new RequestError(result?.error ?? 'Server request failed', response.status);
  return result;
}

export async function request<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
  if (!API) throw new Error('Set EXPO_PUBLIC_VESTIGIA_API to your Vestigia server URL.');
  const headers: Record<string,string> = {'Content-Type':'application/json'};
  const token = await AsyncStorage.getItem(TOKEN);
  if (token) headers.Authorization = 'Bearer '+token;
  if (key) headers['Idempotency-Key'] = key;
  const options={method, headers, body: body ? JSON.stringify(body) : undefined};
  let response = await fetch(API+'/api/'+path, options);
  if(response.status===401 && token && path!=='login') {
    const current=await AsyncStorage.getItem(TOKEN);
    if(current && current!==token) headers.Authorization='Bearer '+current;
    else {
      renewal??=refreshToken().finally(()=>{renewal=undefined;});
      const renewed=await renewal;
      if(!renewed) throw new RequestError('Sign in to Vestigia first',401);
      headers.Authorization='Bearer '+renewed;
    }
    response=await fetch(API+'/api/'+path,options);
  }
  return readResponse(response) as Promise<T>;
}
