import { useMemo, useState } from 'react';
import { href } from '@/lib/utils';
import { SearchIcon } from '../Icons';

export interface SearchEntry {
  kind: 'Conference' | 'Grant' | 'Fellowship';
  name: string;
  sub: string;
  href: string;
  text: string;
}

/* The chat assistant is on the page only when its address is configured. */
const AI = Boolean(import.meta.env.PUBLIC_CHAT_URL);

/* A question for the assistant rather than a name to look up. */
const QUESTION = /\?\s*$|^(what|when|which|who|where|why|how|is|are|can|does|do|should|list|show|find|tell)\b/i;

const askAI = (q: string) => window.dispatchEvent(new CustomEvent('wr:ask', { detail: q }));

/* Two searches in one box: instant matches across conferences and funding,
   and "Ask White Rabbit", which hands the text to the chat assistant. Enter
   asks the assistant when the text reads as a question, opens the only match
   when there is one, and otherwise goes to the filtered conference list. */
export default function HomeSearch({ entries }: { entries: SearchEntry[] }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(-1);   // keyboard selection; -1 = none, 0 = the AI row when shown
  const query = q.trim();
  const question = AI && QUESTION.test(query);

  const hits = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const starts = (e: SearchEntry) => (e.name.toLowerCase().startsWith(words[0]) ? 0 : 1);
    return entries.filter((e) => words.every((w) => e.text.includes(w)))
      .sort((a, b) => starts(a) - starts(b)).slice(0, 8);
  }, [query, entries]);

  // rows in the dropdown: the AI row first when the assistant is on
  const rows = AI && query ? [null, ...hits] : hits;

  const go = (i: number) => {
    const row = rows[i];
    if (row === null) askAI(query);
    else if (row) window.location.href = row.href;
  };

  return (
    <form
      action={href('conferences/')}
      method="get"
      role="search"
      className="relative w-full max-w-2xl"
      onSubmit={(e) => {
        if (active >= 0) {
          e.preventDefault();
          go(active);
        } else if (question || (AI && query && hits.length === 0)) {
          e.preventDefault();
          askAI(query);
        } else if (hits.length && hits[0].kind !== 'Conference') {
          e.preventDefault();
          window.location.href = hits[0].href;
        }
      }}
    >
      <label className="sr-only" htmlFor="home-q">Search conferences, grants and fellowships, or ask a question</label>
      <SearchIcon className="pointer-events-none absolute top-[1.55rem] left-4 size-5 -translate-y-1/2 text-muted" />
      <input
        id="home-q"
        name="q"
        type="search"
        autoComplete="off"
        value={q}
        onChange={(e) => { setQ(e.target.value); setActive(-1); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
          if (e.key === 'Escape') { setQ(''); setActive(-1); }
        }}
        placeholder={AI ? 'Search a venue or grant, or ask a question…' : 'Search OSDI, NeurIPS, NSF CAREER, fellowships...'}
        className={`h-[3.1rem] w-full rounded-2xl border border-border bg-surface-1 pl-12 text-base text-fg shadow-card placeholder:text-muted ${AI ? 'pr-36 sm:pr-44' : 'pr-24'}`}
        aria-controls="home-hits"
        aria-activedescendant={active >= 0 ? `home-hit-${active}` : undefined}
      />
      <div className="absolute top-1.5 right-1.5 flex gap-1.5">
        {AI && (
          <button type="button" onClick={() => askAI(query)} title="Ask the White Rabbit assistant" aria-label="Ask AI"
            className="flex h-[2.35rem] cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-3 text-sm font-semibold text-fg hover:border-accent hover:text-accent">
            <span aria-hidden="true">✨</span><span className="hidden sm:inline">Ask AI</span>
          </button>
        )}
        <button type="submit" className="h-[2.35rem] cursor-pointer rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:brightness-110">
          Search
        </button>
      </div>
      {query && (
        <ul id="home-hits" role="listbox" className="card absolute inset-x-0 top-[3.5rem] z-20 max-h-96 overflow-y-auto p-1.5">
          {rows.map((h, i) => h === null ? (
            <li key="ai" id={`home-hit-${i}`} role="option" aria-selected={active === i}>
              <button type="button" onClick={() => askAI(query)}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-2 ${active === i ? 'bg-surface-2' : ''}`}>
                <span className="w-20 shrink-0 text-[0.7rem] font-semibold tracking-wide text-accent uppercase">✨ Ask AI</span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-fg">“{query}”</span>
                  <span className="block truncate text-xs text-muted">White Rabbit answers from its deadlines, grants and proceedings data</span>
                </span>
              </button>
            </li>
          ) : (
            <li key={h.href} id={`home-hit-${i}`} role="option" aria-selected={active === i}>
              <a href={h.href} className={`flex items-center gap-3 rounded-lg px-3 py-2 no-underline hover:bg-surface-2 ${active === i ? 'bg-surface-2' : ''}`}>
                <span className="w-20 shrink-0 text-[0.7rem] font-semibold tracking-wide text-muted uppercase">{h.kind}</span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-fg">{h.name}</span>
                  {h.sub && <span className="block truncate text-xs text-muted">{h.sub}</span>}
                </span>
              </a>
            </li>
          ))}
          {hits.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted">
              No direct matches.{AI ? ' Press Enter to ask White Rabbit.' : ' Press Enter to search conferences.'}
            </li>
          )}
        </ul>
      )}
    </form>
  );
}
