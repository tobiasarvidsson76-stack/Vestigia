import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

export const TRACKING_TASK = 'vestigia-active-walk';
export const WALK_STORAGE = 'vestigia.walk';
const SAMPLES = 'vestigia.samples';
export type Sample = {latitude: number; longitude: number; accuracy: number; at: number};
export type Walking = {session: string; started: number; background: boolean};
export type Queued = {session: string; sample: Sample};

let access: Promise<unknown> = Promise.resolve();
function serialized<T>(callback: () => Promise<T>): Promise<T> {
  const result = access.then(callback, callback);
  access = result.catch(() => undefined);
  return result;
}

export function sampleOf(fix: Location.LocationObject): Sample {
  return {
    latitude: fix.coords.latitude, longitude: fix.coords.longitude,
    accuracy: fix.coords.accuracy ?? -1, at: fix.timestamp / 1000,
  };
}

export function enqueue(session: string, fixes: Location.LocationObject[]) {
  return serialized(async () => {
    const saved: Queued[] = JSON.parse(await AsyncStorage.getItem(SAMPLES) ?? '[]');
    for (const fix of fixes) {
      const sample = sampleOf(fix);
      if (sample.accuracy >= 0 && sample.accuracy <= 30) saved.push({session, sample});
    }
    await AsyncStorage.setItem(SAMPLES, JSON.stringify(saved
      .filter(entry => entry.sample.at >= Date.now()/1000 - 86400)
      .sort((a,b) => a.sample.at-b.sample.at).slice(-7200)));
  });
}

export function queued(): Promise<Queued[]> {
  return serialized(async () => JSON.parse(await AsyncStorage.getItem(SAMPLES) ?? '[]'));
}

export function acknowledge(entries: Queued[]) {
  return serialized(async () => {
    const keys = new Set(entries.map(e => `${e.session}/${e.sample.at}`));
    const saved: Queued[] = JSON.parse(await AsyncStorage.getItem(SAMPLES) ?? '[]');
    await AsyncStorage.setItem(SAMPLES, JSON.stringify(saved.filter(
      e => !keys.has(`${e.session}/${e.sample.at}`))));
  });
}

export function clearWalk() {
  return serialized(() => AsyncStorage.multiRemove([WALK_STORAGE, SAMPLES]));
}

TaskManager.defineTask<{locations: Location.LocationObject[]}>(TRACKING_TASK, async ({data, error}) => {
  if (error || !data) return;
  const walking: Walking | null = JSON.parse(await AsyncStorage.getItem(WALK_STORAGE) ?? 'null');
  if (walking?.background) await enqueue(walking.session, data.locations);
});
