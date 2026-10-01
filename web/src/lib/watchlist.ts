/* "My venues": the venues and grants a visitor has starred, kept in this
   browser only. No account, nothing sent anywhere.

   Keys look like "venue:fast" or "grant:<id>". Every island on the page reads
   the same store, so starring on a row updates the home strip, the toggle
   counts and other tabs at once. Storage can be blocked (private windows,
   strict settings); then the list simply lives for the visit. */

import { useSyncExternalStore } from 'react';

const KEY = 'wr-watch';
const EVENT = 'wr:watch';
let memory: string[] = [];   // fallback when localStorage is unavailable
let cached: { raw: string | null; list: string[] } = { raw: null, list: [] };

export const venueKey = (id: string) => `venue:${id}`;
export const grantKey = (id: string) => `grant:${id}`;

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === cached.raw) return cached.list;
    const parsed = raw ? JSON.parse(raw) : [];
    cached = { raw, list: Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [] };
    return cached.list;
  } catch {
    return memory;
  }
}

function write(list: string[]) {
  memory = list;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: keep it in memory for this visit */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function toggleWatch(key: string) {
  const list = read();
  write(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) onChange(); };
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onStorage);   // other tabs
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

const EMPTY: string[] = [];

/* The starred keys. Empty during server render and the first client render,
   so hydration matches; the real list arrives right after. */
export function useWatchlist(): string[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
