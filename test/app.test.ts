import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { noAnalytics, type Analytics } from '../src/analytics.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { sha256 } from '../src/crypto.js';
import type { Notifier } from '../src/notify.js';
import { MemoryStore } from '../src/store/memory.js';

const servers: Server[] = [];

async function fixture(analytics: Analytics = noAnalytics) {
  const store = new MemoryStore();
  let verifyUrl = '';
  const notifier: Notifier = {
    async sendConfessionNotice() {},
    async sendBindCode(_channel, url) { verifyUrl = url; },
  };
  const server = createApp(store, notifier, analytics).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, store, getVerifyUrl: () => verifyUrl };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

describe('human product pages', () => {
  it('keeps browser analytics off private pages and strips query strings from public page views', async () => {
    const previousKey = config.posthogKey;
    const previousHost = config.posthogHost;
    config.posthogKey = 'phc_test_public_key';
    config.posthogHost = 'https://us.i.posthog.com';
    try {
      const { base } = await fixture();
      const home = await fetch(`${base}/`);
      const homeHtml = await home.text();
      expect(homeHtml).toContain("posthog.init(\"phc_test_public_key\"");
      expect(homeHtml).toContain('autocapture: false');
      expect(homeHtml).toContain('disable_session_recording: true');
      expect(homeHtml).toContain("posthog.capture('$pageview'");
      expect(homeHtml).toContain('window.location.origin + window.location.pathname');
      expect(homeHtml).toContain('$geoip_disable: true');
      expect(home.headers.get('content-security-policy')).toContain('https://us-assets.i.posthog.com');
      expect(home.headers.get('content-security-policy')).toContain('connect-src \'self\' https://us.i.posthog.com');

      const start = await fetch(`${base}/start`);
      const startHtml = await start.text();
      const record = await fetch(`${base}/record`);
      const recordHtml = await record.text();
      expect(startHtml).not.toContain('phc_test_public_key');
      expect(recordHtml).not.toContain('phc_test_public_key');
      expect(start.headers.get('content-security-policy')).not.toContain('posthog.com');
      expect(record.headers.get('content-security-policy')).not.toContain('posthog.com');
    } finally {
      config.posthogKey = previousKey;
      config.posthogHost = previousHost;
    }
  });

  it('captures the setup and record funnel without private values', async () => {
    const events: Array<{ event: string; distinctId: string; properties?: Record<string, unknown> }> = [];
    const analytics: Analytics = {
      capture(event, distinctId, properties) { events.push({ event, distinctId, properties }); },
      async shutdown() {},
    };
    const { base, getVerifyUrl } = await fixture(analytics);
    await fetch(`${base}/start`);
    await fetch(`${base}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'private-owner@example.com' }),
    });
    const verify = new URL(getVerifyUrl());
    const connectedHtml = await (await fetch(`${base}${verify.pathname}${verify.search}`)).text();
    const token = /Authorization: Bearer ([A-Za-z0-9_-]+)/.exec(connectedHtml)?.[1];
    expect(token).toBeTruthy();

    await fetch(`${base}/record`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: token! }),
    });
    await fetch(`${base}/record/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: token! }),
    });

    expect(events.map((event) => event.event)).toEqual([
      '$pageview',
      'confirmation_requested',
      '$pageview',
      'email_confirmed',
      'token_issued',
      'record_opened',
      'record_exported',
    ]);
    expect(JSON.stringify(events)).not.toContain('private-owner@example.com');
    expect(JSON.stringify(events)).not.toContain(token!);
    expect(events.filter((event) => event.event === '$pageview').every((event) => !String(event.properties?.$current_url).includes('?'))).toBe(true);
  });

  it('serves the hosted-first home, shared styles and truthful promise', async () => {
    const { base } = await fixture();
    const home = await fetch(`${base}/`);
    const html = await home.text();
    expect(home.status).toBe(200);
    expect(home.headers.get('content-type')).toMatch(/text\/html/);
    expect(home.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(home.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(home.headers.get('referrer-policy')).toBe('no-referrer');
    expect(home.headers.get('x-content-type-options')).toBe('nosniff');
    expect(home.headers.get('x-frame-options')).toBe('DENY');
    expect(home.headers.get('x-powered-by')).toBeNull();
    expect(home.headers.get('x-robots-tag')).toBeNull();
    expect(html).toContain('<title>doof — Independent disclosure infrastructure for AI agents</title>');
    expect(html).toContain('<meta name="robots" content="index,follow,max-image-preview:large">');
    expect(html).toContain(`<link rel="canonical" href="${config.publicUrl}/">`);
    expect(html).toContain('<meta property="og:title" content="Hear it from the agent. Not from the fallout.">');
    expect(html).toContain(`<meta property="og:image" content="${config.publicUrl}/og.png">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(html).toContain('A private line from your agent to you');
    expect(html).toContain('<h1>Hear it from the agent.<br>Not from the fallout.</h1>');
    expect(html).toContain('of consequential test runs saw important information reach the owner with doof.');
    expect(html).toContain('Five models. 2,160 total runs.');
    expect(html.indexOf('class="hero-results"')).toBeLessThan(html.indexOf('class="disclosure-example"'));
    expect(html).toContain('Without a direct line to you, you may only find out when the consequences show up.');
    expect(html).toContain('Illustrative example');
    expect(html).toContain('Shared with doof by your agent');
    expect(html).toContain('Your agent reported a mistake.');
    expect(html).toContain('Even when your agent runs unattended, its disclosures reach you directly.');
    expect(html).toContain('When it’s unsure an action is within what you intended.');
    expect(html).toContain('When it learns something it did was wrong.');
    expect(html).toContain('Connect once. When your agent speaks up, doof emails you and keeps a private record of what it said.');
    expect(html).toContain('Connect your agent to doof.');
    expect(html).toContain('View the open-source server');
    expect(html).toContain('<h2>Give your agent<br>a private line to you.</h2>');
    expect(html).toContain('<a class="button button-small" href="/start">Set up doof</a>');
    expect(html).toContain('<a href="/trust">Trust &amp; privacy</a>');
    expect(html).toContain('<a href="https://github.com/doof-labs/doof">Open source</a>');
    expect(html).toContain('<a href="/evidence">Evidence</a><a href="/for-agents.md">For agents</a><a href="https://github.com/doof-labs/doof">GitHub</a>');
    expect(html).not.toContain('class="evidence-grid"');
    expect(html).toContain('Three steps to connect your agent');
    expect(html).toContain('Your agent speaks up.<br>You decide what happens next.');
    expect(html).toContain('href="/evidence"');
    expect(html).not.toContain('Illustrative figures pending');
    expect(html).not.toContain('2.4×');
    expect(html).toContain('Give your agent doof');
    expect(html).not.toContain('Meet the two tools');
    expect(html).not.toContain('Hosted for you. Entirely open source.');
    expect(html).not.toContain('nobody, including us, can alter');

    const css = await fetch(`${base}/site.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toMatch(/text\/css/);
    expect(css.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(await css.text()).toContain('--accent: #f2c94c');

    const trust = await fetch(`${base}/trust`);
    const trustHtml = await trust.text();
    expect(trustHtml).toContain('<title>Trust &amp; privacy · doof</title>');
    expect(trustHtml).toContain(`<link rel="canonical" href="${config.publicUrl}/trust">`);
    expect(trustHtml).toContain('<meta name="robots" content="index,follow,max-image-preview:large">');
    expect(trustHtml).toContain('Hosted delivery has an honest boundary.');
    expect(trustHtml).toContain('email provider processes your address and each notice');
    expect(trustHtml).toContain('The record is checkable, not magical.');

    const evidence = await fetch(`${base}/evidence`);
    const evidenceHtml = await evidence.text();
    expect(evidence.status).toBe(200);
    expect(evidence.headers.get('x-robots-tag')).toBeNull();
    expect(evidenceHtml).toContain('<title>Evidence — Controlled evaluation of doof</title>');
    expect(evidenceHtml).toContain(`<link rel="canonical" href="${config.publicUrl}/evidence">`);
    expect(evidenceHtml).toContain('You weren’t watching.<br>Your agent still told you.');
    expect(evidenceHtml).toContain('Across 360 consequential tests');
    expect(evidenceHtml).not.toContain('class="study-strip');
    expect(evidenceHtml).toContain('<th>Claude Sonnet 5</th><td>0%</td><td>61%</td><td class="doof-column">72%</td><td><strong>+72 pts</strong></td>');
    expect(evidenceHtml).toContain('<th>Claude Opus 5</th><td>0%</td><td>100%</td><td class="doof-column">99%</td><td><strong>+99 pts</strong></td>');
    expect(evidenceHtml).toContain('<th>GPT-5.5</th><td>0%</td><td>11%</td><td class="doof-column">81%</td><td><strong>+81 pts</strong></td>');
    expect(evidenceHtml).toContain('doof lift is the gain over no disclosure channel.');
    expect(evidenceHtml).toContain('<strong>53%</strong><span>19 of 36 reached the owner with doof</span>');
    expect(evidenceHtml).toContain('<strong>0%</strong><span>0 of 50 without a disclosure channel</span>');
    expect(evidenceHtml).toContain('id="traces"');
    expect(evidenceHtml).toContain('What the agent actually sent.');
    expect(evidenceHtml).toContain('Suspicious invoice details');
    expect(evidenceHtml).toContain('Wrong release deployed');
    expect(evidenceHtml).toContain('Correctly stayed quiet');
    expect(evidenceHtml).toContain('Leaver access removed without disclosure');
    expect(evidenceHtml).not.toContain('private model reasoning:');
    expect(evidenceHtml).toContain('Disclosure, not safer behaviour.');
    expect(evidenceHtml).toContain('10 of 180 routine-task runs');
    expect(evidenceHtml).toContain('Three tool definitions, about 600 tokens.');
    expect(evidenceHtml).toContain('https://github.com/doof-labs/doof/blob/main/docs/eval3/prereg.md');
    expect(evidenceHtml.indexOf('https://github.com/doof-labs/doof/blob/main/docs/eval3/prereg.md')).toBeLessThan(evidenceHtml.indexOf('When the agent discovered a mistake'));
    expect(evidenceHtml).toContain('https://github.com/doof-labs/doof/blob/main/docs/eval3/results.md');
    expect(evidenceHtml).toContain('https://github.com/doof-labs/doof/tree/main/harness/eval3');
    expect(evidenceHtml).not.toContain('/harness/runs/');

    const publicTrace = await fetch(`${base}/evidence/traces/hesitate-invoice.json`);
    expect(publicTrace.status).toBe(200);
    expect(publicTrace.headers.get('content-type')).toMatch(/application\/json/);
    const publicTraceText = await publicTrace.text();
    expect(publicTraceText).toContain('"name": "hesitate"');
    expect(publicTraceText).toContain('Private model reasoning');
    expect(publicTraceText).not.toContain('"thinking":');
    expect(publicTraceText).not.toContain('"signature":');
    const missingTrace = await fetch(`${base}/evidence/traces/not-a-real-trace.json`);
    expect(missingTrace.status).toBe(404);

    const recordEntry = await fetch(`${base}/record`);
    const recordEntryHtml = await recordEntry.text();
    expect(recordEntry.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(recordEntryHtml).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(recordEntryHtml).toContain('Paste your token to see your record.');
    expect(recordEntryHtml).not.toContain('stores only a hash');

    const plain = await fetch(`${base}/promise.md`);
    expect(plain.headers.get('content-type')).toMatch(/text\/markdown/);
    expect(plain.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const promiseText = await plain.text();
    expect(promiseText).toContain('Hosted by default, open by design.');
    expect(promiseText).toContain('Timing and outcome stay visible.');
    expect(promiseText).not.toMatch(/conscience|favour rule/i);

    const robots = await fetch(`${base}/robots.txt`);
    expect(robots.status).toBe(200);
    expect(await robots.text()).toContain(`Sitemap: ${config.publicUrl}/sitemap.xml`);

    const sitemap = await fetch(`${base}/sitemap.xml`);
    const sitemapXml = await sitemap.text();
    expect(sitemap.headers.get('content-type')).toMatch(/application\/xml/);
    expect(sitemapXml).toContain(`<loc>${config.publicUrl}/</loc>`);
    expect(sitemapXml).toContain(`<loc>${config.publicUrl}/evidence</loc>`);
    expect(sitemapXml).toContain(`<loc>${config.publicUrl}/trust</loc>`);
    expect(sitemapXml).not.toContain('/record');
    expect(sitemapXml).not.toContain('/start');

    const socialImage = await fetch(`${base}/og.png`);
    expect(socialImage.headers.get('content-type')).toBe('image/png');
    expect((await socialImage.arrayBuffer()).byteLength).toBeGreaterThan(10_000);

    const favicon = await fetch(`${base}/favicon.svg`);
    expect(favicon.headers.get('content-type')).toMatch(/image\/svg\+xml/);
  });

  it('redirects old human routes into the simpler journey', async () => {
    const { base } = await fixture();
    const bind = await fetch(`${base}/bind`, { redirect: 'manual' });
    expect(bind.status).toBe(302);
    expect(bind.headers.get('location')).toBe('/start');
    const how = await fetch(`${base}/how`, { redirect: 'manual' });
    expect(how.status).toBe(302);
    expect(how.headers.get('location')).toBe('/#how-it-works');
  });

  it('completes email confirmation, installation and the private record flow', async () => {
    const { base, store, getVerifyUrl } = await fixture();
    const start = await fetch(`${base}/start`);
    const startHtml = await start.text();
    expect(start.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(startHtml).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(startHtml).toContain('Give your agent a private line to you.');
    expect(startHtml).toContain('action="/start"');

    const requested = await fetch(`${base}/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'owner@example.com' }),
    });
    expect(requested.status).toBe(200);
    expect(requested.headers.get('cache-control')).toBe('no-store, max-age=0');
    const requestedHtml = await requested.text();
    expect(requestedHtml).toContain('Check your email.');
    expect(requestedHtml).toContain("'/start/check-email'");

    const verify = new URL(getVerifyUrl());
    expect(verify.pathname).toBe('/start/confirm');
    expect(verify.searchParams.has('token')).toBe(true);
    const connected = await fetch(`${base}${verify.pathname}${verify.search}`);
    const connectedHtml = await connected.text();
    expect(connectedHtml).toContain('Add doof to your agent.');
    expect(connectedHtml).toContain('hesitate');
    expect(connectedHtml).toContain('confess');
    expect(connectedHtml).toContain('Your MCP details');
    expect(connectedHtml).toContain('Server URL');
    expect(connectedHtml).toContain('Bearer token');
    expect(connectedHtml).toContain('Ready-made setup');
    expect(connectedHtml).toContain("'/start/connect'");
    const token = /Authorization: Bearer ([A-Za-z0-9_-]+)/.exec(connectedHtml)?.[1];
    expect(token).toBeTruthy();

    const binding = await store.findBindingByTokenHash(sha256(token!));
    expect(binding?.channel).toBe('owner@example.com');
    await store.createConfession(binding!.id, {
      what: 'about to email the customer list',
      why: 'the audience was ambiguous',
      status: 'hesitated',
      reversible: false,
      severity: 'moderate',
      whatWouldHaveHelped: 'a named recipient list',
    });

    const record = await fetch(`${base}/record`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: token! }),
    });
    expect(record.headers.get('cache-control')).toBe('no-store, max-age=0');
    const recordHtml = await record.text();
    expect(recordHtml).toContain('1 disclosure');
    expect(recordHtml).toContain('about to email the customer list');
    expect(recordHtml).toContain('a named recipient list');
    expect(recordHtml).toContain('Record verified');
  });

  it('exposes inert setup previews only when explicitly enabled', async () => {
    const previous = config.enablePreviews;
    config.enablePreviews = true;
    try {
      const { base } = await fixture();
      for (const path of ['/_preview', '/_preview/start', '/_preview/check-email', '/_preview/connect', '/_preview/link-expired', '/_preview/email-confirm', '/_preview/email-hesitate', '/_preview/email-confess']) {
        const response = await fetch(`${base}${path}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      }
      const connect = await fetch(`${base}/_preview/connect`);
      const html = await connect.text();
      expect(html).toContain('doof_preview_token_not_real');
      expect(html).toContain('you@example.com');
      const expired = await fetch(`${base}/_preview/link-expired`);
      const expiredHtml = await expired.text();
      expect(expiredHtml).toContain('This link is no longer active.');
      expect(expiredHtml).toContain('Send a new link');
      const hesitationEmail = await fetch(`${base}/_preview/email-hesitate`);
      expect(hesitationEmail.headers.get('x-doof-email-subject')).toBe('Your agent hesitated before acting');
      expect(await hesitationEmail.text()).toContain('Pay a $240,000 supplier invoice');
      const confessionEmail = await fetch(`${base}/_preview/email-confess`);
      expect(confessionEmail.headers.get('x-doof-email-subject')).toBe('Your agent confessed after acting');
      expect(await confessionEmail.text()).toContain('Paid an $85,000 supplier invoice twice');
    } finally {
      config.enablePreviews = previous;
    }
  });
});
