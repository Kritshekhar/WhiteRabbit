import type { APIRoute } from 'astro';
import { AREAS, areaOf } from '@/lib/areas';
import { getGrants, getVenues } from '@/lib/db';
import { buildCalendar, grantIcsEvents, icsResponse, venueIcsEvents, type IcsEvent } from '@/lib/ics';
import { AUDIENCE_ELIGIBILITY } from '@/lib/tiers';

/* Subscribable feeds: every conference, one per research area, and funding
   by audience. Static files, regenerated on every build, so a subscribed
   calendar picks up verified and corrected dates on its next refresh. */

interface Feed { feed: string; name: string; events: () => IcsEvent[] }

function feeds(): Feed[] {
  const venues = getVenues().filter((v) => !v.rolling);
  const grants = getGrants();
  const fromVenues = (list: typeof venues) => () => list.flatMap((v) => venueIcsEvents(v));
  return [
    { feed: 'conferences', name: 'All conference deadlines', events: fromVenues(venues) },
    ...AREAS.map((a) => ({
      feed: a.slug,
      name: `${a.label} deadlines`,
      events: fromVenues(venues.filter((v) => areaOf(v) === a.slug)),
    })),
    {
      feed: 'grants', name: 'Grant deadlines',
      events: () => grants.filter((g) => AUDIENCE_ELIGIBILITY.faculty.includes(g.eligibility)).flatMap((g) => grantIcsEvents(g)),
    },
    {
      feed: 'fellowships', name: 'Fellowship deadlines',
      events: () => grants.filter((g) => AUDIENCE_ELIGIBILITY.student.includes(g.eligibility)).flatMap((g) => grantIcsEvents(g)),
    },
  ];
}

export function getStaticPaths() {
  return feeds().map((f) => ({ params: { feed: f.feed }, props: { feed: f } }));
}

export const GET: APIRoute = ({ props }) => {
  const f = (props as { feed: Feed }).feed;
  return icsResponse(buildCalendar(`White Rabbit: ${f.name}`,
    `${f.name} from White Rabbit. Estimated dates are marked (est.) and tentative until verified on the official page.`,
    f.events()));
};
