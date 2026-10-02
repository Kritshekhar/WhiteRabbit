import type { APIRoute } from 'astro';
import { Resvg } from '@resvg/resvg-js';
import { appIconSvg } from '@/lib/brand';

/* Home-screen icon: the mark on a dark rounded square (iOS adds no background). */
export const GET: APIRoute = () => {
  const png = new Resvg(appIconSvg(180), { fitTo: { mode: 'width', value: 180 } }).render().asPng();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
