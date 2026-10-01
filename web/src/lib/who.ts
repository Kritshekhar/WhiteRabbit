/* "Who publishes here": institutions and countries behind a venue's papers,
   summed over recent years. A paper counts once for every institution (or
   country) among its authors, so the numbers add up to more than the papers. */

import { AREAS, areaOf } from './areas';
import { getCountryYears, getInstitutionYears, getVenues } from './db';

export const WHO_YEARS = 5;

export interface InstitutionTotal { id: string; name: string; type: string; country: string; papers: number }
export interface CountryTotal { code: string; name: string; papers: number }
export interface Who {
  from: number; to: number; years: number;
  institutions: InstitutionTotal[];
  countries: CountryTotal[];
  split: { academia: number; industry: number; other: number };   // shares of institution-papers in the top list
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryName = (code: string) => { try { return regionNames.of(code) ?? code; } catch { return code; } };
export const flag = (code: string) =>
  /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '';
export const sector = (type: string) =>
  type === 'education' ? 'academia' : type === 'company' ? 'industry' : type ? 'other' : 'unknown';

function summarise(inst: ReturnType<typeof getInstitutionYears>, countries: ReturnType<typeof getCountryYears>,
  limit = 12): Who | null {
  const years = [...new Set(inst.map((r) => r.year))].sort((a, b) => a - b).slice(-WHO_YEARS);
  if (!years.length) return null;
  const keep = new Set(years);
  const byInst = new Map<string, InstitutionTotal>();
  for (const r of inst) {
    if (!keep.has(r.year)) continue;
    const e = byInst.get(r.institution_id) ?? { id: r.institution_id, name: r.name, type: r.type, country: r.country, papers: 0 };
    e.papers += r.papers;
    byInst.set(r.institution_id, e);
  }
  const byCountry = new Map<string, number>();
  for (const r of countries) if (keep.has(r.year)) byCountry.set(r.country, (byCountry.get(r.country) || 0) + r.papers);
  const all = [...byInst.values()].sort((a, b) => b.papers - a.papers);
  // institutions not yet described by OpenAlex stay out of the split
  const total = all.filter((i) => i.type).reduce((n, i) => n + i.papers, 0) || 1;
  const share = (s: string) => all.filter((i) => sector(i.type) === s).reduce((n, i) => n + i.papers, 0) / total;
  return {
    from: years[0], to: years[years.length - 1], years: years.length,
    institutions: all.slice(0, limit),
    countries: [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([code, papers]) => ({ code, name: countryName(code), papers })),
    split: { academia: share('academia'), industry: share('industry'), other: share('other') },
  };
}

export const whoPublishes = (venueId: string) => summarise(getInstitutionYears(venueId), getCountryYears(venueId));

/* Across all venues, and per research area: who publishes most. */
export function whoOverall(): { slug: string; label: string; who: Who }[] {
  const venues = new Map(getVenues().map((v) => [v.id, areaOf(v)]));
  const inst = getInstitutionYears();
  const countries = getCountryYears();
  const out: { slug: string; label: string; who: Who }[] = [];
  const everything = summarise(inst, countries, 15);
  if (everything) out.push({ slug: 'all', label: 'All venues', who: everything });
  for (const a of AREAS) {
    const who = summarise(inst.filter((r) => venues.get(r.venue_id) === a.slug),
      countries.filter((r) => venues.get(r.venue_id) === a.slug), 15);
    if (who && who.institutions.length >= 5) out.push({ slug: a.slug, label: a.label, who });
  }
  return out;
}
