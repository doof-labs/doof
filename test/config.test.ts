import { describe, expect, it } from 'vitest';
import { config, validateProductionConfig } from '../src/config.js';

const production = {
  ...config,
  publicUrl: 'https://doof.example.com',
  allowedHosts: ['doof.example.com'],
  store: 'postgres' as const,
  databaseUrl: 'postgres://example',
  signingKey: 'private-key',
  resendApiKey: 'resend-key',
  noticeFrom: 'doof <notices@doof.example>',
  enablePreviews: false,
};

describe('production configuration', () => {
  it('accepts a complete persistent deployment', () => {
    expect(() => validateProductionConfig(production, 'production')).not.toThrow();
  });

  it('refuses disposable storage, missing delivery, or a missing signing key', () => {
    expect(() => validateProductionConfig({ ...production, store: 'memory', resendApiKey: '', signingKey: '' }, 'production'))
      .toThrow(/STORE=postgres, DOOF_SIGNING_KEY, RESEND_API_KEY/);
  });

  it('requires HTTPS and a matching allowed host', () => {
    expect(() => validateProductionConfig({ ...production, publicUrl: 'http://doof.example.com' }, 'production')).toThrow(/https/);
    expect(() => validateProductionConfig({ ...production, allowedHosts: ['other.example.com'] }, 'production')).toThrow(/PUBLIC_URL host/);
  });

  it('refuses the placeholder email sender in production', () => {
    expect(() => validateProductionConfig({ ...production, noticeFrom: 'doof <notices@example.com>' }, 'production')).toThrow(/verified production sender/);
  });

  it('allows the intentionally disposable local configuration', () => {
    expect(() => validateProductionConfig({ ...production, store: 'memory', databaseUrl: '', signingKey: '', resendApiKey: '' }, 'development')).not.toThrow();
  });

  it('rejects malformed public URLs and unknown notification statuses', () => {
    expect(() => validateProductionConfig({ ...production, publicUrl: 'not a URL' }, 'development')).toThrow(/absolute URL/);
    expect(() => validateProductionConfig({ ...production, notifyStatuses: ['hesitated', 'typo'] }, 'development')).toThrow(/unknown values: typo/);
  });

  it('validates the optional PostHog host only when analytics are enabled', () => {
    expect(() => validateProductionConfig({ ...production, posthogKey: '', posthogHost: 'not a URL' }, 'production')).not.toThrow();
    expect(() => validateProductionConfig({ ...production, posthogKey: 'phc_test', posthogHost: 'not a URL' }, 'production')).toThrow(/POSTHOG_HOST/);
    expect(() => validateProductionConfig({ ...production, posthogKey: 'phc_test', posthogHost: 'http://posthog.example.com' }, 'production')).toThrow(/https/);
  });
});
