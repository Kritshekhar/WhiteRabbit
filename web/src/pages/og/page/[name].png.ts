import type { APIRoute } from 'astro';
import { pngResponse, renderOg } from '@/lib/og';
import { PAGE_CARDS } from '@/lib/ogcards';

export function getStaticPaths() {
  return Object.keys(PAGE_CARDS).map((name) => ({ params: { name } }));
}

export const GET: APIRoute = async ({ params }) => pngResponse(await renderOg(PAGE_CARDS[params.name as string]));
