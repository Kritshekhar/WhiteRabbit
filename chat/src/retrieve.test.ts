import { describe, expect, it } from 'vitest';
import { describe as line, intent, retrieve, type Knowledge } from './retrieve';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const K: Knowledge = {
  built: '2026-10-02T00:00:00Z',
  venues: [
    { id: 'osdi', name: 'OSDI', full: 'USENIX Symposium on Operating Systems Design and Implementation', area: 'Systems',
      topics: ['Systems'], publisher: 'USENIX', edition: 2027, rolling: false, page: 'https://x/conferences/osdi/', official: '',
      deadlines: [['Paper submission', '2026-12-08T23:59:00-12:00', true]], papers: { year: 2025, count: 53 }, acceptance: { year: 2024, rate: 0.16, kind: 'official' } },
    { id: 'nsdi', name: 'NSDI', full: 'USENIX Symposium on Networked Systems Design and Implementation', area: 'Networking',
      topics: ['Networking'], publisher: 'USENIX', edition: 2027, rolling: false, page: 'https://x/conferences/nsdi/', official: '',
      deadlines: [['Fall deadline', '2026-10-20T23:59:00-12:00', false]] },
    { id: 'chi', name: 'CHI', full: 'ACM CHI Conference on Human Factors in Computing Systems', area: 'HCI',
      topics: ['HCI'], publisher: 'ACM', edition: 2028, rolling: false, page: 'https://x/conferences/chi/', official: '',
      deadlines: [['Paper submission', '2027-09-10T23:59:00-12:00', false]] },
  ],
  grants: [
    { id: 'grfp', name: 'NSF Graduate Research Fellowship (GRFP)', funder: 'NSF', kind: 'fellowship', eligibility: 'PhD student',
      amount: '$37k/yr', topics: ['General'], window: '', page: 'https://x/grants/grfp/', official: '',
      deadlines: [['Application', '2026-10-20T20:00:00-04:00', true]] },
    { id: 'career', name: 'NSF CAREER', funder: 'NSF', kind: 'grant', eligibility: 'Early-career faculty',
      amount: '$600k', topics: ['General'], window: 'Usually July', page: 'https://x/grants/career/', official: '', deadlines: [] },
  ],
};
const ids = (q: string) => retrieve(K, q, NOW).hits.map((h) => h.rec.id);

describe('intent', () => {
  it('reads time windows', () => {
    expect(intent('systems deadlines in the next 6 weeks', NOW).to).toBe(NOW + 42 * 86400000);
    const dec = intent('what is due in December?', NOW);
    expect(new Date(dec.from).toISOString().slice(0, 10)).toBe('2026-12-01');
  });
  it('does not take the verb "may" for the month', () => {
    expect(intent('may I submit to OSDI?', NOW).to).toBeNull();
    expect(intent('deadlines in May', NOW).to).not.toBeNull();
  });
  it('tells grants, fellowships and venues apart', () => {
    expect(intent('PhD fellowships closing soon', NOW).wants).toBe('fellowship');
    expect(intent('NSF grants for faculty', NOW).wants).toBe('grant');
    expect(intent('acceptance rate of NSDI', NOW).wants).toBe('venue');
  });
});

describe('retrieve', () => {
  it('finds a venue by its acronym first', () => {
    expect(ids('Is the OSDI deadline verified?')[0]).toBe('osdi');
  });
  it('keeps only records with a deadline in the window', () => {
    expect(ids('systems deadlines in the next 6 weeks')).not.toContain('osdi');
    expect(ids('what is due in December?')).toContain('osdi');
  });
  it('matches a hyphenated name written without the hyphen', () => {
    const k = { ...K, venues: [...K.venues, { ...K.venues[0], id: 'europar', name: 'Euro-Par', full: 'European Conference on Parallel and Distributed Computing' }] };
    expect(retrieve(k, 'When is the EuroPar deadline?', NOW).hits[0].rec.id).toBe('europar');
  });
  it('does not take an area word in a full name for the venue', () => {
    const k = { ...K, venues: [...K.venues, { ...K.venues[2], id: 'oopsla', name: 'OOPSLA', area: 'Software engineering and PL',
      full: 'Object-Oriented Programming, Systems, Languages and Applications' }] };
    expect(retrieve(k, 'systems deadlines', NOW).hits.map((h) => h.rec.id)).not.toContain('oopsla');
    expect(retrieve(k, 'systems deadlines in the next 6 months', NOW).hits.map((h) => h.rec.id)).not.toContain('oopsla');
  });
  it('falls back to the soonest deadlines for a general question', () => {
    // GRFP (Oct 20, 8 pm US Eastern) closes before NSDI (Oct 20 AoE)
    expect(ids('what is the next deadline?')).toEqual(['grfp', 'nsdi', 'osdi', 'chi']);
  });
  it('lists fellowships only for a fellowship question', () => {
    expect(ids('PhD fellowships closing soon')).toEqual(['grfp']);
  });
});

describe('describe', () => {
  it('says verified or estimated, the zone, and links the page', () => {
    const [osdi] = retrieve(K, 'OSDI', NOW).hits;
    const text = line(osdi, NOW);
    expect(text).toContain('Paper submission: 2026-12-08 AoE (verified)');
    expect(text).toContain('acceptance rate 2024: 16% (official)');
    expect(text).toContain('page: https://x/conferences/osdi/');
  });
  it('gives non-AoE zones as written', () => {
    const [grfp] = retrieve(K, 'GRFP fellowship', NOW).hits;
    expect(line(grfp, NOW)).toContain('2026-10-20 UTC-4');
  });
});
