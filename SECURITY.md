# Security Policy

## Supported Versions

Security fixes are handled on the current `main` branch unless a release branch is announced.

## Reporting A Vulnerability

Please do not open a public issue with secrets, exploit details, private URLs, logs, or user data.

Report security issues privately through GitHub Security Advisories for this repository. Include:

- affected version or commit
- clear reproduction steps
- expected impact
- any relevant logs with secrets removed

## Secret Handling

Do not commit `.env`, API keys, generated media, local databases, provider responses, or runtime logs.

Media Studio uses local env files for:

- `KIE_API_KEY`
- `MEDIA_STUDIO_CONTROL_API_TOKEN`
- optional prompt enhancement provider keys

Use `.env.example` as a template only. Real local values must stay untracked.
