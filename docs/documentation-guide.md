# EchoWave Documentation Guide

**English** | [简体中文](./documentation-guide.zh-CN.md)

This guide maps every human-maintained Markdown document to its audience, authority, and update trigger. English files without a language suffix are the default entry points; each user-facing document has a `.zh-CN.md` Simplified Chinese counterpart. Source, configuration, and ordered SQL migrations remain authoritative for implementation facts.

## Primary entry points

| English / Simplified Chinese                                                    | Audience                           | Boundary                                                                                       |
| ------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| [README](../README.md) / [中文](../README.zh-CN.md)                             | Users, contributors, maintainers   | Product, quick start, self-hosting entry, commands, boundaries; avoid duplicating topic detail |
| [Documentation index](./README.md) / [中文](./README.zh-CN.md)                  | Everyone                           | Short topic index; update when topic files change                                              |
| [This guide](./documentation-guide.md) / [中文](./documentation-guide.zh-CN.md) | Readers and doc maintainers        | Document ownership and maintenance, not topic content                                          |
| [`AGENTS.md`](../AGENTS.md)                                                     | Engineering agents and maintainers | Internal repository execution rules; intentionally not localized as a user guide               |

## Governance and contribution

| English / Simplified Chinese                                          | Audience                  | Authority                                                                                  |
| --------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| [Roadmap](../ROADMAP.md) / [中文](../ROADMAP.zh-CN.md)                | Users and maintainers     | Direction, completion signals, non-commitments; no promised dates                          |
| [Contributing](../CONTRIBUTING.md) / [中文](../CONTRIBUTING.zh-CN.md) | Contributors              | Toolchain, architecture constraints, verification, issues and PRs                          |
| [Security](../SECURITY.md) / [中文](../SECURITY.zh-CN.md)             | Deployers and researchers | Supported scope, private reporting, sensitive boundaries                                   |
| [Pull request template](../.github/PULL_REQUEST_TEMPLATE.md)          | Contributors              | GitHub form/template rather than a standalone user document; not localized as a topic pair |

## Architecture and data

| English / Simplified Chinese                                                 | Audience                              | Authority                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| [Architecture](./architecture.md) / [中文](./architecture.zh-CN.md)          | API, mobile, architecture maintainers | Current module structure, contracts, workflows, safety boundaries |
| [Database schema](./database-schema.md) / [中文](./database-schema.zh-CN.md) | API/database maintainers              | Ordered migrations are authoritative for exact schema             |
| [Domain language](./domain-language.md) / [中文](./domain-language.zh-CN.md) | Product, design, engineering          | Stable business terms, not implementation                         |

## Configuration, runtime, and deployment

| English / Simplified Chinese                                                                                   | Audience                      | Authority                                                     |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| [Configuration and Credentials](./configuration.md) / [中文](./configuration.zh-CN.md)                         | Deployers, API maintainers    | Environment templates, parsers, settings API                  |
| [Audio Runtime Modes](./audio-runtime-modes.md) / [中文](./audio-runtime-modes.zh-CN.md)                       | Product/audio maintainers     | Contracts, migrations, runtime services                       |
| [Server Deployment](./server-deployment.md) / [中文](./server-deployment.zh-CN.md)                             | Self-hosted users             | Compose, environment templates, network/security policy       |
| [Automated Audio Analysis](./audio-analysis-automation.md) / [中文](./audio-analysis-automation.zh-CN.md)      | Product/mobile/workers        | Batch contracts, workers, migrations, push outbox             |
| [Android Device E2E](./mobile-e2e.md) / [中文](./mobile-e2e.zh-CN.md)                                          | Mobile/API/test maintainers   | `.maestro` and Android orchestration                          |
| [Android E2E Troubleshooting](./mobile-e2e-troubleshooting.md) / [中文](./mobile-e2e-troubleshooting.zh-CN.md) | Mobile/API/test maintainers   | Preserved run evidence and current runner behavior            |
| [Self-hosting and App Builds](./self-hosting.md) / [中文](./self-hosting.zh-CN.md)                             | Self-hosted users and forks   | Server entry, EAS/Firebase, Development/Production Builds     |
| [GitHub Releases](./releases.md) / [中文](./releases.zh-CN.md)                                                 | Users and release maintainers | Release workflow, manifest, upgrade and rollback              |
| [Bundled Server README](../deploy/release/README.md) / [中文](../deploy/release/README.zh-CN.md)               | Server ZIP users              | Version/digest/template variables injected by release tooling |

## Design and resources

| English / Simplified Chinese                                                                                                      | Audience                   | Authority                                                               |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| [Design System](./design-system.md) / [中文](./design-system.zh-CN.md)                                                            | Product/design/mobile      | Shared theme tokens and accepted UI behavior                            |
| [Font assets](../apps/mobile/assets/fonts/README.md) / [中文](../apps/mobile/assets/fonts/README.zh-CN.md)                        | Mobile/license maintainers | Bundled files, upstream sources, checksums, licenses                    |
| [Silero VAD asset](../apps/api/assets/silero-vad/v6.2.1/README.md) / [中文](../apps/api/assets/silero-vad/v6.2.1/README.zh-CN.md) | Audio/license maintainers  | Pinned ONNX version, source, checksum, license                          |
| [E2E knowledge fixture](../.maestro/fixtures/echowave-e2e-knowledge.md)                                                           | Android E2E                | Fixed test content, not a user document and intentionally not localized |

## Maintenance rules

- Canonical English user documentation uses the unsuffixed `.md` path. Its Simplified Chinese peer uses `.zh-CN.md`. Put `English` first in every language switcher.
- Keep both language versions in the same change whenever behavior, commands, fields, warnings, or links change.
- Every executable command must state or imply the correct working directory. Run Expo/EAS only from `apps/mobile` or through the mobile workspace.
- Use `<API_PORT>` and `<SERVER_LAN_IP>` placeholders in examples unless documenting a template's actual default.
- Claims such as published, built, or verified require current evidence; describe future flows conditionally.
- Update authoritative contracts or migrations before explanatory docs, then converge README summaries.
- Add every new canonical `docs/*.md` topic to the documentation index and this guide. Add its `.zh-CN.md` peer at the same time.
- Do not localize internal instruction files, GitHub form templates, licenses, or test fixtures merely to satisfy document pairing.
- Run `pnpm docs:check` before submission and `pnpm check` for a complete delivery.
