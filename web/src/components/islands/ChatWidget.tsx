/* "Ask White Rabbit": a chat panel behind a floating avatar button. Answers
   stream from the chat Worker (chat/ in this repository), which reads only a
   snapshot of the site's public data. The conversation lives in this tab
   (sessionStorage); the Worker keeps an anonymous log of questions. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FACETS, VIEWBOX } from '@/lib/brand';

const ENDPOINT = import.meta.env.PUBLIC_CHAT_URL as string | undefined;
const SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY as string | undefined;
const STORE = 'wr-chat';
const SUGGESTIONS = [
  'Systems deadlines in the next 6 weeks',
  'Is the OSDI deadline verified?',
  'PhD fellowships closing soon',
  "What is NSDI's acceptance rate?",
];

interface Message { role: 'user' | 'assistant'; content: string; id?: number; rated?: 1 | -1; error?: boolean }

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, o: Record<string, unknown>): string;
      getResponse(id: string): string | undefined;
      reset(id: string): void;
    };
  }
}

// FACETS[0] and [1] are the ears (they twitch); every facet gets its index for the shimmer
const facetClass = (i: number) => `wr-facet wr-facet-${i}${i === 0 ? ' wr-ear-l' : i === 1 ? ' wr-ear-r' : ''}`;

function Mark({ className = 'size-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox={VIEWBOX} aria-hidden="true">
      {FACETS.map(([pts, t], i) => (
        <polygon key={i} points={pts.join(',')} className={facetClass(i)} style={{ fill: `var(--mark-${t})`, stroke: `var(--mark-${t})` }}
          strokeWidth=".7" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/* The answer's markdown subset as React elements: links, bold and bullets.
   Never HTML, so nothing in an answer can run in the page. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1]
      ? <a key={m.index} href={m[2]} className="font-semibold text-accent hover:underline">{m[1]}</a>
      : <strong key={m.index}>{m[3]}</strong>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Answer({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`} className="my-1 list-disc space-y-0.5 pl-4">{list}</ul>);
    list = [];
  };
  text.split('\n').forEach((line, i) => {
    const bullet = /^\s*[-*•]\s+(.*)/.exec(line);
    if (bullet) list.push(<li key={i}>{inline(bullet[1])}</li>);
    else {
      flush();
      if (line.trim()) blocks.push(<p key={i} className="my-1">{inline(line)}</p>);
    }
  });
  flush();
  return <>{blocks}</>;
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORE);
      if (saved) setMessages(JSON.parse(saved));
    } catch { /* storage blocked: start empty */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-30))); } catch { /* ignore */ }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // the bot check, only when a site key is configured
  useEffect(() => {
    if (!open || !SITE_KEY || widgetId.current) return;
    const render = () => {
      if (window.turnstile && turnstileRef.current && !widgetId.current) {
        widgetId.current = window.turnstile.render(turnstileRef.current, { sitekey: SITE_KEY, appearance: 'interaction-only' });
      }
    };
    if (window.turnstile) render();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
  }, [open]);

  // other parts of the page (the home search) can hand over a question
  const askRef = useRef<((q: string) => void) | null>(null);
  useEffect(() => {
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      setOpen(true);
      if (q) askRef.current?.(q);
    };
    window.addEventListener('wr:ask', onAsk);
    return () => window.removeEventListener('wr:ask', onAsk);
  }, []);

  if (!ENDPOINT) return null;

  const update = (fn: (last: Message) => Message) =>
    setMessages((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history = messages.filter((m) => !m.error).slice(-4).map(({ role, content }) => ({ role, content }));
    setMessages((ms) => [...ms, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    try {
      const token = widgetId.current && window.turnstile ? window.turnstile.getResponse(widgetId.current) : undefined;
      const res = await fetch(`${ENDPOINT}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, page: location.pathname, history, turnstile: token }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'The assistant is unavailable right now.');
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const ev of events) {
          if (!ev.startsWith('data:')) continue;
          const data = JSON.parse(ev.slice(5)) as { t?: string; done?: boolean; id?: number; error?: string };
          if (data.t) update((m) => ({ ...m, content: m.content + data.t }));
          if (data.done) update((m) => ({ ...m, id: data.id }));
          if (data.error) throw new Error(data.error);
        }
      }
    } catch (e) {
      update((m) => ({ ...m, content: (e as Error).message, error: true }));
    } finally {
      setBusy(false);
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    }
  }

  askRef.current = ask;

  async function rate(i: number, value: 1 | -1) {
    const m = messages[i];
    if (!m.id || m.rated) return;
    setMessages((ms) => ms.map((x, j) => (j === i ? { ...x, rated: value } : x)));
    fetch(`${ENDPOINT}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id, value }) }).catch(() => {});
  }

  return (
    <>
      {open && (
        <section role="dialog" aria-label="Ask White Rabbit"
          className="fixed right-3 bottom-32 z-50 flex max-h-[min(36rem,calc(100dvh-7rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-card sm:right-5">
          <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-2"><Mark className="size-6" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Ask White Rabbit</p>
              <p className="truncate text-xs text-muted">Deadlines, grants, fellowships and proceedings</p>
            </div>
            {messages.length > 0 && (
              <button type="button" onClick={() => setMessages([])} className="cursor-pointer rounded-md px-2 py-1 text-xs text-muted hover:text-fg">
                Clear
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="cursor-pointer rounded-md px-2 py-1 text-lg leading-none text-muted hover:text-fg">×</button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-fg-2">Hi! Ask me when a deadline is, whether it is verified, or which grants and fellowships fit you.</p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => ask(s)}
                      className="cursor-pointer rounded-full border border-border bg-surface-2 px-2.5 py-1 text-left text-xs font-semibold text-fg-2 hover:border-accent hover:text-accent">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => m.role === 'user' ? (
              <p key={i} className="ml-8 rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-white">{m.content}</p>
            ) : (
              <div key={i} className="mr-4 flex gap-2">
                <Mark className="mt-1 size-5 shrink-0" />
                <div className="min-w-0">
                  <div className={m.error ? 'text-critical' : 'text-fg'}>
                    {m.content ? <Answer text={m.content} /> : <span className="inline-flex gap-1 py-1 text-muted">thinking…</span>}
                  </div>
                  {m.id && (
                    <div className="mt-1 flex gap-1 text-xs text-muted">
                      {m.rated ? <span>Thanks for the feedback.</span> : <>
                        <button type="button" onClick={() => rate(i, 1)} aria-label="Helpful" className="cursor-pointer rounded px-1 hover:bg-surface-2">👍</button>
                        <button type="button" onClick={() => rate(i, -1)} aria-label="Not helpful" className="cursor-pointer rounded px-1 hover:bg-surface-2">👎</button>
                      </>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <form className="border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <div ref={turnstileRef} />
            <div className="flex items-end gap-2">
              <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={500}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}
                placeholder="Ask about a deadline…" aria-label="Your question"
                className="max-h-28 min-h-9 flex-1 resize-none rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent" />
              <button type="submit" disabled={busy || !input.trim()}
                className="h-9 cursor-pointer rounded-xl bg-accent px-3 text-sm font-semibold text-white disabled:cursor-default disabled:opacity-50">
                Ask
              </button>
            </div>
            <p className="mt-2 text-[0.68rem] leading-snug text-muted">
              Answers come from White Rabbit's data and can be wrong, so check the official page. Questions are stored
              anonymously to improve the site; please don't include personal details.
            </p>
          </form>
        </section>
      )}

      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        aria-label={open ? 'Close the White Rabbit assistant' : 'Ask White Rabbit'} title={open ? 'Close' : 'Ask White Rabbit'}
        className={`wr-chat-fab group fixed right-2 bottom-2 z-50 grid h-28 w-24 cursor-pointer place-items-center bg-transparent transition hover:scale-110 sm:right-4 sm:bottom-4 ${open ? 'is-open' : ''}`}>
        <span className="wr-chat-halo" aria-hidden="true" />
        <Mark className="wr-chat-mark h-[5.75rem] w-auto" />
        {open && <span aria-hidden="true" className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-fg text-[0.7rem] leading-none text-surface-1">×</span>}
        {!open && (
          <span className="pointer-events-none absolute right-[calc(100%+0.6rem)] rounded-lg bg-fg px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-surface-1 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            Ask White Rabbit
          </span>
        )}
      </button>
    </>
  );
}
