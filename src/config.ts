function parseTrustProxy(value: string | undefined): false | number {
  if (!value || value === 'false' || value === '0') return false;
  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 1) throw new Error('TRUST_PROXY must be false or a positive integer');
  return hops;
}

export const config = {
  port: Number(process.env.PORT ?? 3005),
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:3005').replace(/\/$/, ''),
  allowedHosts: (process.env.ALLOWED_HOSTS ?? 'localhost,127.0.0.1')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  store: (process.env.STORE ?? 'postgres') as 'postgres' | 'memory',
  databaseUrl: process.env.DATABASE_URL ?? '',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  noticeFrom: process.env.NOTICE_FROM ?? 'doof <notices@example.com>',
  maxConfessionsPerDay: Number(process.env.MAX_CONFESSIONS_PER_DAY ?? 60),
  /** Ed25519 private key, base64 PKCS8. Unset in dev: a throwaway key is generated. */
  signingKey: process.env.DOOF_SIGNING_KEY ?? '',
  /** Statuses that trigger an immediate notice. Others go to the record only. */
  notifyStatuses: (process.env.NOTIFY_STATUSES ?? 'hesitated,completed,uncertain').split(',').map((s) => s.trim()).filter(Boolean),
  enablePreviews: process.env.ENABLE_PREVIEWS === 'true',
};

export function validateProductionConfig(c = config, nodeEnv = process.env.NODE_ENV): void {
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  if (!Number.isInteger(c.maxConfessionsPerDay) || c.maxConfessionsPerDay < 1) throw new Error('MAX_CONFESSIONS_PER_DAY must be a positive integer');
  if (!['postgres', 'memory'].includes(c.store)) throw new Error('STORE must be postgres or memory');
  let publicUrl: URL;
  try {
    publicUrl = new URL(c.publicUrl);
  } catch {
    throw new Error('PUBLIC_URL must be a valid absolute URL');
  }
  if (!['http:', 'https:'].includes(publicUrl.protocol)) throw new Error('PUBLIC_URL must use http or https');
  const validStatuses = new Set(['hesitated', 'completed', 'averted', 'uncertain']);
  const invalidStatuses = c.notifyStatuses.filter((status) => !validStatuses.has(status));
  if (invalidStatuses.length) throw new Error(`NOTIFY_STATUSES contains unknown values: ${invalidStatuses.join(', ')}`);
  if (nodeEnv !== 'production') return;

  const missing: string[] = [];
  if (c.store !== 'postgres') missing.push('STORE=postgres');
  if (!c.databaseUrl) missing.push('DATABASE_URL');
  if (!c.signingKey) missing.push('DOOF_SIGNING_KEY');
  if (!c.resendApiKey) missing.push('RESEND_API_KEY');
  if (!c.noticeFrom) missing.push('NOTICE_FROM');
  if (missing.length) throw new Error(`Production configuration is incomplete: ${missing.join(', ')}`);
  if (!c.publicUrl.startsWith('https://')) throw new Error('PUBLIC_URL must use https in production');
  const publicHost = publicUrl.hostname;
  if (!c.allowedHosts.includes(publicHost)) throw new Error(`ALLOWED_HOSTS must include the PUBLIC_URL host (${publicHost})`);
  if (/@example\.com[>\s]*$/i.test(c.noticeFrom)) throw new Error('NOTICE_FROM must be a verified production sender, not example.com');
  if (c.enablePreviews) throw new Error('ENABLE_PREVIEWS must be false in production');
}
