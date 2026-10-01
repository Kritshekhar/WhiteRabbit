/* Link-preview images (Open Graph, 1200x630), rendered at build time with
   satori (layout to SVG) and resvg (SVG to PNG). What shows when a page is
   shared on Slack, X, LinkedIn or iMessage.

   Dates, not countdowns: the image is rebuilt nightly but cached by every
   service that fetched it, so "12 days left" would go stale; "Dec 8, 2026
   AoE" never does. */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const font = (weight: number) =>
  readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`));

let fonts: { name: string; data: Buffer; weight: 400 | 600 | 700 | 800; style: 'normal' }[] | null = null;
const loadFonts = () =>
  (fonts ??= ([400, 600, 700, 800] as const).map((weight) => ({ name: 'Inter', data: font(weight), weight, style: 'normal' as const })));

/* satori takes React-shaped objects; this keeps the tree readable without JSX */
type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: (Node | string | null | false)[]): Node => ({
  type,
  props: { style: { display: 'flex', ...style }, children: children.filter(Boolean) },
});

export interface OgCard {
  eyebrow: string;            // e.g. "Conference deadline"
  title: string;              // e.g. "OSDI 2027"
  subtitle?: string;          // e.g. the full name
  line?: string;              // e.g. "Paper submission · Dec 8, 2026 AoE"
  status?: 'verified' | 'est.' | null;
  footer?: string;            // e.g. "kritshekhar.github.io/WhiteRabbit"
}

const C = { bg: '#0f1115', panel: '#171a21', fg: '#ffffff', fg2: '#c3c2b7', muted: '#8f8e86', accent: '#5b9cec',
  good: '#2bbf8a', warn: '#fab219' };

export async function renderOg(card: OgCard): Promise<Buffer> {
  // a drawn dot rather than a check mark: the Latin font subset has no ✓ glyph
  const tone = card.status === 'verified' ? C.good : C.warn;
  const badge = card.status
    ? h('div', { alignItems: 'center', gap: 10, padding: '6px 18px', borderRadius: 999, fontSize: 26, fontWeight: 700,
        color: tone, border: `2px solid ${tone}`, flexShrink: 0 },
      h('div', { width: 12, height: 12, borderRadius: 999, background: tone }),
      card.status === 'verified' ? 'verified' : 'estimated')
    : null;

  const tree = h('div', { width: 1200, height: 630, flexDirection: 'column', justifyContent: 'space-between',
      padding: '64px 72px', background: `linear-gradient(135deg, ${C.bg} 0%, #18233a 100%)`, color: C.fg, fontFamily: 'Inter' },
    h('div', { alignItems: 'center', justifyContent: 'space-between' },
      h('div', { alignItems: 'center', gap: 16 },
        h('div', { width: 18, height: 18, borderRadius: 999, background: C.accent }),
        h('div', { fontSize: 30, fontWeight: 700, color: C.fg2 }, 'White Rabbit'),
        h('div', { fontSize: 28, color: C.muted, marginLeft: 8 }, `· ${card.eyebrow}`)),
      h('div', { fontSize: 22, color: C.muted }, card.footer ?? 'kritshekhar.github.io/WhiteRabbit')),
    h('div', { flexDirection: 'column', gap: 18 },
      h('div', { fontSize: card.title.length > 28 ? 64 : 88, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }, card.title),
      card.subtitle ? h('div', { fontSize: 34, color: C.fg2, lineHeight: 1.25 },
        card.subtitle.length > 110 ? `${card.subtitle.slice(0, 107)}...` : card.subtitle) : null),
    card.line || badge
      ? h('div', { alignItems: 'center', gap: 22, paddingTop: 28, borderTop: '2px solid #2a2f3a' },
          card.line ? h('div', { fontSize: 36, fontWeight: 600 }, card.line) : null,
          badge)
      : h('div', { height: 2 }));

  const svg = await satori(tree as never, { width: 1200, height: 630, fonts: loadFonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}

export const pngResponse = (png: Buffer) =>
  new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
