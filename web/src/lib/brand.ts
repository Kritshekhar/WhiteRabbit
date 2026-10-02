/* The White Rabbit mark: a low-poly rabbit head in the Aurora palette.
   One definition, used by the header, the favicons, the app icon and the
   link-preview images, so they can never drift apart. */

// facets as [points, tone]; tone 0 is the lit forehead, 1..4 run light to shadow
export const FACETS: [number[], number][] = [
  [[42, 4, 36, 56, 56, 50], 1],                   // left ear
  [[80, 4, 64, 50, 86, 54], 2],                   // right ear
  [[36, 56, 56, 50, 64, 50, 86, 54, 60, 64], 0],  // forehead, closing the gap under the ears
  [[28, 80, 36, 56, 60, 64], 1],                  // left cheek
  [[86, 54, 94, 82, 60, 64], 3],                  // right cheek
  [[28, 80, 60, 64, 60, 112], 2],                 // left muzzle
  [[60, 64, 94, 82, 60, 112], 4],                 // right muzzle, in shadow
];
export const VIEWBOX = '18 0 86 116';

// Aurora: cyan, violet, magenta. The dark set is brighter so it keeps its contrast.
export const TONES = {
  light: ['#c8f4ff', '#58c8ff', '#7b6cff', '#b05cf0', '#5b2a8f'],
  dark: ['#e2faff', '#8ad9ff', '#a093ff', '#c98af7', '#8a4fc8'],
};

const polys = (fill: (t: number) => string) => FACETS.map(([pts, t]) =>
  `<polygon points="${pts.join(',')}" fill="${fill(t)}" stroke="${fill(t)}" stroke-width=".7" stroke-linejoin="round"/>`).join('');

/* A standalone SVG in one palette. */
export function markSvg(theme: 'light' | 'dark' = 'light', size?: number): string {
  const dims = size ? ` width="${size}" height="${Math.round(size * 116 / 86)}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}"${dims}>${polys((t) => TONES[theme][t])}</svg>`;
}

/* The favicon: switches to the dark palette when the browser is in dark mode. */
export function faviconSvg(): string {
  const css = TONES.light.map((c, i) => `.t${i}{fill:${c};stroke:${c}}`).join('')
    + `@media (prefers-color-scheme: dark){${TONES.dark.map((c, i) => `.t${i}{fill:${c};stroke:${c}}`).join('')}}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}"><style>${css}</style>`
    + FACETS.map(([pts, t]) => `<polygon class="t${t}" points="${pts.join(',')}" stroke-width=".7" stroke-linejoin="round"/>`).join('')
    + '</svg>';
}

/* The app icon: the mark on a dark rounded square, for home screens. */
export function appIconSvg(size = 180): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}">`
    + '<rect width="120" height="120" rx="26" fill="#16151f"/>'
    + `<g transform="translate(14 10) scale(.77)">${polys((t) => TONES.dark[t])}</g></svg>`;
}
