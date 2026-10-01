import type { APIRoute } from 'astro';
import { getGrants } from '@/lib/db';
import { pngResponse, renderOg } from '@/lib/og';
import { grantCard } from '@/lib/ogcards';
import { AUDIENCE_ELIGIBILITY } from '@/lib/tiers';
import type { Grant } from '@/lib/types';

export function getStaticPaths() {
  return getGrants().map((g) => ({ params: { id: g.id }, props: { grant: g } }));
}

export const GET: APIRoute = async ({ props }) => {
  const g = (props as { grant: Grant }).grant;
  return pngResponse(await renderOg(grantCard(g, AUDIENCE_ELIGIBILITY.student.includes(g.eligibility) ? 'Fellowship' : 'Grant')));
};
