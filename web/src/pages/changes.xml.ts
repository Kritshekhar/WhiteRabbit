import type { APIRoute } from 'astro';
import { HOME } from '@/lib/calendar';
import { changeItems } from '@/lib/changes';

/* RSS 2.0 of the latest changes. Written by hand: it is a few lines, and not
   worth a dependency. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = () => {
  const items = changeItems().slice(0, 100);
  const link = (path: string) => new URL(path, HOME).toString();
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>White Rabbit: what changed</title>
<link>${HOME}changes/</link>
<atom:link href="${HOME}changes.xml" rel="self" type="application/rss+xml" />
<description>CS conference, grant and fellowship deadlines newly verified, corrected, added or moved to a new cycle.</description>
<language>en</language>
${items.map((c) => `<item>
<title>${esc(`${c.name}: ${c.headline}`)}</title>
<link>${esc(link(c.href))}</link>
<guid isPermaLink="false">whiterabbit-change-${c.id}</guid>
<pubDate>${new Date(c.at).toUTCString()}</pubDate>
<description>${esc(c.headline + (c.source ? ` Source: ${c.source}` : ''))}</description>
</item>`).join('\n')}
</channel>
</rss>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
