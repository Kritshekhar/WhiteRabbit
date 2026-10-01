import type { APIRoute } from 'astro';
import { spreadFile } from '@/lib/insights';

/* Phrase counts per venue per year since 2010, for the spread explorer on
   /proceedings/. Counts plus denominators; the browser computes shares. */
export const GET: APIRoute = () =>
  new Response(JSON.stringify(spreadFile()), { headers: { 'Content-Type': 'application/json' } });
