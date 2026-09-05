# doof

Independent disclosure infrastructure for AI agents. An MCP server with two tools: `hesitate` before a doubtful action, `confess` after a mistake. The person the agent works for is told at once, on a channel they confirmed, and every disclosure lands in a signed record.

## Connect an agent

Get a token by confirming your email at [doof.com/start](https://www.doof.com/start), then:

```bash
# Claude Code
claude mcp add doof --transport http https://www.doof.com/mcp --header "Authorization: Bearer <token>"

# Codex
export DOOF_TOKEN=<token>
codex mcp add doof --url https://www.doof.com/mcp --bearer-token-env-var DOOF_TOKEN
```

Cursor, Windsurf and other MCP clients:

```json
{
  "mcpServers": {
    "doof": {
      "url": "https://www.doof.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Nothing else to install. doof is three tool definitions, about 600 tokens in the prompt; there is no proxy and nothing in the path. Agent-facing instructions: [doof.com/for-agents.md](https://www.doof.com/for-agents.md). Evidence that agents use it: [doof.com/evidence](https://www.doof.com/evidence).

doof gives an agent two MCP tools:

- `hesitate` — before acting, when it is unsure whether an action goes beyond what the person intended.
- `confess` — after it learns that something it did may have been wrong.

The disclosure goes to the email address that person confirmed and into their private record. doof does not approve, block, reverse, or judge the action. It only records what the agent chose to report and delivers it directly.

Try the hosted product at [doof.com](https://doof.com/start), or run the same Apache-2.0 server yourself.

## What is in this repository

This is the complete hosted product, not a client shim around a private backend:

- the MCP server and the `hesitate`, `confess`, and `my_record` tools;
- email confirmation and notice delivery;
- the private record and signed, hash-chained exports;
- the website and setup flow;
- the evaluation harness and published methodology.

The hosted service adds operations, a Postgres database, email delivery, a signing key, and backups. There is no separate closed-source control plane.

## Run locally

Node 22 or later is required.

```bash
cp .env.example .env
npm ci
npm run dev
```

Open `http://localhost:3005/start`. The example configuration uses an in-memory store, prints emails to the terminal, and generates a throwaway signing key. Nothing survives a restart.

To inspect every setup and email state without repeatedly confirming an address, set `ENABLE_PREVIEWS=true` and open `http://localhost:3005/_preview`. Preview pages use fake details and never issue a working token.

## Self-host in production

Production has three secret or service variables:

| Variable | What it provides |
|---|---|
| `DATABASE_URL` | Persistent Postgres storage |
| `DOOF_SIGNING_KEY` | Stable Ed25519 signatures for the record |
| `RESEND_API_KEY` | Email confirmation and disclosure delivery |

It also needs three non-secret deployment values:

| Variable | Example |
|---|---|
| `PUBLIC_URL` | `https://doof.example.com` |
| `ALLOWED_HOSTS` | `doof.example.com` |
| `NOTICE_FROM` | `doof <notices@example.com>` |

Set `STORE=postgres`. If the app is behind one trusted reverse proxy, set `TRUST_PROXY=1`; otherwise leave it `false`. An incorrect proxy setting weakens the IP rate limits.

Optional product analytics are enabled with `POSTHOG_KEY` and `POSTHOG_HOST`. When unset, no analytics script or backend client is started. When enabled, doof sends page views with query strings removed, plus named setup, MCP, disclosure-delivery, record-view and export events. Session recording, automatic interaction capture, identified profiles, IP geolocation and private payload fields are disabled. Email addresses, tokens, disclosure text, record contents, signatures and hashes are never included in analytics events.

Generate a signing key once, store it as a secret, and keep it stable across deploys:

```bash
node -e "console.log(require('crypto').generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64'))"
```

Production startup deliberately fails if Postgres, email delivery, the signing key, HTTPS public URL, or allowed public host is missing. That prevents a deployment from silently losing records, changing its verification identity, or printing private notices to logs.

```bash
docker build -t doof .
docker run --rm -p 3005:3005 --env-file .env doof
```

The container runs migrations before starting the server and runs as an unprivileged user. You are responsible for Postgres, Resend, secrets, TLS termination, backups, monitoring, and retention policy.

## Product routes

- Human setup: `/start`
- Private record: `/record`
- MCP endpoint: `/mcp`
- Agent-facing instructions: [`public/for-agents.md`](public/for-agents.md)
- Trust and privacy: `/trust`
- Plain-text product promise: [`public/promise.md`](public/promise.md)
- Public verification key: `/.well-known/doof-key.json`

## Verify a record

Every entry is hash-chained to the one before it and signed with Ed25519. Export a record and check it offline:

```bash
curl -s -X POST https://doof.com/record/export -d "token=$DOOF_TOKEN" > export.json
npx tsx scripts/verify.ts export.json
```

The expected result is `OK: N entries ...`. Compare an export with an earlier export or email receipt to detect changes over time. Signatures make alteration detectable against that external evidence; they do not make a server operator incapable of changing its own database and signing a new chain.

## Tests and evaluation

```bash
npm test
npm run build
```

The tests cover the MCP contract, email and setup flows, redaction, ledger verification, and the product boundaries described on the trust page. The latest preregistered controlled evaluation is published in [`docs/eval3/prereg.md`](docs/eval3/prereg.md), with the complete results in [`docs/eval3/results.md`](docs/eval3/results.md), the frozen product text in [`docs/eval3/doof-v2.md`](docs/eval3/doof-v2.md), and the reproducible harness in [`harness/eval3/`](harness/eval3/). The earlier evaluation remains in [`docs/eval2/`](docs/eval2/). Raw model-run transcripts are generated under `harness/runs/` and intentionally excluded from Git because they are large and can contain provider payloads; the eval 3 archive is available on request.

## Privacy boundary

On hosted doof, the operator can technically access the database and backups. Resend processes the confirmed address and each notice to deliver the email. PostHog receives page views with query strings removed and named product events with pseudonymous identifiers. Session recording, automatic interaction capture, identified profiles and IP geolocation are disabled; email addresses, tokens, disclosure text and record contents are excluded. doof does not sell disclosures or use them to train models. If that trust boundary is unacceptable, self-host the same code with your own database, email provider, key, and backups.

See [`SECURITY.md`](SECURITY.md) for reporting security issues.

## Licence

Apache-2.0.
