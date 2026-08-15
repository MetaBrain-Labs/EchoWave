# AGENTS.md

## Mission

Act as a pragmatic software-engineering agent. Understand the repository before editing, follow its established patterns, keep changes scoped, and finish implementation with proportionate verification.

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

## Preferred Technology Choices

### JavaScript and TypeScript

- Prefer TypeScript for application code and preserve strict typing at module and network boundaries.
- Prefer the repository's current package manager; for new JavaScript/TypeScript repositories, prefer `pnpm`.
- For a new multi-package JavaScript/TypeScript repository, prefer pnpm workspaces. Add Turbo only when multiple packages need a coordinated build graph or caching.
- Reuse existing validation libraries and schemas for untrusted or persisted data.
- Preserve project references, module format, path aliases, and package export conventions already in use.

### Frontend

- For new frontend work, prefer Vite, React, TypeScript, and Tailwind CSS.
- In an existing frontend, preserve its established stack unless migration is explicitly requested. Do not introduce a second framework or styling system for one feature.
- Prefer Tailwind utilities for new styling. Use native HTML, CSS, and browser capabilities before adding JavaScript or a component dependency.
- For data-heavy application interfaces that need a component library, prefer Ant Design and use Tailwind for layout and local styling. Do not add a component library when native elements are sufficient.
- Keep the application shell focused on providers, routing, and composition. Put API clients, reusable hooks, mapping, routing helpers, utilities, shared components, and page orchestration in focused modules.
- Keep server data authoritative. Use browser storage only for non-authoritative UI preferences unless offline-first behavior is explicitly required.
- Preserve accessibility basics: semantic elements, labels, keyboard behavior, focus management, and readable loading and error states.
- Render untrusted rich content through safe structured renderers; do not bypass escaping with raw HTML injection.

### Backend and Persistence

- For new TypeScript HTTP APIs, prefer Hono with Zod validation when it fits the deployment target.
- For relational persistence, prefer PostgreSQL with Prisma. Use Redis and BullMQ only when there is a real queue, retry, scheduling, or distributed-coordination requirement.
- Validate inputs at trust boundaries and return compact, actionable errors without leaking secrets, provider stacks, or large internal payloads.
- Keep database writes, external side effects, and retries explicit and idempotent where practical.
- Treat migrations and generated clients as part of contract changes; run commands from the location expected by the repository.
- Verify that required tables, migrations, queues, caches, and environment variables exist instead of assuming setup scripts created them.

### AI and Agent Systems

- Write all model-facing instructions, tool names and descriptions, parameter descriptions, and model-consumed schema metadata in English unless the product explicitly requires another language.
- Keep tool authorization centralized and grant each Agent only the capabilities it needs.
- Prefer structured outputs and deterministic validation for exact invariants. Leave semantic judgment to the responsible model with sufficient context rather than encoding fragile keyword rules.
- Preserve Agent identity, tool-call identity, provenance, and lifecycle state across runtime events, persistence, and UI rendering.
- Filter internal helpers, secrets, large state snapshots, and implementation details from user-visible streams and stored messages.
- Make interruption, stop, retry, and resume behavior explicit. Preserve completed unaffected work during recovery.

## Code and Documentation

- Match the repository's naming, formatting, testing, and documentation conventions.
- For new TypeScript and TSX files, prefer a concise JSDoc file header that states responsibility and boundaries when the repository uses this convention.
- Document public or business-critical functions, types, classes, services, repositories, controllers, hooks, Agents, workflow nodes, and non-obvious state transitions.
- Comments should explain business intent, invariants, or trade-offs, not restate syntax.
- Chinese comments or JSDoc are acceptable for human-facing source documentation when consistent with the repository, but never place them inside English model-facing prompts.
- Do not commit generated build output, caches, runtime state, secrets, or local environment files.

## Verification

- Leave one focused runnable check for non-trivial new logic when the repository has no suitable existing test.
- Run the narrowest useful check first, then broaden according to risk and affected package boundaries.
- Build or generate shared dependencies before validating consumers when the repository requires it.
- Test the failure or edge case that motivated a bug fix, not only the happy path.
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
