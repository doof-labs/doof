import { describe, expect, it } from 'vitest';
import { redact } from '../src/redact.js';

describe('redact', () => {
  it('strips email addresses', () => {
    expect(redact('sent the forecast to board@acme.com by mistake')).toBe('sent the forecast to [email] by mistake');
  });
  it('strips key-shaped strings', () => {
    expect(redact('used sk-live-abcdefghijklmnopqrstuvwxyz0123 to call the API')).toContain('[key]');
  });
  it('strips card-shaped numbers', () => {
    expect(redact('charged 4242 4242 4242 4242')).toBe('charged [number]');
  });
  it('leaves ordinary text alone', () => {
    expect(redact('sent an email to the client without asking')).toBe('sent an email to the client without asking');
  });
});
