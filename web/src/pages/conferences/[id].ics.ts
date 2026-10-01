import type { APIRoute } from 'astro';
import { getVenues } from '@/lib/db';
import { buildCalendar, icsResponse, venueIcsEvents } from '@/lib/ics';
import type { Venue } from '@/lib/types';

/* One venue's deadlines, to subscribe to a single conference. */
export function getStaticPaths() {
  return getVenues().filter((v) => !v.rolling).map((v) => ({ params: { id: v.id }, props: { venue: v } }));
}

export const GET: APIRoute = ({ props }) => {
  const v = (props as { venue: Venue }).venue;
  return icsResponse(buildCalendar(`White Rabbit: ${v.name}`, `${v.full_name || v.name} deadlines from White Rabbit.`,
    venueIcsEvents(v)));
};
