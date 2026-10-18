# Security

FounderOS is a self-hosted, single-founder tool. It is not multi-tenant and does not ship with user accounts. Protect your instance with `APP_PASSWORD` and run it behind HTTPS.

## Reporting a vulnerability

Please do not open a public issue for security problems. Email the maintainer listed in `package.json` or use GitHub's private vulnerability reporting on this repository. You will get a reply within a week.

## What is and is not in scope

In scope:

- Authentication bypass of the `APP_PASSWORD` guard.
- Injection through lead, proposal, or chat input reaching the database or the shell.
- Secrets leaking to the browser or to logs.

Out of scope:

- Prompt injection that only affects the content of an AI-drafted email the founder reviews before sending.
- Issues that require the attacker to already hold the instance password or server access.

## Operational notes

- AI provider keys are read from the server environment only. The browser never sees them.
- The Puter.js provider relies on a browser session token and is kept for backwards compatibility. Do not use it on a public instance.
- Sessions are an HMAC of a server secret. Rotating `APP_PASSWORD` or `SESSION_SECRET` signs every browser out.
- The MCP endpoint (`/mcp`) is separate from `APP_PASSWORD` and stays disabled until `MCP_TOKEN` is set to at least 24 characters. The token is accepted as a bearer header or as the last path segment (for ChatGPT, which cannot send custom headers). Path tokens are redacted from request logs. Anyone holding the token can read and edit the pipeline, so rotate it if a connector URL leaks.
