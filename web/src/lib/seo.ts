/* schema.org structured data, so search engines can show a venue's deadline
   directly. Each upcoming deadline is an Event: the deadline itself, an
   instant, held online at the venue's site. Only dated, upcoming deadlines are
   described, and estimated ones say so. */

import { HOME } from './calendar';
import type { Deadline, Grant, Venue } from './types';

const upcoming = (ds: Deadline[]) => ds.filter((d) => d.date && Date.parse(d.date) > Date.now()).slice(0, 4);

function deadlineEvent(name: string, d: Deadline, page: string, site: string, organizer?: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: `${name}: ${d.name} deadline`,
    description: `${d.name} deadline for ${name}${d.confirmed ? ', verified on the official page' : ' (estimated, not yet confirmed)'}.`,
    startDate: d.date,
    endDate: d.date,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    location: { '@type': 'VirtualLocation', url: site || page },
    ...(organizer ? { organizer: { '@type': 'Organization', name: organizer, url: site || page } } : {}),
    url: page,
  };
}

export function breadcrumbs(items: [string, string][]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: HOME + path })),
  };
}

export function venueLd(v: Venue) {
  const page = `${HOME}conferences/${v.id}/`;
  const name = `${v.name}${v.year ? ` ${v.year}` : ''}`;
  return [
    ...upcoming(v.deadlines).map((d) => deadlineEvent(name, d, page, v.url, v.publisher || undefined)),
    breadcrumbs([['Conferences', 'conferences/'], [v.name, `conferences/${v.id}/`]]),
  ];
}

export function grantLd(g: Grant, section: 'grants' | 'fellowships') {
  const page = `${HOME}grants/${g.id}/`;
  return [
    ...upcoming(g.deadlines).map((d) => deadlineEvent(g.name, d, page, g.url, g.funder || undefined)),
    breadcrumbs([[section === 'fellowships' ? 'Fellowships' : 'Grants', `${section}/`], [g.name, `grants/${g.id}/`]]),
  ];
}

/* The home page: the site, and its search, as a sitelinks search box. */
export const websiteLd = () => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'White Rabbit',
  url: HOME,
  potentialAction: {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: `${HOME}conferences/?q={search_term_string}` },
    'query-input': 'required name=search_term_string',
  },
});
