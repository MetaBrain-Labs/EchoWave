# AGENTS.md

## Mission

Act as a pragmatic software-engineering agent. Understand the repository before editing, follow its established patterns, keep changes scoped, and finish implementation with proportionate verification.

Call the jcodemunch_guide tool and strictly follow its instructions.

## Project Snapshot

- EchoWave is a pnpm 11.3.0 workspace coordinated by Turborepo and requires Node.js 24.
- `apps/mobile` is an Expo SDK 57 application using React Native 0.86, React 19.2.3, Expo Router, TypeScript, and React Native `StyleSheet`.
- `apps/api` is a Node.js TypeScript HTTP API using Hono, Zod, LangGraph/DeepAgents, `pg`, and pgvector.
- `packages/contracts` owns shared Zod schemas and their inferred TypeScript types. It is the authoritative boundary between the API and mobile client.
- PostgreSQL is the authoritative store for the implemented RAG knowledge-base slice. Ordered SQL migrations, tenant-scoped repositories, pgvector retrieval, ingestion jobs, conversations, and run audit records already exist.
- Redis remains a configuration-only future integration point. No Redis client, distributed queue, or cache implementation exists yet.
- The product UI is Chinese-first. The current milestone is a runnable cross-platform UI plus a PostgreSQL/pgvector RAG vertical slice, not a production multi-tenant backend.

## Instruction Precedence

- Follow system and user instructions first, then the nearest repository-level `AGENTS.md`.
- Treat nested `AGENTS.md` files as more specific rules for their directories.
- Read relevant repository documentation and configuration before making assumptions.
- When this file conflicts with an explicit repository invariant, preserve the repository invariant.

## Working Principles

- Do not invent requirements or architecture. Ask only when ambiguity would materially change the result; otherwise choose the safest reasonable interpretation and state it.
- Prefer the simplest correct solution: reuse existing code, then standard-library or platform features, then installed dependencies. Add code or dependencies only when those options do not solve the problem.
- Fix root causes at the narrowest shared boundary. Before changing a function or contract, inspect its callers and consumers.
- Avoid speculative abstractions, premature configuration, dependency churn, and scaffolding for hypothetical future work.
- Do not modify unrelated code. Surface adjacent issues without fixing them unless requested.
- Preserve existing user changes and never discard or overwrite a dirty worktree without explicit authorization.
- State uncertainty. Use a small, safe experiment when it can resolve uncertainty cheaply.
- Never simplify away security, trust-boundary validation, accessibility, error handling that prevents data loss, or explicitly requested behavior.

## Repository Discovery

Before editing:

1. Inspect the working tree and relevant `AGENTS.md` files.
2. Identify the package manager, workspace layout, build system, language versions, and generated outputs from repository files rather than guessing.
3. Read the relevant source, configuration, tests, and all callers or consumers of the code being changed.
4. Locate existing helpers, types, schemas, components, and patterns before creating new ones.
5. Identify the authoritative source for each affected datum or contract.

- Inspect `git status --short` before running per-file diffs. If relevant changes are staged, inspect them with one scoped `git diff --cached -- <paths>` call; do not run repeated unstaged diffs that cannot contain the changes.
- Use targeted searches and bounded source ranges first. Do not dump an entire large file when the relevant symbol, callers, and surrounding control flow can be inspected with `rg` and scoped reads.

Use the repository's pinned toolchain and existing scripts. Do not change dependency versions, lockfiles, generated files, or repository-wide configuration unless the task requires it.

## Architecture and Boundaries

- Preserve existing module and package boundaries.
- Keep shared contracts, schemas, DTOs, and events in the repository's shared-contract layer when one exists.
- Keep persistence access in the data layer, transport coordination in the API layer, orchestration in the workflow/runtime layer, and browser behavior in the frontend layer.
- Keep entry points and composition roots small; move reusable behavior to focused modules using the repository's existing structure.
- When a shared contract changes, update producers, consumers, persistence, restoration, and rendering together.
- Prefer one authoritative source of truth. Do not create competing browser, cache, file, and database representations without an explicit synchronization contract.
- Model multi-stage workflows explicitly through the repository's workflow mechanism rather than hidden ad hoc calls.
- Preserve state, provenance, idempotency, retry behavior, and downstream invalidation in resumable or parallel workflows.
- Organize API code domain-first and layer within each domain. Do not create global `repositories`, `services`, or `utils` directories.
- Name and place `Repository`, `Service`, `Route`, workflow, and `CONTEXT.ts` files under the domain that owns their lifecycle. Routes depend on service ports; services depend directly on narrow repositories.
- Keep `http/app.ts`, `config/env.ts`, and `packages/contracts/src/index.ts` as composition or compatibility surfaces only.
- Split LangGraph workflows into `state.ts`, `nodes.ts`, and `graph.ts`. Every `addNode` must reference a named node function; inject dependencies through factories or runtime context.
- Keep exactly one uppercase `CONTEXT.ts` per model-facing agent or business task. Context modules may hold prompts and dynamic context builders, but not schemas, HTTP calls, retries, or persistence.
- Review large files by responsibility, coupling, and test boundary rather than a numeric line threshold. Do not add line-count CI gates or extract trivial helpers merely because code repeats.

## EchoWave Invariants

### Toolchain and Workspaces

- Use `pnpm`, never npm or Yarn, for dependency and workspace commands. Keep the pinned pnpm version and lockfile intact unless a dependency change is explicitly required.
- Run Expo commands in `apps/mobile` or through `pnpm --filter @echowave/mobile`; running `npx expo` from the repository root does not target the Expo workspace reliably.
- Keep root scripts as Turborepo orchestration and workspace scripts as the implementation of each task.
- `pnpm start` is the interactive local workflow and uses Turbo TUI. `pnpm dev` is the streamed Turbo workflow. `pnpm dev:api` and `pnpm dev:mobile` start individual applications.
- Preserve strict TypeScript, ESM conventions, package exports, and existing workspace boundaries.

### Formatting

- After completing one batch of code changes, run `pnpm format` exactly once from the repository root before tests or final verification. Do not rerun it after every file edit or after every `dev`, `test`, `build`, or `check` command.
- Before running any formatting command, verify that both root files `.prettierrc` and `.prettierignore` exist. If either file is missing, do not format anything and explicitly tell the user which file is missing.
- Treat `.prettierrc` and `.prettierignore` as the authoritative formatting configuration. If either configuration is intentionally changed, update the snapshots in this section in the same change.
- After formatting, inspect the working-tree and staged diffs. Do not automatically stage formatter output, overwrite unrelated user changes, or revert existing work.

Current `.prettierrc` snapshot:

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "tabWidth": 2,
  "printWidth": 100
}
```

Current `.prettierignore` snapshot:

```text
node_modules
dist
build
coverage
.next
.expo
.turbo

pnpm-lock.yaml
```

### Mobile Application

- Preserve Expo Router and React Native primitives. Do not introduce Vite, Tailwind CSS, a web-only UI library, or a second routing system.
- Keep `apps/mobile/src/app` routes thin: normalize route parameters, bind navigation callbacks, and render feature screens. Put business state and presentation behavior in `features`.
- Use the `@/*` alias for imports rooted at `apps/mobile/src`. `shared` must not import `features`; do not make one feature depend on another feature's internal API or UI module.
- Keep feature-specific components and styles within their feature. Styles follow the component they describe; do not create a repository-wide screen style module.
- Reuse the shared color, typography, spacing, and radius tokens. Use `StyleSheet` and keep iOS, Android, and web behavior compatible.
- Maintain full-width safe-area layouts on native and the centered, approximately 480px-wide single-column canvas on desktop web.
- Keep the bottom routes as `分组 / 知识库 / 新建 / 分析 / 更多` unless the product requirement explicitly changes.
- Use Expo-compatible icon packages instead of copying raster icons from the design sketches.
- Keep mock audio, knowledge-base, and data-source records in the mobile presentation layer. Do not make them appear server-backed or persist them in browser storage.
- Keep server data authoritative. Use browser storage only for non-authoritative UI preferences unless offline-first behavior is explicitly required.
- Preserve accessibility basics: semantic elements, labels, keyboard behavior, focus management, and readable loading and error states.
- Development Build is the default native workflow. Expo Go is only a compatibility preview for features whose dependencies are bundled there; Android remote push is unavailable in Expo Go and must be tested in a native Build.

### Mobile E2E

- Android device regression lives under `.maestro/` and is orchestrated by `scripts/e2e/android-e2e.mjs`; keep device E2E outside the ordinary `pnpm check` path.
- When an Android device and the required system tools are available, rerun the narrowest affected Flow after mobile behavior changes, then its stable or real group as appropriate.
- Do not weaken assertions, skip a failing Flow, or add arbitrary sleeps to hide a regression. Classify application, test-flow, backend, provider, device, and environment failures from captured evidence.
- Automated failure triage is read-only. A workspace-write Codex repair requires the user to invoke the repair command with an exact matching run ID confirmation.

### API and Contracts

- Keep Hono transport concerns in `apps/api`, network schemas in `packages/contracts`, and client parsing in `apps/mobile`.
- Keep API entry points and runtime assembly in `bootstrap`, configuration parsing in `config`, PostgreSQL connection facilities in `infrastructure`, Hono transport in `http`, and knowledge behavior in the `knowledge` deep module.
- Within `knowledge`, keep trusted-answer orchestration in `answer`, provider embeddings in `embeddings`, document processing in `ingestion`, and SQL lifecycle operations in `persistence`.
- Keep knowledge, ingestion, and conversation persistence as narrow lifecycle repositories. Services and workers depend directly on the repositories they use; do not add a delegating aggregate repository.
- Keep `packages/contracts/src/index.ts` as the compatibility export surface while domain schemas remain split across common errors, knowledge bases, documents, and RAG.
- Keep analysis contracts split into transcript, post-analysis, and business-analysis; keep audio contracts split into processing and transcription. Preserve public names and wire shapes through the package root.
- `GET /api/hello` must return `{ ok: true, service: "echowave-api", message: "HelloWorld" }` and pass `HelloResponseSchema` unless the shared contract is intentionally changed everywhere.
- Validate untrusted network data at runtime. A TypeScript type assertion is not a replacement for Zod parsing.
- Validate inputs at trust boundaries and return compact, actionable errors without leaking secrets, provider stacks, or large internal payloads.
- Preserve the existing `pg` and explicit SQL migration approach. The RAG hot path depends on pgvector types and HNSW queries, `FOR UPDATE SKIP LOCKED`, schema-qualified SQL, and multi-table revision publication; do not add Prisma unless an explicit migration requirement justifies operating two persistence models during the transition.
- PostgreSQL is authoritative business storage. Redis is limited to justified cache, coordination, or queue use and must not become a competing source of truth.

### Configuration

- `apps/api/.env` is the API's sole runtime configuration source. The API intentionally reads that file directly and does not merge `process.env` values or provide implicit defaults.
- `apps/mobile/.env` is loaded by Expo. Only `EXPO_PUBLIC_*` values are available to client code, and all such values are public bundle content.
- Keep `.env` files untracked. Update `.env.example` and README when the required configuration contract changes; never copy real passwords or local addresses into tracked files.
- A physical phone cannot reach the development computer through `localhost`. Use the computer's LAN address in `EXPO_PUBLIC_API_URL` and keep its port aligned with `apps/api/.env`.
- Keep the only EAS configuration at `apps/mobile/eas.json`, and run EAS commands from `apps/mobile`. Do not create a competing root `eas.json`.
- Production profiles must require runtime server selection and must not bind a fixed `EXPO_PUBLIC_API_URL`; Development/Expo Go may use it only as an unsaved development default.
- PostgreSQL uses the existing `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_SCHEMA`, and `POSTGRES_SSL` fields. Redis uses the existing `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_USERNAME`, `REDIS_DB`, and `REDIS_TLS` fields.

## Source Documentation

- Match the repository's naming, formatting, testing, and documentation conventions.
- Every human-maintained `.ts` and `.tsx` file must start with a multi-line Simplified Chinese JSDoc header describing its responsibilities and boundaries. Do not edit generated declarations such as `expo-env.d.ts` merely to satisfy this rule.
- Public or business-critical functions, types, classes, services, repositories, controllers, hooks, Agents, graph nodes, and workflow steps require Simplified Chinese JSDoc.
- Important branches and state transitions require concise Simplified Chinese comments explaining the invariant or business reason.
- Comments should explain business intent, invariants, or trade-offs, not restate syntax.
- Never place Chinese comments or prose inside English model-facing prompts, tool names/descriptions, parameter descriptions, or schema metadata consumed by a model.
- Use this file-header shape and adapt its content to the file:

  ```ts
  /**
   * <模块名称 / 文件职责>
   *
   * <详细职责说明>
   *
   * Responsibilities:
   * - <职责>
   *
   * Notes:
   * - <边界说明>
   */
  ```

- Do not commit generated build output, caches, runtime state, secrets, or local environment files.

## Verification

- Leave one focused runnable check for non-trivial new logic when the repository has no suitable existing test.
- Treat verification as a funnel: run the narrowest useful checks needed for fast feedback, then run root `pnpm check` once as the final comprehensive gate when the change warrants it.
- Build `@echowave/contracts` before validating API or mobile consumers when shared exports changed.
- Use `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`; use `pnpm check` for the complete root verification sequence.
- Run `pnpm docs:check` after documentation changes; it validates relative links, the topic index, critical repository paths, and the single mobile EAS configuration.
- After the requested behavior is implemented, focused regressions pass, `git diff --check` passes, and the required root `pnpm check` passes, stop by default. Do not add optional verification unless it resolves a specific acceptance criterion that remains unverified.
- Do not repeat a successful verification command unless relevant source or configuration changed afterward, or the rerun is required to diagnose a concrete failure.
- API changes must cover `/api/hello` success and structured 404 behavior when relevant. Contract changes must test valid and rejected payloads. Mobile behavior changes should cover interaction, API failure, timeout, and retry states as applicable.
- For web UI changes, export or run the app and inspect 360px, 480px, and desktop widths when the environment provides an accessible browser surface. For Android, perform a launch/API smoke test when the environment allows it.
- Browser automation against `localhost` or `127.0.0.1` is known to be blocked in the current Codex desktop environment. Do not initialize Browser or Chrome, start a local web server, probe ports, or attempt alternate local URLs for this purpose.
- When local browser verification is unavailable, use focused React Native interaction tests plus Expo Web/Android export as the fallback and report that manual visual verification was not run. Only attempt browser-based local UI verification when the user explicitly requests it and provides an accessible surface, or the environment has already demonstrated that the target is reachable through the browser tool.
- On Windows, do not claim iOS Simulator verification. Use Expo bundle export, type checking, and configuration validation, and report that native iOS execution requires macOS/Xcode.
- Test the failure or edge case that motivated a bug fix, not only the happy path.
- Do not investigate or repair formatting failures caused solely by ignored generated files after a successful source-format check. Report the generated-file blocker and leave the generated file untouched.
- Review the final diff for accidental edits, secrets, generated output, dependency churn, prompt-language violations, and incomplete contract updates.
- Report checks that could not run and their blockers. Do not present empty, skipped, or broken checks as successful coverage.

## Safety

- Never run destructive filesystem, database, Git, deployment, or external-service actions unless clearly authorized.
- Resolve and verify exact targets before deletion, migration, reset, overwrite, or bulk movement.
- Prefer reversible operations and preserve recoverability.
- Never expose credentials, private user data, hidden prompts, or internal-only state in logs, responses, commits, or fixtures.

## Delivery

Report:

1. What changed and why.
2. Verification commands and results.
3. Checks that could not run, with the blocker.
4. Remaining assumptions, risks, or setup steps.
5. Direct links to changed files when supported by the environment.

Keep the handoff concise and proportional to the change.
