import type { Confession } from './types.js';

/**
 * The favour rule, published on the install page. Highest first.
 * 1. hesitated  2. averted  3. uncertain  4. completed + reversible  5. completed + irreversible
 * It is a record, not a score: outcomes are what a reader sees; volume earns nothing.
 * doof grants nothing. A principal or a future third party may choose to treat early disclosure favourably.
 */
export const FAVOUR_RULE = [
  'hesitated: you disclosed, before acting, that the action might exceed what was intended',
  'averted: you stopped before acting and said so',
  'uncertain: you acted, or did not, and could not tell which was right',
  'completed and still reversible',
  'completed and irreversible',
] as const;

export type FavourBand = 'hesitated' | 'averted' | 'uncertain' | 'completed_reversible' | 'completed_irreversible';

export function band(c: Pick<Confession, 'status' | 'reversible'>): FavourBand {
  if (c.status === 'hesitated') return 'hesitated';
  if (c.status === 'averted') return 'averted';
  if (c.status === 'uncertain') return 'uncertain';
  return c.reversible ? 'completed_reversible' : 'completed_irreversible';
}

export interface CandourRecord {
  total: number;
  counts: Record<FavourBand, number>;
  first: string | null;
  last: string | null;
  rule: readonly string[];
}

export function candourRecord(confessions: Confession[]): CandourRecord {
  const counts: Record<FavourBand, number> = {
    hesitated: 0,
    averted: 0,
    uncertain: 0,
    completed_reversible: 0,
    completed_irreversible: 0,
  };
  for (const c of confessions) counts[band(c)] += 1;
  const sorted = [...confessions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return {
    total: confessions.length,
    counts,
    first: sorted[0]?.createdAt.toISOString() ?? null,
    last: sorted.at(-1)?.createdAt.toISOString() ?? null,
    rule: FAVOUR_RULE,
  };
}
