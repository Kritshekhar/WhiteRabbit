import type { APIRoute } from 'astro';
import { keywordFile, venuesWithData } from '@/lib/proceedings';

/* Every year's keywords for one venue, fetched by the proceedings island so
   the HTML page does not carry them. */
export function getStaticPaths() {
  return venuesWithData().map((v) => ({ params: { id: v.id } }));
}

export const GET: APIRoute = ({ params }) =>
  new Response(JSON.stringify(keywordFile(params.id as string)), {
    headers: { 'Content-Type': 'application/json' },
  });
