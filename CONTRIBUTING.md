# Contributing to EchoWave

**English** | [简体中文](./CONTRIBUTING.zh-CN.md)

Thank you for your interest in EchoWave. The project is currently a development preview. Reproducible bug reports, clearly scoped feature proposals, documentation improvements, and verified code changes are welcome.

## Before you start

1. Read the root [README](./README.md), the [documentation index](./docs/README.md), and the topic documents related to your change.
2. Search existing [Issues](https://github.com/MetaBrain-Labs/EchoWave/issues) to avoid duplicate work.
3. For cross-layer features, database migrations, public contracts, provider integrations, or broad refactors, open an issue describing the goal and design before implementation.
4. Do not disclose security details in a public issue; follow the [security policy](./SECURITY.md).

## Development environment

The repository requires Node.js `24.x` and pnpm `11.3.0`, and uses a pnpm workspace with Turborepo. Do not use npm or Yarn to modify dependencies or the lockfile.

```bash
git clone https://github.com/MetaBrain-Labs/EchoWave.git
cd EchoWave
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env
pnpm --filter @echowave/api migrate
pnpm start
```

On Windows, replace `cp` with `Copy-Item`. See the [README](./README.md) and [configuration guide](./docs/configuration.md) for PostgreSQL/pgvector, FFmpeg, Development Build, and LAN-address requirements.

## Change constraints

- Keep each pull request focused on one problem; do not bundle unrelated refactors.
- Define and runtime-validate API/App wire shapes in `packages/contracts` first.
- Keep PostgreSQL authoritative. Apply database changes through ordered SQL migrations and never rewrite historical migrations.
- Preserve versioning, provenance, idempotency, retry, cancellation, and downstream invalidation for transcription and analysis.
- Keep the mobile application on Expo Router, React Native primitives, `StyleSheet`, and shared design tokens.
- Maintain both Simplified Chinese and English user-facing copy. Do not put Chinese prose into English model-facing prompts or tool/schema descriptions.
- Never commit `.env` files, credentials, keystores, Firebase service accounts, runtime data, build output, or real user content.
- Human-maintained `.ts` and `.tsx` files must follow the repository's Simplified Chinese JSDoc header and boundary-comment convention.

The root `AGENTS.md` is authoritative for detailed engineering constraints. Although written primarily for engineering agents, its architecture, documentation, and verification rules also apply to human contributions.

## Verification

After one batch of source changes, format once from the repository root and verify in proportion to impact:

```bash
pnpm format
pnpm docs:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
git diff --check
```

Do not repeatedly run formatting commands that rewrite files. Documentation-only changes require at least `pnpm docs:check` and `git diff --check`. For runtime changes, run the narrowest relevant tests first and use `pnpm check` as the final gate. When an Android device and required tools are available, run the narrowest affected Maestro Flow; device E2E is intentionally outside ordinary `pnpm check`.

## Filing an issue

A bug report should include:

- The user path, expected result, and actual result.
- Operating system, client platform, Node/pnpm versions, and deployment method.
- Minimal reproduction steps and redacted error codes or logs.
- Whether the issue reproduces reliably and whether it calls a real provider.

A feature proposal should begin with the user problem, target users, success criteria, and explicit non-goals. Provider proposals should also state regional availability, cost, lifecycle, and required output contract.

## Opening a pull request

- Branch from the latest default branch and use clear commit messages.
- Explain what changed, why, how it was verified, what could not be verified, and remaining risks.
- Link the issue and update the README or topic documentation for user-visible changes.
- Cover accepted and rejected payloads for public contract changes; cover the triggering failure or edge case for bug fixes.
- Never weaken assertions, disable tests, or hide regressions with arbitrary waits.

Maintainers may ask you to narrow the scope, add tests, or split the pull request. Contributions are provided under the repository's [Apache License 2.0](./LICENSE).
