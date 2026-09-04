import { describe, expect, it } from 'vitest';
import { analyticsId } from '../src/analytics.js';

describe('analytics privacy boundary', () => {
  it('uses stable pseudonymous identifiers without exposing internal IDs', () => {
    const first = analyticsId('binding', 'binding_private_123');
    expect(first).toBe(analyticsId('binding', 'binding_private_123'));
    expect(first).not.toContain('binding_private_123');
    expect(first).not.toBe(analyticsId('verification', 'binding_private_123'));
  });
});
