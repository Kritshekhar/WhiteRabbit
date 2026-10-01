/* Research areas, from a venue's primary topic. Used for the per-area calendar
   feeds and the deadline heatmap. Finer than the field-share chart's groups in
   insights.ts, because a subscriber wants "Networking", not "Systems". */

import type { Venue } from './types';

export interface Area { slug: string; label: string }

export const AREAS: Area[] = [
  { slug: 'ml', label: 'Machine learning' },
  { slug: 'ai', label: 'AI and robotics' },
  { slug: 'vision', label: 'Computer vision' },
  { slug: 'nlp', label: 'Language' },
  { slug: 'systems', label: 'Systems' },
  { slug: 'networking', label: 'Networking' },
  { slug: 'security', label: 'Security' },
  { slug: 'data', label: 'Data and databases' },
  { slug: 'software', label: 'Software engineering and PL' },
  { slug: 'hci', label: 'HCI' },
  { slug: 'graphics', label: 'Graphics and multimedia' },
  { slug: 'theory', label: 'Theory' },
  { slug: 'other', label: 'Interdisciplinary' },
];

const TOPIC_AREA: Record<string, string> = {
  ML: 'ml',
  AI: 'ai', RO: 'ai',
  CV: 'vision',
  NLP: 'nlp',
  Systems: 'systems', Storage: 'systems', Cloud: 'systems', Performance: 'systems', HPC: 'systems',
  Architecture: 'systems', Distributed: 'systems', Dependability: 'systems',
  Networking: 'networking',
  Security: 'security',
  Data: 'data', Databases: 'data',
  'Software Engineering': 'software', Languages: 'software',
  HCI: 'hci',
  Graphics: 'graphics',
  Theory: 'theory',
};

export const areaOf = (v: Pick<Venue, 'topics'>): string => TOPIC_AREA[v.topics[0] ?? ''] ?? 'other';
export const areaLabel = (slug: string) => AREAS.find((a) => a.slug === slug)?.label ?? slug;
