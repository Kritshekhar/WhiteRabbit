/* Record shapes, mirroring scripts/db.py venue_records() and grant_records(),
   so the pages read exactly what data/*.json used to carry. */

export interface Deadline {
  name: string;
  date: string | null;
  confirmed: boolean;
  source: string;
  track?: string;
  verified_on?: string;
}

export interface Venue {
  id: string;
  name: string;
  full_name: string;
  tier: string;
  url: string;
  url_template: string;
  year: number | null;
  month: number | null;
  stage: number;
  stage_name: string;
  rolling: boolean;
  cycle_years: number;
  formats: string[];
  tracks: string[];
  topics: string[];
  publisher: string;
  notes: string;
  deadlines: Deadline[];
  link_status: string;
  link_checked_on: string;
}

export interface Funding {
  total_program?: number;
  award_ceiling?: number;
  award_floor?: number;
  expected_awards?: number;
}

export interface Grant {
  id: string;
  name: string;
  funder: string;
  also_funded_by: string[];
  eligibility: string;
  url: string;
  amount: string;
  opportunity_number: string;
  topics: string[];
  notes: string;
  ccs: string;
  ccs_auto: boolean;
  funding: Funding;
  typical_window: string;
  last_checked: string;
  deadlines: Deadline[];
  link_status: string;
}

export interface ProceedingsYear {
  venue_id: string;
  year: number;
  accepted_count: number | null;
  submitted_count: number | null;
  acceptance_rate: number | null;
  source: string;
  status: string;
  verified_on: string;
}

export interface TermCount {
  venue_id: string;
  year: number;
  term: string;
  count: number;
  score: number | null;
}
