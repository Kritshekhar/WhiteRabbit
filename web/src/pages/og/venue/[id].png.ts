import type { APIRoute } from 'astro';
import { getVenues } from '@/lib/db';
import { pngResponse, renderOg } from '@/lib/og';
import { venueCard } from '@/lib/ogcards';
import type { Venue } from '@/lib/types';

export function getStaticPaths() {
  return getVenues().map((v) => ({ params: { id: v.id }, props: { venue: v } }));
}

export const GET: APIRoute = async ({ props }) => pngResponse(await renderOg(venueCard((props as { venue: Venue }).venue)));
