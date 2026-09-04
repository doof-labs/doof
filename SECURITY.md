# Security

Please do not open a public issue for a vulnerability that could expose private disclosure records, email addresses, bearer tokens, signing keys, or service credentials.

Report it privately through [GitHub Security Advisories](https://github.com/doof-labs/doof/security/advisories/new). Include the affected route or component, reproduction steps, impact, and any suggested mitigation. Do not include real user data.

## Supported version

Until the first stable release, only the current `main` branch is supported.

## Important deployment boundaries

- Treat `DOOF_SIGNING_KEY`, `DATABASE_URL`, `RESEND_API_KEY`, and every bearer token as secrets.
- Use HTTPS in production.
- Set `ALLOWED_HOSTS` to the actual public hostname.
- Set `TRUST_PROXY` only to the number of reverse proxies you operate in front of doof.
- Keep previews disabled in production.
- Back up Postgres and the signing key together. Losing or rotating the key changes the verification identity of the record.
