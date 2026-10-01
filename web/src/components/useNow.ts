import { useEffect, useState } from 'react';

/* Countdowns are computed in the browser. The first render uses the build
   time so server HTML and hydration agree; then the real clock takes over. */
export function useNow(builtAt: string): number {
  const [now, setNow] = useState(() => Date.parse(builtAt));
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/* Read ?q= so a search on the home page lands pre-filled. */
export function useQueryParam(name: string, initial = ''): [string, (v: string) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get(name);
    if (v) setValue(v);
  }, [name]);
  return [value, setValue];
}
