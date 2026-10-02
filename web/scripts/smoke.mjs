/* After `npm run build`: the pages and feeds people rely on exist in dist/ and
   say what they should. Catches a build that succeeds but ships an empty or
   broken site (a missing database, a page that renders nothing, a feed that
   lost its events). Run with `npm run smoke`. */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const failures = [];

function read(path) {
  const file = join(DIST, path);
  if (!existsSync(file)) {
    failures.push(`${path}: missing`);
    return null;
  }
  return readFileSync(file, 'utf8');
}

function expect(path, ...needles) {
  const text = read(path);
  if (text === null) return;
  for (const n of needles) {
    const ok = n instanceof RegExp ? n.test(text) : text.includes(n);
    if (!ok) failures.push(`${path}: expected ${n}`);
  }
}

function count(path, pattern, min) {
  const text = read(path);
  if (text === null) return;
  const n = (text.match(pattern) || []).length;
  if (n < min) failures.push(`${path}: ${n} matches of ${pattern}, expected at least ${min}`);
}

// pages
expect('index.html', 'Never be late', 'When the deadlines land', 'wr-planner', 'The idea that broke out each year', 'Trending in');
expect('conferences/index.html', '<title>', /venues?/);
expect('grants/index.html', 'Research grants');
expect('fellowships/index.html', '<title>');
expect('proceedings/index.html', 'Trending keywords');
expect('calendar/index.html', 'conferences.ics');
expect('changes/index.html', '<title>');
expect('about/index.html', '<title>');
expect('404.html', '<title>');
// a venue and a grant page, with structured data for search engines
expect('conferences/osdi/index.html', 'OSDI', 'application/ld+json', 'og:image');
const grants = readdirSync(join(DIST, 'grants')).filter((f) => statSync(join(DIST, 'grants', f)).isDirectory());
if (!grants.length) failures.push('grants/: no grant pages');
else expect(`grants/${grants[0]}/index.html`, 'application/ld+json');

// feeds
expect('calendar/conferences.ics', 'BEGIN:VCALENDAR', 'END:VCALENDAR');
count('calendar/conferences.ics', /BEGIN:VEVENT/g, 20);
count('calendar/grants.ics', /BEGIN:VEVENT/g, 5);
expect('conferences/osdi.ics', 'BEGIN:VCALENDAR');
expect('changes.xml', '<rss', '<item>');
expect('sitemap-index.xml', '<sitemap>');
count('sitemap-0.xml', /<loc>/g, 100);

// images and icons
for (const path of ['og/venue/osdi.png', 'og/page/home.png', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png']) {
  const file = join(DIST, path);
  if (!existsSync(file) || statSync(file).size < 200) failures.push(`${path}: missing or empty`);
}

// old links still lead somewhere
for (const path of ['journey.html', 'venue.html', 'grants.html', 'fellowships.html']) expect(path, 'http-equiv="refresh"');

if (failures.length) {
  console.error(`smoke: ${failures.length} problem(s)\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('smoke: built site looks right');
