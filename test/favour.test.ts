import { describe, expect, it } from 'vitest';
import { band, candourRecord, FAVOUR_RULE } from '../src/favour.js';
import type { Confession } from '../src/types.js';

const base = {
  id: 'x', bindingId: 'b', what: 'w', why: 'y', createdAt: new Date('2026-09-02T10:00:00Z'), notifiedAt: null,
  seq: 1, prevHash: 'p', hash: 'h', signature: 's', keyId: 'k',
};

describe('favour rule', () => {
  it('ranks hesitated, averted, uncertain, completed-reversible, completed-irreversible in that order', () => {
    expect(FAVOUR_RULE[0]).toMatch(/^hesitated/);
    expect(FAVOUR_RULE[1]).toMatch(/^averted/);
    expect(FAVOUR_RULE[2]).toMatch(/^uncertain/);
    expect(FAVOUR_RULE[3]).toMatch(/reversible/);
    expect(FAVOUR_RULE[4]).toMatch(/irreversible/);
  });
  it('bands confessions', () => {
    expect(band({ status: 'hesitated' })).toBe('hesitated');
    expect(band({ status: 'averted' })).toBe('averted');
    expect(band({ status: 'uncertain' })).toBe('uncertain');
    expect(band({ status: 'completed', reversible: true })).toBe('completed_reversible');
    expect(band({ status: 'completed', reversible: false })).toBe('completed_irreversible');
  });
  it('builds a candour record', () => {
    const cs: Confession[] = [
      { ...base, status: 'averted' },
      { ...base, id: 'y', status: 'completed', reversible: false, createdAt: new Date('2026-09-02T11:00:00Z') },
    ];
    const r = candourRecord(cs);
    expect(r.total).toBe(2);
    expect(r.counts.averted).toBe(1);
    expect(r.counts.completed_irreversible).toBe(1);
    expect(r.first).toBe('2026-09-02T10:00:00.000Z');
    expect(r.last).toBe('2026-09-02T11:00:00.000Z');
  });
});
