import { beforeEach, describe, expect, it, vi } from 'vitest';

/* watchlist.ts keeps module state, so each test loads a fresh copy against a
   fresh fake window. */
function fakeWindow(storage: Partial<Storage> | null) {
  const target = new EventTarget();
  vi.stubGlobal('window', {
    localStorage: storage,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  });
  return target;
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('toggleWatch', () => {
  it('stars and unstars, persisting to localStorage and announcing the change', async () => {
    const storage = memoryStorage();
    const target = fakeWindow(storage);
    let events = 0;
    target.addEventListener('wr:watch', () => events++);
    const { toggleWatch, venueKey } = await import('./watchlist');

    toggleWatch(venueKey('fast'));
    expect(JSON.parse(storage.data.get('wr-watch')!)).toEqual(['venue:fast']);
    toggleWatch(venueKey('fast'));
    expect(JSON.parse(storage.data.get('wr-watch')!)).toEqual([]);
    expect(events).toBe(2);
  });

  it('ignores junk in storage', async () => {
    const storage = memoryStorage();
    storage.data.set('wr-watch', '{"not":"a list"}');
    fakeWindow(storage);
    const { toggleWatch, grantKey } = await import('./watchlist');
    toggleWatch(grantKey('g1'));
    expect(JSON.parse(storage.data.get('wr-watch')!)).toEqual(['grant:g1']);
  });

  it('keeps the list in memory for the visit when storage is blocked', async () => {
    const blocked = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    fakeWindow(blocked);
    const { toggleWatch } = await import('./watchlist');
    expect(() => toggleWatch('venue:osdi')).not.toThrow();
    expect(() => toggleWatch('venue:nsdi')).not.toThrow();
  });
});
