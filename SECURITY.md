# EchoWave Security Policy

**English** | [简体中文](./SECURITY.zh-CN.md)

## Supported state

EchoWave `v0.1` is a development preview with no stable release branch or downloadable production release yet. Security fixes target only the latest code on the default branch; historical commits, forks, and locally modified deployments are outside the supported scope.

The API uses a fixed development tenant and does not provide real authentication, RBAC, rate limiting, or a complete public-internet boundary. HTTP is permitted on localhost and trusted private networks. Every cloud-hosted or public App server must use HTTPS, a reverse proxy, narrowly scoped network access, backups, and monitoring, while keeping API port 3001 and PostgreSQL port 5432 off the public internet. These measures do not replace missing application-level authorization and do not make this preview suitable as a public multi-user service.

## Reporting a vulnerability

Do not disclose exploit code, real credentials, user data, or unredacted audio in public issues, discussions, pull requests, logs, or screenshots.

Prefer GitHub **Security → Report a vulnerability** for a private report. If private reporting is unavailable, open a public issue titled `[Security] Request private contact` without technical details and include only the affected area and a contactable GitHub account. A maintainer will provide a private communication path.

Include where possible:

- The affected commit, component, deployment mode, and platform.
- The impact and prerequisites for exploitation.
- Minimal reproduction steps containing no real data.
- Known mitigations and whether the issue has already been disclosed.

Allow reasonable time for confirmation, remediation, and release coordination before publication. Maintainers will acknowledge reports when repository capacity permits, but no fixed response or remediation timeline is currently promised.

## Sensitive-data boundaries

- Never commit `apps/api/.env`, `deploy/self-hosted/api.env`, Local Credential YAML, Database Credentials, keystores, or Firebase service accounts.
- Never put `CONFIGURATION_ADMIN_TOKEN`, provider API keys, OSS secrets, callback tokens, signed URLs, or audio content in issues, fixtures, or diagnostic attachments.
- Mobile `EXPO_PUBLIC_*` values are bundled publicly and must never contain secrets.
- AI execution reports and raw ASR response diagnostics are disabled by default. If enabled, inspect redaction and restrict directory access and retention.
- HTTP is only for localhost, trusted LANs, and other private addresses explicitly accepted by the App. Public addresses require HTTPS. A publicly trusted IP-address certificate may be used without a domain, but its short-lived certificate must renew automatically.

See the [configuration guide](./docs/configuration.md), [Server deployment guide](./docs/server-deployment.md), and [self-hosting guide](./docs/self-hosting.md).
