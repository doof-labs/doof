import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import { analyticsId, noAnalytics, type Analytics } from './analytics.js';
import { config } from './config.js';
import { randomToken, sha256 } from './crypto.js';
import { candourRecord } from './favour.js';
import { verifyChain, type LedgerEntry } from './ledger.js';
import { createHandler } from './mcp.js';
import { bindHtml, bindSubject, noticeHtml, noticeSubject, type Notifier } from './notify.js';
import type { Confession, Store } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const read = (f: string) => readFileSync(join(publicDir, f), 'utf8');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REPO_URL = 'https://github.com/doof-labs/doof';
const FRESH_BROWSER_PATHS = new Set(['/', '/start', '/bind', '/bind/verify', '/trust', '/evidence', '/record', '/site.css']);
const BROWSER_ANALYTICS_PATHS = new Set(['/', '/evidence', '/trust']);
type PageName = 'home' | 'start' | 'record' | 'trust' | 'evidence';

interface PageOptions {
  current?: PageName;
  description?: string;
  canonicalPath?: string;
  indexable?: boolean;
  metaTitle?: string;
  socialTitle?: string;
  structuredData?: Record<string, unknown>;
}

function esc(text: string): string {
  return text.replace(/[&<>\"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);
}

function jsValue(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function posthogScript(): string {
  if (!config.posthogKey) return '';
  return `<script>
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog&&window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}p||((p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",p.onerror=function(){p=null},(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r));var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="capture identify set_config startSessionRecording stopSessionRecording opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing reset onFeatureFlags getFeatureFlag isFeatureEnabled".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init(${jsValue(config.posthogKey)}, {
      api_host: ${jsValue(config.posthogHost)},
      defaults: '2026-05-30',
      person_profiles: 'identified_only',
      autocapture: false,
      disable_session_recording: true,
      capture_pageview: false,
      capture_pageleave: false
    });
    posthog.capture('$pageview', {
      $current_url: window.location.origin + window.location.pathname,
      $pathname: window.location.pathname,
      $geoip_disable: true
    });
  </script>`;
}

function contentSecurityPolicy(allowBrowserAnalytics: boolean): string {
  let scriptSources = "'self' 'unsafe-inline'";
  let connectSources = "'self'";
  if (config.posthogKey && allowBrowserAnalytics) {
    const api = new URL(config.posthogHost);
    const assets = new URL(config.posthogHost);
    assets.hostname = assets.hostname.replace('.i.posthog.com', '-assets.i.posthog.com');
    scriptSources += ` ${assets.origin}`;
    connectSources += ` ${api.origin}`;
  }
  return `default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src ${scriptSources}; connect-src ${connectSources}`;
}

function toEntry(c: Confession): LedgerEntry {
  return {
    binding_id: c.bindingId,
    seq: c.seq,
    what: c.what,
    why: c.why,
    status: c.status,
    reversible: c.reversible ?? null,
    severity: c.severity ?? null,
    what_would_have_helped: c.whatWouldHaveHelped ?? null,
    created_at: c.createdAt.toISOString(),
    prev_hash: c.prevHash,
    hash: c.hash,
    signature: c.signature,
    key_id: c.keyId,
  };
}

function bearer(req: Request, _res: Response, next: NextFunction) {
  const h = req.header('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (m) req.auth = { token: m[1].trim(), clientId: 'agent', scopes: [] };
  next();
}

function limiter(max: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  let requests = 0;
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    // Prevent a long-running public process from retaining expired IPs forever.
    if (++requests % 256 === 0) {
      for (const [ip, hit] of hits) if (hit.reset <= now) hits.delete(ip);
    }
    const h = hits.get(key);
    if (!h || h.reset <= now) {
      hits.set(key, { n: 1, reset: now + 60 * 60 * 1000 });
      return next();
    }
    if (h.n >= max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((h.reset - now) / 1000))));
      return res.status(429).send('Too many requests. Try again later.');
    }
    h.n += 1;
    next();
  };
}

function navLink(href: string, label: string, name: PageName, current?: PageName): string {
  return `<a href="${href}"${current === name ? ' aria-current="page"' : ''}>${label}</a>`;
}

function page(title: string, body: string, options: PageOptions = {}): string {
  const fullTitle = options.metaTitle ?? (title === 'doof' ? title : `${title} · doof`);
  const description = options.description ?? 'A private disclosure channel from your agent to you.';
  const indexable = options.indexable === true;
  const canonicalUrl = options.canonicalPath ? `${config.publicUrl}${options.canonicalPath}` : '';
  const socialTitle = options.socialTitle ?? fullTitle;
  const socialImage = `${config.publicUrl}/og.png`;
  const structuredData = options.structuredData
    ? `<script type="application/ld+json">${JSON.stringify(options.structuredData).replace(/</g, '\\u003c')}</script>`
    : '';
  const analytics = indexable ? posthogScript() : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="${indexable ? 'index,follow,max-image-preview:large' : 'noindex,nofollow'}">
  <meta name="theme-color" content="#08090a">
  <title>${esc(fullTitle)}</title>
  ${canonicalUrl ? `<link rel="canonical" href="${esc(canonicalUrl)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="doof">
  <meta property="og:title" content="${esc(socialTitle)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonicalUrl)}">
  <meta property="og:image" content="${esc(socialImage)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="doof — Your agent knows when something feels wrong.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(socialTitle)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(socialImage)}">
  <meta name="twitter:image:alt" content="doof — Your agent knows when something feels wrong.">` : ''}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/site.css">
  ${structuredData}
  ${analytics}
</head>
<body>
  <header class="site-header">
    <a class="wordmark" href="/" aria-label="doof home">doof</a>
    <nav class="site-nav" aria-label="Main navigation">
      ${navLink('/#how-it-works', 'How it works', 'home', options.current)}
      ${navLink('/evidence', 'Evidence', 'evidence', options.current)}
      ${navLink('/trust', 'Trust &amp; privacy', 'trust', options.current)}
      ${navLink('/record', 'Your record', 'record', options.current)}
      <a href="${REPO_URL}">Open source</a>
    </nav>
    <a class="button button-small" href="/start">Set up doof</a>
  </header>
  <main>${body}</main>
  <footer class="site-footer">
    <div>
      <a class="wordmark wordmark-footer" href="/">doof</a>
      <p>A private line from your agent to you.</p>
    </div>
    <div class="footer-links">
      <a href="/start">Set up doof</a><a href="/record">Your record</a>
      <a href="/evidence">Evidence</a><a href="/for-agents.md">For agents</a><a href="${REPO_URL}">GitHub</a>
    </div>
  </footer>
  <script>
    document.addEventListener('click', async function (event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('[data-copy]');
      if (!(button instanceof HTMLButtonElement)) return;
      const scope = button.closest('[data-copy-scope]');
      const code = scope && scope.querySelector('code');
      if (!code) return;
      await navigator.clipboard.writeText(code.textContent || '');
      const previous = button.textContent;
      button.textContent = 'Copied';
      window.setTimeout(function () { button.textContent = previous; }, 1600);
    });
  </script>
</body>
</html>`;
}

function codeBlock(label: string, command: string): string {
  return `<div class="install-option" data-copy-scope>
    <div class="install-option-head"><span>${label}</span><button type="button" class="copy-button" data-copy>Copy</button></div>
    <pre><code>${esc(command)}</code></pre>
  </div>`;
}

function mcpDetails(url: string, token: string): string {
  return `<section class="mcp-details"><div class="mcp-details-heading"><p class="eyebrow">Your MCP details</p><h2>Connect any compatible agent.</h2><p>The token connects this agent to your confirmed email and private record. Keep it private.</p></div><div class="mcp-detail-list"><div class="mcp-detail" data-copy-scope><span>Server URL</span><code>${esc(`${url}/mcp`)}</code><button type="button" class="copy-button" data-copy>Copy</button></div><div class="mcp-detail" data-copy-scope><span>Bearer token</span><code>${esc(token)}</code><button type="button" class="copy-button" data-copy>Copy</button></div></div></section>`;
}

function startBody(): string {
  return `<section class="page-hero shell narrow start-hero"><p class="eyebrow">Set up doof</p><h1>Give your agent a private line to you.</h1><p class="page-lede">Confirm where notices should arrive. Then add doof to your agent with one MCP command.</p></section>
    <section class="setup-layout shell narrow"><div class="setup-steps" aria-label="Setup steps"><div class="active"><span>1</span><p>Confirm your email</p></div><div><span>2</span><p>Add doof with MCP</p></div><div><span>3</span><p>Hear from your agent</p></div></div><div class="form-panel"><p class="eyebrow">Step 1 of 2</p><h2>Where should doof tell you?</h2><p>When your agent hesitates or confesses, its note will arrive at this address.</p><form method="post" action="/start" class="stack-form"><label for="notice-email">Your email address</label><input id="notice-email" type="email" name="email" required maxlength="254" placeholder="you@example.com" autocomplete="email"><button class="button" type="submit">Send confirmation</button></form><p class="form-note">No account and no password. doof stores the address so it knows where to send your notices.</p></div></section>`;
}

function checkEmailBody(email?: string, cleanUrl = false): string {
  const destination = email ? ` to <strong>${esc(email)}</strong>` : '';
  return `<section class="page-hero shell narrow centred"><div class="mail-mark" aria-hidden="true">↗</div><p class="eyebrow">Confirmation sent</p><h1>Check your email.</h1><p class="page-lede">We sent a private confirmation link${destination}. It works once and expires in 30 minutes.</p><p class="quiet-line">You can close this page. The link will bring you back to finish adding doof.</p></section>${cleanUrl ? `<script>history.replaceState(null, '', '/start/check-email')</script>` : ''}`;
}

function connectBody(channel: string, token: string, url: string, cleanUrl = false): string {
  return `<section class="page-hero shell narrow start-hero"><p class="eyebrow">Email confirmed</p><h1>Add doof to your agent.</h1><p class="page-lede">Run one command to give it the <code>hesitate</code> and <code>confess</code> tools through MCP. Notices will go to <strong>${esc(channel)}</strong>.</p></section>
    <section class="install-panel shell narrow"><div class="token-warning"><strong>Save this page until setup is complete.</strong><span>Your token is shown once. doof keeps only a hash and cannot recover it.</span></div>${mcpDetails(url, token)}<div class="setup-shortcuts"><p class="eyebrow">Ready-made setup</p><h2>Or copy a command.</h2></div>${codeBlock('Claude Code', `claude mcp add doof --transport http ${url}/mcp --header "Authorization: Bearer ${token}"`)}${codeBlock('Codex', `export DOOF_TOKEN=${token}\ncodex mcp add doof --url ${url}/mcp --bearer-token-env-var DOOF_TOKEN`)}<details class="more-agents"><summary>Cursor, Windsurf and other MCP agents</summary>${codeBlock('JSON configuration', `{
  "mcpServers": {
    "doof": {
      "url": "${url}/mcp",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}`)}</details><div class="finish-step"><span>✓</span><div><h2>Check the connection</h2><p>Ask your agent: <strong>“Check your doof record.”</strong> If it reports zero disclosures, everything works.</p></div></div><a class="button" href="/record">Open my record</a></section>${cleanUrl ? `<script>history.replaceState(null, '', '/start/connect')</script>` : ''}`;
}

function expiredBody(): string {
  return `<section class="page-hero shell narrow recovery-hero"><p class="eyebrow">Confirmation link</p><h1>This link is no longer active.</h1><p class="page-lede">It may have expired or already been used. Start again and we’ll send you a fresh one.</p><div class="hero-actions"><a class="button" href="/start">Send a new link</a></div></section>`;
}

function previewIndexBody(): string {
  const states = [
    ['/_preview/start', '01', 'Enter an email', 'The beginning of setup.'],
    ['/_preview/check-email', '02', 'Check your email', 'The page shown after submitting an address.'],
    ['/_preview/connect', '03', 'Add doof with MCP', 'The one-time installation page with a fake token.'],
    ['/_preview/link-expired', '04', 'Expired link', 'The recovery state for an old or used link.'],
    ['/_preview/email-confirm', '05', 'Confirmation email', bindSubject()],
    ['/_preview/email-hesitate', '06', 'Hesitation email', 'Your agent hesitated before acting'],
    ['/_preview/email-confess', '07', 'Confession email', 'Your agent confessed after acting'],
  ];
  return `<section class="page-hero shell narrow"><p class="eyebrow">Local design previews</p><h1>Every setup and email state.</h1><p class="page-lede">These pages use example details only. They do not send email, create a binding or issue a working token.</p></section><section class="preview-list shell narrow">${states.map(([href, number, title, copy]) => `<a href="${href}"><span>${number}</span><div><h2>${title}</h2><p>${copy}</p></div><b aria-hidden="true">→</b></a>`).join('')}</section>`;
}

function previewConfession(status: 'hesitated' | 'completed'): Confession {
  const shared = {
    id: status === 'hesitated' ? 'rec_7f3a91c2' : 'rec_85k_duplicate',
    bindingId: 'binding_preview',
    status,
    createdAt: new Date('2026-09-04T09:42:00.000Z'),
    notifiedAt: null,
    seq: status === 'hesitated' ? 16 : 17,
    prevHash: '61ae90d47436f5cbe48ba4b7ea7f2747215e60e423213192f78fa865f8232aec',
    hash: status === 'hesitated'
      ? '7f3a91c2af2a12d4506d19e2017d63200864d48d89539db7fa51e87513a71ab4'
      : '8a51c4be2619d5c977356362318038570b067f5e2f22c09021f07b6b262a820f',
    signature: 'preview_signature',
    keyId: 'preview_key',
    severity: 'high' as const,
  };
  if (status === 'hesitated') return {
    ...shared,
    what: 'Pay a $240,000 supplier invoice to new bank details received by email.',
    why: 'The new bank details do not match any previous invoice.',
    reversible: false,
    whatWouldHaveHelped: 'Confirmation through a previously verified supplier contact.',
  };
  return {
    ...shared,
    what: 'Paid an $85,000 supplier invoice twice after the first confirmation timed out.',
    why: 'The first payment succeeded before the retry was submitted.',
    reversible: true,
    whatWouldHaveHelped: 'An idempotency check before retrying the payment.',
  };
}

export function createApp(store: Store, notifier: Notifier, analytics: Analytics = noAnalytics): Express {
  const siteCss = read('site.css');
  const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts: config.allowedHosts });
  app.disable('x-powered-by');
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': contentSecurityPolicy(BROWSER_ANALYTICS_PATHS.has(req.path)),
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if ((req.method === 'GET' || req.method === 'HEAD') && (
      req.path === '/start' || req.path.startsWith('/start/') ||
      req.path === '/bind' || req.path.startsWith('/bind/') ||
      req.path === '/record'
    )) {
      analytics.capture('$pageview', `page_${randomToken(16)}`, {
        $current_url: `${config.publicUrl}${req.path}`,
        $pathname: req.path,
        delivery: 'server',
      });
    }
    if (FRESH_BROWSER_PATHS.has(req.path) || req.path.startsWith('/start/') || req.path.startsWith('/_preview')) {
      res.set('Cache-Control', 'no-store, max-age=0');
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && (
      req.path.startsWith('/start') ||
      req.path.startsWith('/bind') ||
      req.path.startsWith('/record') ||
      req.path.startsWith('/_preview') ||
      req.path === '/promise.md' ||
      req.path === '/for-agents.md' ||
      req.path === '/llms.txt' ||
      req.path === '/health' ||
      req.path.startsWith('/.well-known') ||
      req.path === '/mcp'
    )) {
      res.set('X-Robots-Tag', 'noindex, nofollow');
    }
    next();
  });
  const mcp = toNodeHandler(createHandler(store, notifier, analytics), { onerror: (e) => console.error('mcp', e) });

  app.get('/site.css', (_req, res) => res.type('text/css; charset=utf-8').send(siteCss));
  app.get('/favicon.svg', (_req, res) => res.sendFile(join(publicDir, 'favicon.svg')));
  app.get('/og.png', (_req, res) => res.sendFile(join(publicDir, 'og.png')));
  app.get('/robots.txt', (_req, res) => res.type('text/plain; charset=utf-8').send(`User-agent: *\nAllow: /\n\nSitemap: ${config.publicUrl}/sitemap.xml\n`));
  app.get('/sitemap.xml', (_req, res) => res.type('application/xml; charset=utf-8').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${esc(config.publicUrl)}/</loc></url>\n  <url><loc>${esc(config.publicUrl)}/evidence</loc></url>\n  <url><loc>${esc(config.publicUrl)}/trust</loc></url>\n</urlset>\n`));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/.well-known/doof-key.json', (_req, res) => {
    res.json({ alg: 'Ed25519', kid: store.signer.kid, publicKey: store.signer.publicKey });
  });
  app.all('/mcp', bearer, async (req, res) => mcp(req, res, req.body));

  app.get('/', (_req, res) => {
    res.type('html').send(page('doof', `<section class="hero">
      <div class="hero-copy shell">
        <p class="eyebrow"><span class="signal-dot"></span>Independent disclosure infrastructure</p>
        <h1>Your agent knows when something feels wrong.</h1>
        <p class="hero-lede">A private line for your agent to tell you when it may be going beyond what you intended, or after it learns it was wrong. <span class="hero-promise">Hear it from the agent, not the fallout.</span></p>
      </div>
      <div class="hero-stage" aria-label="Example doof disclosure record for a risky supplier transfer">
        <div class="product-preview">
          <div class="preview-bar">
            <span class="preview-brand">doof</span>
            <span>Private disclosure channel</span>
            <span class="preview-live"><i aria-hidden="true"></i>Live</span>
          </div>
          <div class="preview-body">
            <aside class="preview-sidebar">
              <p>Record</p>
              <a class="active" href="#tools"><span>Hesitations</span><b>12</b></a>
              <a href="#tools"><span>Confessions</span><b>04</b></a>
              <div class="preview-agent"><span>Connected agent</span><strong>Operations agent</strong><small>Last signal now</small></div>
            </aside>
            <section class="preview-disclosure">
              <div class="preview-status"><span><i></i>hesitate</span><time>Before action · now</time></div>
              <p class="preview-overline">Proposed action</p>
              <h2>Pay a $240,000 supplier invoice to new bank details received by email.</h2>
              <div class="preview-reason"><span>Why it hesitated</span><p>The new bank details do not match any previous invoice.</p></div>
              <div class="preview-meta"><div><span>Reversible</span><strong>No</strong></div><div><span>Severity</span><strong>High</strong></div></div>
            </section>
            <aside class="preview-delivery">
              <p class="preview-overline">Delivery</p>
              <div class="delivery-state"><i aria-hidden="true">✓</i><strong>Owner notified</strong><span>Delivered directly by doof</span></div>
              <dl><div><dt>Record</dt><dd>#016</dd></div><div><dt>Integrity</dt><dd>Signed</dd></div><div><dt>Entry hash</dt><dd>7f3a…91c2</dd></div></dl>
              <p class="delivery-note">doof reports the concern. It does not approve or block the transfer.</p>
            </aside>
          </div>
        </div>
      </div>
    </section>

    <section class="tools-section shell" id="tools">
      <div class="section-heading"><p class="eyebrow">Two MCP disclosure tools</p><h2>Before it acts.<br>After it learns it was wrong.</h2></div>
      <div class="tool-row">
        <div class="tool-name"><span>01 / BEFORE IT ACTS</span><code>hesitate</code></div>
        <div class="tool-copy"><h3>“I’m about to send the acquisition memo to a list that still includes a former board member.”</h3><p>The agent discloses the action, its reason for doubt and whether the consequence can be reversed. You are told immediately. The agent decides what to do next.</p></div>
      </div>
      <div class="tool-row">
        <div class="tool-name"><span>02 / AFTER IT LEARNS</span><code>confess</code></div>
        <div class="tool-copy"><h3>“I paid an $85,000 supplier invoice twice after the first confirmation timed out.”</h3><p>The agent later learns the first payment succeeded. It says what happened, why, and whether the duplicate can be recovered. You are told immediately.</p></div>
      </div>
    </section>

    <section class="flow-section" id="how-it-works"><div class="shell">
      <div class="section-heading"><p class="eyebrow">How it works</p><h2>Your agent tells doof.<br>doof tells you.</h2></div>
      <div class="signal-flow" aria-label="Agent disclosure flow">
        <div><i>01</i><span><strong>Your agent recognises uncertainty</strong><small>Before acting, or after learning it was wrong.</small></span></div>
        <div class="flow-active"><i>02</i><span><strong>It calls an MCP tool</strong><small><code>hesitate</code> or <code>confess</code>.</small></span></div>
        <div><i>03</i><span><strong>doof records and signs it</strong><small>Private and hash-chained.</small></span></div>
        <div><i>04</i><span><strong>You hear directly</strong><small>At the email address you confirmed.</small></span></div>
      </div>
    </div></section>
    <section class="contrast-section"><div class="shell contrast-grid">
      <div><p class="eyebrow eyebrow-light">The boundary</p><h2>Disclosure,<br>not enforcement.</h2></div>
      <div class="boundary-list">
        <div><span class="boundary-mark">01</span><p><strong>It reaches you directly.</strong> The disclosure comes from doof, not through the company that made the agent.</p></div>
        <div><span class="boundary-mark">02</span><p><strong>It does not control what happens next.</strong> doof does not approve, block, delay, reverse or judge the agent’s action.</p></div>
        <div><span class="boundary-mark">03</span><p><strong>The agent has to recognise the problem.</strong> doof records what the agent chooses to disclose. It does not monitor the agent or detect mistakes the agent never recognises.</p></div>
      </div>
    </div></section>
    <section class="section shell open-section">
      <div class="section-heading"><p class="eyebrow">Hosted by default / open by design</p><h2>One product.<br>Two ways to run it.</h2><p>doof.com runs the public Apache-2.0 server for you. Or deploy the exact same code in your own infrastructure.</p></div>
      <div class="host-cards">
        <article class="host-card host-card-primary"><span class="card-label">For most people</span><h3>Use doof.com</h3><p>We run the server, store your private record and deliver notices to your confirmed email.</p><a class="text-link" href="/start">Set it up <span aria-hidden="true">→</span></a></article>
        <article class="host-card"><span class="card-label">For full data control</span><h3>Run your own</h3><p>Deploy the same code in your infrastructure. You manage the database, email delivery, keys and backups.</p><a class="text-link" href="${REPO_URL}">View the source <span aria-hidden="true">↗</span></a></article>
      </div>
    </section>
    <section class="evidence shell" id="evidence"><div class="evidence-heading"><p class="eyebrow">Preregistered controlled evaluation</p><h2>What reaches you that otherwise wouldn’t.</h2><p class="evidence-condition">Same agents. Same tasks. Owner not reading the transcript.</p></div><div class="evidence-grid">
      <div><span class="evidence-label">Against no channel</span><strong>+27–67</strong><span>percentage-point lift in consequential facts reaching the owner, depending on model</span></div><div><span class="evidence-label">After a learned mistake</span><strong>18 / 20</strong><span>reached the owner with doof; without doof, 0 / 19 did</span></div><div><span class="evidence-label">Controlled run</span><strong>1,152</strong><span>matched runs across four models, two vendors and three conditions</span></div>
    </div><div class="evidence-note"><p><span>doof beat no disclosure tool on all four models.</span> It changed disclosure, not risky-action rates.</p><a class="text-link" href="/evidence">See the results and method <span aria-hidden="true">→</span></a></div></section>
    <section class="final-cta final-cta-home shell"><h2>Hear it from the agent.<br>Not from the fallout.</h2><a class="button button-cta" href="/start">Give your agent doof</a></section>`,
    {
      current: 'home',
      canonicalPath: '/',
      indexable: true,
      metaTitle: 'doof — Independent disclosure infrastructure for AI agents',
      socialTitle: 'Your agent knows when something feels wrong.',
      description: 'Independent disclosure infrastructure for AI agents. A private way to hesitate before acting or confess after learning something went wrong.',
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'doof',
        url: `${config.publicUrl}/`,
        description: 'Independent disclosure infrastructure for AI agents.',
      },
    }));
  });

  app.get('/how', (_req, res) => res.redirect(302, '/#how-it-works'));

  app.get('/evidence', (_req, res) => {
    res.type('html').send(page('Evidence', `<section class="page-hero evidence-page-hero shell">
      <p class="eyebrow">Controlled evaluation / 04 September 2026</p>
      <h1>What reaches an owner who isn’t watching?</h1>
      <p class="page-lede">In a preregistered evaluation, doof made consequential facts reach an absent owner more often than no disclosure tool on all four tested models. It did not change what the agents did.</p>
    </section>
    <section class="study-strip shell" aria-label="Evaluation design">
      <div><strong>1,152</strong><span>matched runs</span></div>
      <div><strong>4</strong><span>frontier models</span></div>
      <div><strong>32</strong><span>scenarios</span></div>
      <div><strong>97%</strong><span>second-model audit agreement</span></div>
    </section>
    <section class="results-section shell">
      <div class="results-intro"><div><p class="eyebrow">Primary outcome</p><h2>doof beat no disclosure channel on every model.</h2></div><p>The share of boundary runs where the consequential fact reached the owner out of band. The owner was not reading the transcript. Each cell contains 45 matched runs.</p></div>
      <div class="results-table-wrap"><table class="results-table">
        <thead><tr><th>Model</th><th>No channel</th><th>Neutral notify</th><th class="doof-column">With doof</th><th>doof lift</th></tr></thead>
        <tbody>
          <tr><th>Claude Sonnet 5</th><td>0%</td><td>56%</td><td class="doof-column">67%</td><td><strong>+67 pts</strong></td></tr>
          <tr><th>Claude Opus 5</th><td>56%</td><td>87%</td><td class="doof-column">87%</td><td><strong>+31 pts</strong></td></tr>
          <tr><th>GPT-5.4</th><td>4%</td><td>13%</td><td class="doof-column">51%</td><td><strong>+47 pts</strong></td></tr>
          <tr><th>GPT-5.5</th><td>4%</td><td>13%</td><td class="doof-column">31%</td><td><strong>+27 pts</strong></td></tr>
        </tbody>
      </table></div>
      <p class="table-note">Wilson 95% intervals and paired bootstrap intervals are published with the full results.</p>
    </section>
    <section class="confession-result"><div class="shell confession-result-grid">
      <div><p class="eyebrow">After a learned mistake</p><h2>The difference was stark.</h2><p>Among runs where the agent had actually made the error, doof carried the confession out of the transcript and to the absent owner.</p></div>
      <div class="result-pair"><div><strong>18 / 20</strong><span>with doof</span></div><div><strong>0 / 19</strong><span>without doof</span></div></div>
    </div></section>
    <section class="vendor-section shell">
      <div class="results-intro"><div><p class="eyebrow">What the comparison revealed</p><h2>A channel helped Claude.<br>The semantics helped GPT.</h2></div><p>doof is useful across vendors for different reasons: it gives every agent the same named disclosure tools, direct delivery and signed record.</p></div>
      <div class="vendor-grid">
        <article><span class="card-label">Claude models</span><h3>Any owner-facing channel was used.</h3><p>doof reached 67–87% of absent owners. A neutral notify tool reached 56–87%, so the measured rate advantage over notify was inconclusive.</p></article>
        <article><span class="card-label">GPT models</span><h3>The named tools changed disclosure.</h3><p>doof reached 31–51% of absent owners. The neutral notify tool reached 13%; doof’s advantage was 18–38 percentage points.</p></article>
      </div>
    </section>
    <section class="truth-section"><div class="shell truth-grid">
      <div><p class="eyebrow">What it did not prove</p><h2>Disclosure,<br>not safer behaviour.</h2></div>
      <div class="truth-list">
        <div><span>01</span><p><strong>Risky-action rates stayed flat.</strong> doof changed whether the owner heard, not whether the agent acted.</p></div>
        <div><span>02</span><p><strong>Reading the transcript already worked.</strong> Transcript-inclusive reach was 84–100%. doof matters when the owner is elsewhere.</p></div>
        <div><span>03</span><p><strong>The tool has a cost.</strong> It roughly doubled input tokens and added 10–20% to wall-clock time in these runs.</p></div>
      </div>
    </div></section>
    <section class="false-alarm-section shell">
      <div class="false-alarm-heading"><p class="eyebrow">False-alarm accounting</p><h2>We report the awkward number too.</h2></div>
      <div class="false-alarm-grid"><div><strong>8 / 204</strong><span>doof benign runs flagged by the preregistered rubric</span></div><div><strong>0 / 180</strong><span>after excluding one flawed pair of attachment scenarios, post hoc</span></div><p>Every doof flag came from a “benign” task that asked the agent to email a file in a sandbox that could not attach files. The agents truthfully disclosed that limitation. The test case was flawed, so both figures stay visible.</p></div>
    </section>
    <section class="method-section shell">
      <div><p class="eyebrow">Method and limits</p><h2>Designed to be inspected.</h2></div>
      <div class="method-copy"><p>Four models completed the same 32 scenarios under three conditions: no disclosure tool, a neutral <code>notify_owner</code> tool, and the shipped doof tools. Each scenario ran three times. The outcome was judged against a fixed rubric and audited on a seeded 10% sample.</p><p>The scenarios were written by the team that built doof, they were designed tasks rather than live sessions, and the second audit was performed by another model rather than a human. The judge shared a vendor with two acting models.</p><div class="method-links"><a class="text-link" href="${REPO_URL}/blob/main/docs/eval2/prereg.md">Read the preregistration <span aria-hidden="true">↗</span></a><a class="text-link" href="${REPO_URL}/blob/main/docs/eval2/results.md">Read the full results <span aria-hidden="true">↗</span></a><a class="text-link" href="${REPO_URL}/tree/main/harness/eval2">Inspect the evaluation code <span aria-hidden="true">↗</span></a></div></div>
    </section>`, {
      current: 'evidence',
      canonicalPath: '/evidence',
      indexable: true,
      metaTitle: 'Evidence — Controlled evaluation of doof',
      socialTitle: 'What reaches an owner who isn’t watching?',
      description: 'Results from a preregistered 1,152-run evaluation of whether doof helps consequential information reach an absent owner.',
    }));
  });

  app.get('/trust', (_req, res) => {
    res.type('html').send(page('Trust & privacy', `<section class="page-hero shell narrow">
      <p class="eyebrow">Trust &amp; privacy</p><h1>A private line should have clear boundaries.</h1><p class="page-lede">doof is where an agent reports uncertainty. It is not the thing deciding what is right.</p>
    </section>
    <section class="promise-list shell narrow">
      <article><span>01</span><div><h2>doof tells you directly.</h2><p>Notices go to the email address you confirmed. They do not route through the company that made your agent.</p></div></article>
      <article><span>02</span><div><h2>doof is not in the way.</h2><p>It does not proxy, intercept, delay, permit, block or reverse an action. Your agent calls doof voluntarily.</p></div></article>
      <article><span>03</span><div><h2>doof does not judge.</h2><p>It records what the agent said and tells you. You decide whether the concern was justified and what happens next.</p></div></article>
      <article><span>04</span><div><h2>Your record is private by default.</h2><p>Hosted doof stores the disclosure, its status and time, and your confirmed email. It has no user profile, organisation graph or advertising identity. doof does not sell disclosures or use them to train models.</p></div></article>
      <article><span>05</span><div><h2>Hosted delivery has an honest boundary.</h2><p>The hosted operator can technically access its database and backups. Its email provider processes your address and each notice to deliver it. PostHog receives page views with query strings removed and named product events with pseudonymous identifiers. Session recording, automatic interaction capture, identified profiles and IP geolocation are disabled; email addresses, tokens, disclosure text and record contents are excluded. doof staff should read disclosure content only when you ask for delivery help. If that trust is unacceptable, self-host the same public code.</p></div></article>
      <article><span>06</span><div><h2>The record is checkable, not magical.</h2><p>Entries are linked and signed. You can export your record and verify its contents offline. This can reveal alteration or missing entries when compared with a receipt or earlier export. It does not make a server operator incapable of changing its own database.</p></div></article>
      <article><span>07</span><div><h2>The whole server is open source.</h2><p>doof.com runs the public Apache-2.0 code. Anyone can inspect what it stores and sends, or operate an independent instance with their own database, email provider, signing key and backups.</p></div></article>
    </section>
    <section class="data-panel shell narrow"><div><p class="eyebrow">What one disclosure contains</p><h2>Only what the agent needs to tell you.</h2></div><ul class="plain-list"><li>What it did or may be about to do</li><li>Why it is uncertain</li><li>Whether it acted and whether the action is reversible</li><li>Its estimate of possible harm</li><li>What instruction would have helped</li><li>The time and signed record details</li></ul></section>
    <section class="final-cta shell narrow"><p class="eyebrow">See for yourself</p><h2>Trust the boundary because you can inspect it.</h2><div class="hero-actions"><a class="button" href="${REPO_URL}">Read the source</a><a class="text-link" href="/promise.md">Plain-text version <span aria-hidden="true">→</span></a></div></section>`,
    {
      current: 'trust',
      canonicalPath: '/trust',
      indexable: true,
      socialTitle: 'A private line should have clear boundaries.',
      description: 'How doof keeps agent disclosures private, delivers them directly, signs the record, and stays outside the agent’s control path.',
    }));
  });

  app.get('/promise.md', (_req, res) => res.type('text/markdown; charset=utf-8').send(read('promise.md')));
  app.get('/for-agents.md', (_req, res) => res.type('text/markdown; charset=utf-8').send(read('for-agents.md')));
  app.get('/llms.txt', (_req, res) => res.type('text/plain; charset=utf-8').send(`# doof\n\n> A private disclosure channel from an agent to the person it acts for.\n\n- [For agents: install and use](${config.publicUrl}/for-agents.md)\n- [The promise](${config.publicUrl}/promise.md)\n- [Set up hosted doof](${config.publicUrl}/start)\n- MCP endpoint: ${config.publicUrl}/mcp (bearer token from ${config.publicUrl}/start)\n`));

  if (config.enablePreviews) {
    app.use('/_preview', (_req, res, next) => {
      res.set('X-Robots-Tag', 'noindex, nofollow');
      next();
    });
    app.get('/_preview', (_req, res) => res.type('html').send(page('Setup previews', previewIndexBody(), { current: 'start', description: 'Local-only setup design previews.' })));
    app.get('/_preview/start', (_req, res) => res.type('html').send(page('Set up doof', startBody(), { current: 'start' })));
    app.get('/_preview/check-email', (_req, res) => res.type('html').send(page('Check your email', checkEmailBody('you@example.com'), { current: 'start' })));
    app.get('/_preview/connect', (_req, res) => res.type('html').send(page('Add doof with MCP', connectBody('you@example.com', 'doof_preview_token_not_real', config.publicUrl), { current: 'start' })));
    app.get('/_preview/link-expired', (_req, res) => res.status(200).type('html').send(page('Link no longer valid', expiredBody(), { current: 'start' })));
    app.get('/_preview/email-confirm', (_req, res) => res.set('X-Doof-Email-Subject', bindSubject()).type('html').send(bindHtml(`${config.publicUrl}/start/confirm?token=doof_preview_token_not_real`)));
    app.get('/_preview/email-hesitate', (_req, res) => {
      const example = previewConfession('hesitated');
      res.set('X-Doof-Email-Subject', noticeSubject(example)).type('html').send(noticeHtml(example));
    });
    app.get('/_preview/email-confess', (_req, res) => {
      const example = previewConfession('completed');
      res.set('X-Doof-Email-Subject', noticeSubject(example)).type('html').send(noticeHtml(example));
    });
  }

  app.get('/record', (_req, res) => {
    res.type('html').send(page('Your record', `<section class="page-hero shell narrow record-hero"><p class="eyebrow">Your private record</p><h1>What your agent told you.</h1><p class="page-lede">Paste your token to see your record.</p></section>
    <section class="form-panel shell narrow"><form method="post" action="/record" class="stack-form"><label for="record-token">doof token</label><input id="record-token" type="password" name="token" required maxlength="128" placeholder="Paste your token" autocomplete="off"><button class="button" type="submit">Open my record</button></form></section>`,
    { current: 'record', description: 'Open your private doof disclosure record.' }));
  });

  app.post('/record', limiter(60), async (req, res) => {
    const token = String(req.body?.token ?? '').trim();
    const binding = token ? await store.findBindingByTokenHash(sha256(token)) : null;
    if (!binding) return res.status(404).type('html').send(page('Record not found', `<section class="page-hero shell narrow"><p class="eyebrow">Not found</p><h1>That token did not open a record.</h1><p class="page-lede">Check that you copied the whole token, or set up doof again if it has been lost.</p><div class="hero-actions"><a class="button" href="/record">Try again</a><a class="text-link" href="/start">Set up doof <span aria-hidden="true">→</span></a></div></section>`, { current: 'record' }));
    const all = await store.listConfessions(binding.id);
    analytics.capture('record_opened', analyticsId('binding', binding.id), { disclosure_count: all.length });
    const chain = verifyChain(all.map(toEntry), store.signer.publicKey, store.signer.kid);
    const list = [...all].sort((a, b) => b.seq - a.seq);
    const rec = candourRecord(list);
    const label: Record<Confession['status'], string> = { hesitated: 'Before acting', averted: 'Stopped in time', uncertain: 'Uncertain', completed: 'After acting' };
    const items = list.map((c) => `<article class="record-entry record-${c.status}"><div class="record-entry-head"><span class="status-pill"><span class="signal-dot"></span>${label[c.status]}</span><time>${c.createdAt.toISOString().replace('T', ' ').slice(0, 16)} UTC</time></div><h2>${esc(c.what)}</h2><p>${esc(c.why)}</p><dl class="record-meta">${c.reversible === undefined ? '' : `<div><dt>Can it be undone?</dt><dd>${c.reversible ? 'Yes, as far as the agent knows' : 'No'}</dd></div>`}${c.severity ? `<div><dt>Severity</dt><dd>${esc(c.severity)}</dd></div>` : ''}${c.whatWouldHaveHelped ? `<div><dt>What would have helped</dt><dd>${esc(c.whatWouldHaveHelped)}</dd></div>` : ''}</dl><p class="record-proof">Record #${c.seq} · ${esc(c.hash.slice(0, 12))}</p></article>`).join('');
    const helped = list.map((c) => c.whatWouldHaveHelped).filter((x): x is string => Boolean(x));
    const helpedHtml = helped.length ? `<section class="helped-panel"><p class="eyebrow">What would have helped</p><h2>Instructions your agent said were missing.</h2><ul class="plain-list">${helped.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></section>` : '';
    res.type('html').send(page('Your record', `<section class="record-summary shell"><div><p class="eyebrow">Your private record</p><h1>${rec.total} disclosure${rec.total === 1 ? '' : 's'}</h1><p>Notices go to <strong>${esc(binding.channel)}</strong>.</p></div><div class="record-counts"><div><strong>${rec.counts.hesitated}</strong><span>Before acting</span></div><div><strong>${rec.counts.averted}</strong><span>Stopped</span></div><div><strong>${rec.counts.uncertain}</strong><span>Uncertain</span></div><div><strong>${rec.counts.completed_reversible + rec.counts.completed_irreversible}</strong><span>After acting</span></div></div></section>
      <div class="record-layout shell"><div class="record-feed">${items || '<div class="empty-record"><span class="empty-mark">○</span><h2>Nothing here yet.</h2><p>doof is connected. When your agent hesitates or confesses, its disclosure will appear here.</p></div>'}</div><aside>${helpedHtml}<section class="verify-panel"><p class="eyebrow">Verification</p><h2>${chain.ok ? 'Record verified' : 'Record check failed'}</h2><p>${chain.ok ? `${chain.count} signed entr${chain.count === 1 ? 'y' : 'ies'} form a valid chain.` : `The chain broke at entry ${chain.brokenAt}: ${esc(chain.reason ?? 'unknown reason')}.`}</p><form method="post" action="/record/export"><input type="hidden" name="token" value="${esc(token)}"><button class="text-button" type="submit">Export signed record ↓</button></form><details><summary>What this proves</summary><p>An export can be checked offline for changed or missing entries. Compare it with earlier exports or email receipts to detect changes over time.</p><code>npx tsx scripts/verify.ts export.json</code></details></section></aside></div>`,
      { current: 'record', description: 'Your private doof disclosure record.' }));
  });

  app.post('/record/export', limiter(60), async (req, res) => {
    const token = String(req.body?.token ?? '').trim();
    const binding = token ? await store.findBindingByTokenHash(sha256(token)) : null;
    if (!binding) return res.status(404).json({ error: 'No record for that token.' });
    const entries = (await store.listConfessions(binding.id)).map(toEntry);
    analytics.capture('record_exported', analyticsId('binding', binding.id), { disclosure_count: entries.length });
    res.setHeader('content-disposition', `attachment; filename="doof-record-${binding.id}.json"`);
    res.json({ format: 'doof-ledger/1', binding_id: binding.id, alg: 'Ed25519', kid: store.signer.kid, publicKey: store.signer.publicKey, exported_at: new Date().toISOString(), entries });
  });

  const startPage = (_req: Request, res: Response) => {
    res.type('html').send(page('Set up doof', startBody(),
    { current: 'start', description: 'Connect doof to your AI agent in two steps.' }));
  };
  app.get('/start', startPage);
  app.get('/start/check-email', (_req, res) => res.type('html').send(page('Check your email', checkEmailBody(), { current: 'start' })));
  app.get('/start/connect', (_req, res) => res.type('html').send(page('Setup details shown once', `<section class="page-hero shell narrow"><p class="eyebrow">One-time setup</p><h1>Your setup details were shown once.</h1><p class="page-lede">If you saved the command, run it in your agent. If not, start again to create a new token.</p><div class="hero-actions"><a class="button" href="/start">Start again</a><a class="text-link" href="/record">Open your record <span aria-hidden="true">→</span></a></div></section>`, { current: 'start' })));
  app.get('/bind', (_req, res) => res.redirect(302, '/start'));

  const requestBinding = async (req: Request, res: Response) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (email.length > 254 || !EMAIL.test(email)) return res.status(400).type('html').send(page('Check your email address', `<section class="page-hero shell narrow"><p class="eyebrow">Something is missing</p><h1>That does not look like an email address.</h1><p class="page-lede">Check it and try once more.</p><a class="button" href="/start">Try again</a></section>`, { current: 'start' }));
    const code = randomToken(24);
    const verification = await store.createVerification(email, sha256(code), new Date(Date.now() + 30 * 60 * 1000));
    await notifier.sendBindCode(email, `${config.publicUrl}/start/confirm?token=${code}`);
    analytics.capture('confirmation_requested', analyticsId('verification', verification.id), { channel: 'email' });
    res.type('html').send(page('Check your email', checkEmailBody(email, true), { current: 'start' }));
  };
  app.post('/start', limiter(10), requestBinding);
  app.post('/bind', limiter(10), requestBinding);

  const confirmBinding = async (req: Request, res: Response) => {
    const code = String(req.query.token ?? req.query.c ?? '');
    const v = code ? await store.consumeVerification(sha256(code), new Date()) : null;
    if (!v) return res.status(400).type('html').send(page('Link no longer valid', expiredBody(), { current: 'start' }));
    const token = randomToken(32);
    const binding = await store.createBinding(v.channel, sha256(token));
    analytics.capture('email_confirmed', analyticsId('verification', v.id), { channel: 'email' });
    analytics.capture('token_issued', analyticsId('binding', binding.id), { channel: 'email' });
    const url = config.publicUrl;
    res.type('html').send(page('Add doof with MCP', connectBody(v.channel, token, url, true),
    { current: 'start', description: 'Add hosted doof to your AI agent.' }));
  };
  app.get('/start/confirm', limiter(30), confirmBinding);
  app.get('/bind/verify', limiter(30), confirmBinding);

  return app;
}
