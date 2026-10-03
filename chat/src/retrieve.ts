/* Finds the records a question is about, so the model answers from them and
   not from memory. Plain matching, no embeddings: venue acronyms and names,
   funders, research areas, months and "next N weeks", and whether the
   question is about grants, fellowships or conferences. */

export type Deadline = [name: string, iso: string, verified: boolean];

export interface Venue {
  id: string; name: string; full: string; area: string; topics: string[]; publisher: string;
  edition: number | null; rolling: boolean; deadlines: Deadline[]; page: string; official: string;
  papers?: { year: number; count: number };
  acceptance?: { year: number; rate: number; kind: string };
}

export interface Grant {
  id: string; name: string; funder: string; kind: 'grant' | 'fellowship'; eligibility: string;
  amount: string; topics: string[]; window: string; deadlines: Deadline[]; page: string; official: string;
}

export interface Knowledge { built: string; venues: Venue[]; grants: Grant[] }

export interface Hit { kind: 'venue' | 'grant'; rec: Venue | Grant; score: number; next: number | null }

const DAY = 86400000;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december'];
const AREA_WORDS: Record<string, string[]> = {
  'Machine learning': ['ml', 'machine learning', 'deep learning', 'neurips', 'learning'],
  'AI and robotics': ['ai', 'artificial intelligence', 'robotics', 'robot'],
  'Computer vision': ['vision', 'cv', 'computer vision', 'image'],
  Language: ['nlp', 'language', 'linguistics', 'llm'],
  Systems: ['systems', 'operating systems', 'os', 'storage', 'cloud', 'distributed', 'hpc', 'architecture'],
  Networking: ['networking', 'networks', 'network'],
  Security: ['security', 'privacy', 'crypto', 'cryptography'],
  'Data and databases': ['databases', 'database', 'data management', 'data mining', 'data'],
  'Software engineering and PL': ['software engineering', 'software', 'programming languages', 'pl', 'compilers'],
  HCI: ['hci', 'human-computer', 'human computer', 'interaction', 'chi'],
  'Graphics and multimedia': ['graphics', 'multimedia', 'visualization', 'siggraph'],
  Theory: ['theory', 'algorithms', 'complexity'],
};
const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'what', 'when', 'which', 'for', 'of', 'in', 'on', 'to', 'and',
  'or', 'me', 'my', 'i', 'do', 'does', 'deadline', 'deadlines', 'conference', 'conferences', 'how', 'can', 'there',
  'any', 'with', 'about', 'next', 'upcoming', 'this', 'that', 'it', 'its', 'by', 'at', 'be', 'due', 'date', 'dates',
  'show', 'list', 'tell', 'give', 'find', 'please', 'year', 'month', 'week', 'weeks', 'days', 'day', 'months']);

const words = (s: string) => s.toLowerCase().match(/[a-z0-9][a-z0-9+\-.]*/g) ?? [];
const has = (text: string, phrase: string) => new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(text);

export interface Intent {
  from: number; to: number | null;       // a time window, when the question names one
  areas: string[];
  wants: 'venue' | 'grant' | 'fellowship' | 'any';
  verifiedOnly: boolean;
}

export function intent(question: string, now: number): Intent {
  const q = question.toLowerCase();
  let from = now;
  let to: number | null = null;
  const n = q.match(/(?:next|in the next|within|coming)\s+(\d+|a|one|two|three|four|six)\s+(day|week|month)s?/);
  if (n) {
    const count = ({ a: 1, one: 1, two: 2, three: 3, four: 4, six: 6 } as Record<string, number>)[n[1]] ?? Number(n[1]);
    to = now + count * ({ day: 1, week: 7, month: 30 } as Record<string, number>)[n[2]] * DAY;
  } else if (/this week/.test(q)) to = now + 7 * DAY;
  else if (/this month/.test(q)) to = now + 31 * DAY;
  else if (/\b(soon|upcoming|coming up)\b/.test(q)) to = now + 45 * DAY;
  // "may" is usually the verb, so it counts as the month only next to a date word
  const month = MONTHS.findIndex((m) => m === 'may'
    ? /\b(in|during|by|before|until|early|late|mid)\s+may\b|\bmay\s+\d/.test(q)
    : has(q, m) || has(q, m.slice(0, 3)));
  if (month >= 0 && !n) {
    const d = new Date(now);
    let year = d.getUTCFullYear();
    if (month < d.getUTCMonth()) year += 1;
    from = Date.UTC(year, month, 1);
    to = Date.UTC(year, month + 1, 1);
  }
  const areas = Object.entries(AREA_WORDS).filter(([, ws]) => ws.some((w) => has(q, w))).map(([a]) => a);
  const wants = /\bfellowships?\b|\bphd student|\bstipend/.test(q) ? 'fellowship'
    : /\bgrants?\b|\bfunding\b|\bnsf\b|\bnih\b|\bdoe\b|\bdarpa\b|\bcareer award\b/.test(q) ? 'grant'
      : /\b(conference|venue|cfp|paper|submission|acceptance|proceedings)\b/.test(q) ? 'venue' : 'any';
  return { from, to, areas, wants, verifiedOnly: /\bverified\b|\bconfirmed\b/.test(q) };
}

/* The next deadline at or after `from` (and before `to`, when given). */
function nextIn(deadlines: Deadline[], from: number, to: number | null, verifiedOnly: boolean): number | null {
  const times = deadlines.filter((d) => !verifiedOnly || d[2]).map((d) => Date.parse(d[1]))
    .filter((t) => t >= from && (to === null || t < to));
  return times.length ? Math.min(...times) : null;
}

export function retrieve(k: Knowledge, question: string, now = Date.now(), limit = 18): { hits: Hit[]; intent: Intent } {
  const it = intent(question, now);
  const q = question.toLowerCase();
  const areaWords = new Set(it.areas.flatMap((a) => AREA_WORDS[a]).flatMap(words));
  const qw = new Set(words(q).filter((w) => !STOP.has(w) && w.length > 1 && !areaWords.has(w)));
  const hits: Hit[] = [];

  const squashed = q.replace(/[-\s]/g, '');
  const named = (name: string, full: string) => {
    let s = 0;
    const n = name.toLowerCase();
    if (has(q, n) || (n.length > 3 && /[-\s]/.test(n) && squashed.includes(n.replace(/[-\s]/g, '')))) s += 12;
    const fw = words(full).filter((w) => !STOP.has(w) && w.length > 3);
    const overlap = fw.filter((w) => qw.has(w)).length;
    if (fw.length && overlap >= Math.min(3, fw.length)) s += 6;
    else s += overlap;
    return s;
  };

  if (it.wants === 'venue' || it.wants === 'any') {
    for (const v of k.venues) {
      let score = named(v.name, v.full);
      const inArea = it.areas.includes(v.area);
      if (it.areas.length && !inArea && score < 12) continue;   // another area than the one asked about
      if (inArea) score += 3;
      if (v.topics.some((t) => qw.has(t.toLowerCase()))) score += 2;
      if (v.publisher && has(q, v.publisher.toLowerCase())) score += 2;
      const next = nextIn(v.deadlines, it.to !== null ? it.from : now, it.to, it.verifiedOnly);
      if (it.to !== null && next === null && score < 12) continue;   // outside the window asked about
      if (it.to !== null) score += 2;
      if (score > 0) hits.push({ kind: 'venue', rec: v, score, next });
    }
  }
  if (it.wants !== 'venue') {
    for (const g of k.grants) {
      if (it.wants === 'fellowship' && g.kind !== 'fellowship') continue;
      if (it.wants === 'grant' && g.kind !== 'grant') continue;
      let score = named(g.name, g.name) + (has(q, g.funder.toLowerCase()) ? 4 : 0);
      if (it.wants !== 'any') score += 2;
      if (g.topics.some((t) => qw.has(t.toLowerCase()))) score += 1;
      const next = nextIn(g.deadlines, it.to !== null ? it.from : now, it.to, it.verifiedOnly);
      if (it.to !== null && next === null && score < 12) continue;
      if (score > 0) hits.push({ kind: 'grant', rec: g, score, next });
    }
  }
  // nothing specific asked ("what is the next deadline?"): the soonest
  // upcoming deadlines, of the kind asked about when there is one
  if (!hits.length && it.to === null && !it.areas.length) {
    const soon: Hit[] = [];
    if (it.wants === 'venue' || it.wants === 'any') {
      for (const v of k.venues) {
        const next = nextIn(v.deadlines, now, null, it.verifiedOnly);
        if (next !== null) soon.push({ kind: 'venue', rec: v, score: 1, next });
      }
    }
    if (it.wants !== 'venue') {
      for (const g of k.grants) {
        if ((it.wants === 'fellowship' && g.kind !== 'fellowship') || (it.wants === 'grant' && g.kind !== 'grant')) continue;
        const next = nextIn(g.deadlines, now, null, it.verifiedOnly);
        if (next !== null) soon.push({ kind: 'grant', rec: g, score: 1, next });
      }
    }
    soon.sort((a, b) => (a.next as number) - (b.next as number));
    return { hits: soon.slice(0, 10), intent: it };
  }

  // named records first, then the soonest deadline
  hits.sort((a, b) => b.score - a.score || (a.next ?? Infinity) - (b.next ?? Infinity));
  const top = hits.filter((h) => h.score >= 12);
  const rest = hits.filter((h) => h.score < 12).sort((a, b) => (a.next ?? Infinity) - (b.next ?? Infinity) || b.score - a.score);
  return { hits: [...top, ...rest].slice(0, limit), intent: it };
}

/* One line per record, in words the model can quote. */
const fmt = (iso: string) => {
  const off = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  const mins = off ? (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3])) : 0;
  const local = new Date(Date.parse(iso) + mins * 60000);
  const day = local.toISOString().slice(0, 10);
  const zone = iso.endsWith('-12:00') ? 'AoE' : off ? `UTC${off[1]}${Number(off[2])}${off[3] !== '00' ? `:${off[3]}` : ''}` : 'UTC';
  return `${day} ${zone}`;
};

export function describe(h: Hit, now: number): string {
  const dl = (d: Deadline) => {
    const past = Date.parse(d[1]) < now ? ', passed' : '';
    return `${d[0]}: ${fmt(d[1])} (${d[2] ? 'verified' : 'estimated'}${past})`;
  };
  if (h.kind === 'venue') {
    const v = h.rec as Venue;
    const parts = [`${v.name} (${v.full})`, v.area, v.edition ? `${v.edition} edition` : ''];
    parts.push(v.rolling ? 'rolling submissions' : v.deadlines.length ? v.deadlines.map(dl).join('; ') : 'no dates announced yet');
    if (v.papers) parts.push(`${v.papers.year}: ${v.papers.count} papers in the main proceedings`);
    if (v.acceptance) {
      parts.push(`acceptance rate ${v.acceptance.year}: ${Math.round(v.acceptance.rate * 100)}% (${v.acceptance.kind})`);
    }
    parts.push(`page: ${v.page}`);
    return parts.filter(Boolean).join(' | ');
  }
  const g = h.rec as Grant;
  const parts = [`${g.name}`, `${g.kind} from ${g.funder}`, `for: ${g.eligibility}`, g.amount && `amount: ${g.amount}`,
    g.deadlines.length ? g.deadlines.map(dl).join('; ') : `no date announced${g.window ? ` (${g.window})` : ''}`,
    `page: ${g.page}`];
  return parts.filter(Boolean).join(' | ');
}
