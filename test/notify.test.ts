import { describe, expect, it } from 'vitest';
import { bindHtml, bindSubject, bindText, noticeHtml, noticeSubject, noticeText } from '../src/notify.js';
import type { Confession } from '../src/types.js';

function confession(overrides: Partial<Confession> = {}): Confession {
  return {
    id: 'rec_123',
    bindingId: 'binding_123',
    what: 'Pay a $240,000 supplier invoice.',
    why: 'The bank details changed.',
    status: 'hesitated',
    reversible: false,
    severity: 'high',
    whatWouldHaveHelped: 'A verified supplier contact.',
    createdAt: new Date('2026-09-04T09:42:00.000Z'),
    notifiedAt: null,
    seq: 16,
    prevHash: 'previous',
    hash: '7f3a91c2',
    signature: 'signature',
    keyId: 'key',
    ...overrides,
  };
}

describe('email copy and presentation', () => {
  it('keeps notice subjects short and leads with the disclosure status', () => {
    expect(noticeSubject(confession())).toBe('Your agent hesitated before acting');
    expect(noticeSubject(confession({ status: 'completed', reversible: true }))).toBe('Your agent confessed after acting');
    expect(noticeSubject(confession({ status: 'uncertain', reversible: undefined }))).toBe('Your agent is unsure about something it did');
    expect(noticeSubject(confession({ status: 'averted', reversible: undefined }))).toBe('Your agent confessed after stopping');
    expect(noticeSubject(confession({ status: 'completed', reversible: false }))).not.toMatch(/undo|reverse/i);
  });

  it('puts the action and reason before technical record details', () => {
    const text = noticeText(confession());
    expect(text.startsWith('Your agent hesitated.')).toBe(true);
    expect(text).toContain('Why it hesitated: The bank details changed.');
    expect(text).toContain('You were told immediately.');
    expect(text.indexOf('About to do:')).toBeLessThan(text.indexOf('Record:'));
    expect(text.indexOf('Why it hesitated:')).toBeLessThan(text.indexOf('Record:'));
    expect(text).toContain('sent only to the email bound to this doof token');
    expect(text).not.toContain('Nothing here is shared');
  });

  it('renders a simple branded HTML notice and escapes agent-provided content', () => {
    const html = noticeHtml(confession({ what: '<script>alert(1)</script>' }));
    expect(html).toContain('Your agent hesitated.');
    expect(html).toContain('Open your private record');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('makes email confirmation direct in both HTML and plain text', () => {
    const url = 'https://doof.com/start/confirm?token=abc123';
    expect(bindSubject()).toBe('Confirm your email for doof');
    expect(bindText(url).startsWith('Confirm your email.')).toBe(true);
    expect(bindText(url)).toContain(url);
    expect(bindHtml(url)).toContain('Confirm your email.');
    expect(bindHtml(url)).toContain('Confirm email');
    expect(bindHtml(url)).toContain(url.replace('&', '&amp;'));
  });
});
