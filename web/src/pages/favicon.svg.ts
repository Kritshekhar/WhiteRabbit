import type { APIRoute } from 'astro';
import { faviconSvg } from '@/lib/brand';

/* The tab icon, in the logo's light or dark palette to match the browser. */
export const GET: APIRoute = () => new Response(faviconSvg(), { headers: { 'Content-Type': 'image/svg+xml' } });
