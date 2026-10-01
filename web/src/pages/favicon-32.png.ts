import type { APIRoute } from 'astro';
import { Resvg } from '@resvg/resvg-js';
import { markSvg } from '@/lib/brand';

/* PNG fallback for browsers that do not take SVG favicons. */
export const GET: APIRoute = () => {
  const png = new Resvg(markSvg('light'), { fitTo: { mode: 'height', value: 32 } }).render().asPng();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
