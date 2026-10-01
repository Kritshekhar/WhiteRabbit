import type { APIRoute } from 'astro';
import { getGrants } from '@/lib/db';
import { buildCalendar, grantIcsEvents, icsResponse } from '@/lib/ics';
import type { Grant } from '@/lib/types';

/* One grant or fellowship's deadlines. */
export function getStaticPaths() {
  return getGrants().map((g) => ({ params: { id: g.id }, props: { grant: g } }));
}

export const GET: APIRoute = ({ props }) => {
  const g = (props as { grant: Grant }).grant;
  return icsResponse(buildCalendar(`White Rabbit: ${g.name}`, `${g.name} deadlines from White Rabbit.`, grantIcsEvents(g)));
};
