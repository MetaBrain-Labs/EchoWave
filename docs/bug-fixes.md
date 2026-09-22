# EchoWave Bug Fix Record

**English** | [简体中文](./bug-fixes.zh-CN.md)

This document records verified defects with their reproduction, root cause, resolution, and verification evidence. It complements topic guides and the [Android E2E troubleshooting record](./mobile-e2e-troubleshooting.md): topic guides describe intended behavior, while this file describes failures that already happened and how they were closed.

## Fixed defects

| ID       | Symptom                                                                                                   | Scope                                                 | Status |
| -------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------ |
| `EW-001` | Web dev server fails with `Unable to resolve module ./apps/mobile/node_modules/expo-router/entry`         | Windows + pnpm workspace links                        | Fixed  |
| `EW-002` | Trusted answer cites `[9]` while the returned citation list ends at `[8]`                                 | Knowledge answer rendering                            | Fixed  |
| `EW-003` | Query screen and history panel log `Text strings must be rendered within a <Text> component`              | Knowledge answer rendering                            | Fixed  |
| `EW-005` | A newer workspace's `ws-` dedicated domain prefix is rejected as an invalid parameter                     | Model Studio workspace migration and connection setup | Fixed  |
| `EW-006` | The AI configuration roster omits knowledge reranking, so it can never be bound                           | AI configuration bindings and knowledge reranking     | Fixed  |
| `EW-007` | Saving a capability binding fails with a unique-constraint 500, so an orphaned binding cannot be repaired | Capability binding writes and knowledge reranking     | Fixed  |

## EW-001: Metro cannot resolve the Expo web entry point on Windows

**Symptom**: `cd apps/mobile && pnpm web` starts Metro, then every page request fails in the terminal and in the browser error overlay:

```text
Metro error: Unable to resolve module ./apps/mobile/node_modules/expo-router/entry from E:\realProject\EchoWave/.:
None of these files exist:
  * node_modules\expo-router\entry(.web.ts|.ts|...|.css)
  * node_modules\expo-router\entry
```

**Affected commands**: `pnpm web` and `pnpm exec expo start --web` from `apps/mobile`. Dev Client startup (`pnpm start`) and the production export were not affected.

**Root cause**: the failure is in dependency linking, not in application code.

1. Expo resolves the project entry point to `apps/mobile/node_modules/expo-router/entry.js`, which is a pnpm junction.
2. Because `apps/mobile` is part of a workspace, `getMetroServerRoot` returns the repository root, so the entry point must be expressed relative to that root.
3. Expo's `convertEntryPointToRelative` collapses the junction through `fs.realpathSync` into `node_modules/.pnpm/expo-router@<version>/node_modules/expo-router/entry.js`.
4. In the failing checkout that call returned the junction path unchanged, producing the module specifier `apps/mobile/node_modules/expo-router/entry`. Metro received a path that its module map could not resolve, so it reported the junction path as missing even though the file existed on disk.

**Resolution**: recreate the dependency tree and start the web dev server with a cleared bundler cache.

```powershell
cd E:\realProject\EchoWave
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force apps\mobile\node_modules -ErrorAction SilentlyContinue
pnpm install

cd apps\mobile
pnpm exec expo start --web --clear
```

**Verification**: after the reinstall, `expo config` and the static web export both resumed working, the entry point resolved into the `.pnpm` directory, and the web page returned `200` without any `Unable to resolve` error.

**Boundaries**: this record does not claim which link state caused the unresolved junction; only that recreating `node_modules` restored resolution. It is unrelated to any source change in `apps/mobile/src`: a stale `node_modules` tree reproduces the same failure for unchanged sources.

## EW-002: valid citations were trimmed, so answer marker `[9]` had no source

**Symptom**: a trusted knowledge answer ends with a marker such as `…与标准作业流程[9]。`, but the citation list below the answer stops at `[8]`. Collapsing and expanding the list cannot reveal the entry. The marker pointed at a real source (a case document such as the ones in a "历史收集" group); the server had discarded a valid citation.

**Affected paths**: the knowledge question-answering screen and its read-only history, including answers already stored in `rag_runs`.

**Root cause**: the citation-correction step treated "at most 8 citations" as a hard limit and compressed citations that had already passed validation.

1. The model wrote `[1]..[9]` in the answer text and returned nine real chunk IDs in `citedChunkIds`.
2. `citation-validation` would have kept all nine IDs.
3. The correction trigger also fired when the count exceeded 8, so the server compressed the set to 8 and numbered the response `1..8` by array index.
4. The answer text was never rewritten, leaving `[9]` without a source. The citation list was not truncated by the UI; the ninth entry was already missing from the server response.

A local execution report reproduces the chain: `retrievedCount: 14`, `citedCount: 8`, citation titles containing the ninth and tenth real sources, and answer markers that stop at `[8]`.

**Resolution**:

- The server no longer treats 8 as a truncation threshold: every ID from the current retrieval allowlist is kept, and `MAX_CITATIONS` (24) only guards against pathological output. `citationCorrectionContext` may now replace disallowed IDs only and must not shorten the answer or break the marker-to-citation mapping.
- `apps/api/src/knowledge/answer/citationMarkers.ts` aligns markers with validated citations before the response is built: markers are renumbered into a continuous `1..N` in first-mention order, a marker is removed only when it exceeds the retained citation count, and allowlist-valid citations the answer never mentions stay in the complete list. `knowledgeAnswer.ts` stores the aligned text and records `droppedMarkerCount` on the `citation-validation` step.
- Mobile display: `apps/mobile/src/features/knowledge/components/citationDisplay.ts` clamps visible numbers into the returned list so answers stored before the server fix also render consistent numbers. The list itself is never trimmed.

**Verification**: `apps/api/test/knowledge/answer/citationMarkers.test.mjs` covers out-of-range markers, first-mention ordering, unmentioned citations, marker-free answers, and idempotency; `deepSeekQueryAgent.test.mjs` asserts that nine valid citations are all retained with a live `[9]` marker, that no correction call is made for allowlist-valid citations, and that after replacing a disallowed ID the markers and citation numbers still correspond one-to-one. `CitationList.test.tsx` asserts that expanding renders the complete list.

**Boundaries**: answers already persisted before the fix keep their original text; only the displayed numbering is normalized. The shared contract `RagCitationSchema.number` is unchanged. Keeping every valid citation makes lists longer, and the mobile client collapses to the first four for readability.

## EW-003: raw text node inside the answer and citation area

**Symptom**: opening the trusted query screen (or the history panel) repeatedly logs `Text strings must be rendered within a <Text> component`. The React Native Fabric renderer validates the parent context when it creates a standalone text instance and prints this error when that parent is not a `Text`.

**Affected paths**: knowledge query screen and read-only history panel.

**Root cause**: a standalone whitespace text node was inserted into the citation card container of the history panel to tweak spacing:

```tsx
<CitationList ... />{' '}
```

`{' '}` is a direct string child of a `View`, so the renderer treats it as text outside a `Text`. The answer markers themselves were not the cause: every string inside `AnswerText` already sits inside a `Text`.

**Resolution**: the whitespace node is gone and spacing comes from styles; markers render as a single template string `[n]` so `[`, the number, and `]` are never split into separate text children.

**Verification**: a shared helper `apps/mobile/src/features/knowledge/testing/renderTextGuard.ts` backs two cases: `AnswerText.test.tsx` asserts the answer subtree has no raw text, and `KnowledgeQueryScreen.test.tsx` asserts the history item subtree (via `testID="query-history-item"`) has none. Both were checked round-trip — they fail when `{' '}` is reinserted and pass once it is removed.

**Boundaries**: the error only appears on the native renderer, so the web build never prints this exact message. The check lives in the component test rather than in source code.

## EW-004: oversized input caret and drifting input text in several screens

**Symptom**: in the knowledge query composer the Android caret is taller than the input text and slightly overflows the field; the same look appears in other screens' single-line inputs.

**Affected paths**: 21 screen and component files with `TextInput` styles, including the knowledge query composer, group drawer, group settings, knowledge editors, data-source dialogs, general settings and the AI configuration center.

**Root cause**: only some inputs implemented design-system section 9. The rest relied on platform defaults and declared a shared `padding` (or `paddingVertical: spacing.sm`) together with `minHeight`: Android then sizes the caret from the font's full line box while the text sits inside a padded box, so the caret exceeds the visible text height. Several of those inputs also inherited vertical alignment from a base style instead of stating it.

**Resolution**:

- `apps/mobile/src/shared/theme/textInput.ts` adds two shared text tokens, `textInputText` (single line: `includeFontPadding: false`, `paddingVertical: 0`, `textAlignVertical: 'center'`) and `multilineTextInputText` (multiline: `includeFontPadding: false`, `textAlignVertical: 'top'`).
- Every `TextInput` style now spreads one of those tokens; single-line inputs state an explicit `height` instead of `minHeight`, and multiline variants override vertical alignment explicitly.
- Container and state styles (`roleInput`, `invalidInput`, `addTagInput`, and unrelated blocks the bulk edit touched in a first pass) keep their original sizing: `roleAddButton`, `segmentationOption` and other `Pressable` styles still use `minHeight`, and `segmentationOption` is asserted by an existing data-source test.

**Verification**: `apps/mobile/src/shared/theme/__tests__/textInputStyles.test.ts` scans every `.tsx` under `src`, resolves each `TextInput` element's style keys and fails when a style has neither the shared token nor an explicit `includeFontPadding: false` plus `textAlignVertical`; it also pins the token rules themselves. Existing metrics assertions for the group drawer and the AI configuration center inputs still pass unchanged.

**Boundaries**: the caret only renders on device, so the fix is verified statically plus through the existing interaction tests; visual confirmation requires an Android build. Multiline text areas intentionally keep their own padding and top alignment.

## EW-005: a newer workspace's `ws-` dedicated domain prefix is rejected as an invalid parameter

**Symptom**: migrating in More → migrate to a workspace domain with the part before the first dot of the console API Host (for example `ws-rcn333095ds1qzij`) plus a region only shows a red `请求参数无效。` line, with no field-level reason, although the same value is the working dedicated domain prefix in the Model Studio console.

**Affected paths**: More → migrate to a workspace domain, AI configuration → create or edit the Qwen (Model Studio) connection, and the startup-only `DASHSCOPE_WORKSPACE_ID` legacy import. All three share `DashScopeWorkspaceIdSchema`.

**Root cause**: the contract mistook the first DNS label of the API Host for a fixed prefix allow-list.

1. `DashScopeWorkspaceIdSchema` in `packages/contracts/src/settings.ts` accepted only `^llm-…$`. The `apiHost` returned by the Alibaba Cloud `CreateWorkspace` and `ListWorkspaces` APIs starts with `llm-…` for early workspaces and `ws-…` for newer ones, so a valid value failed Zod validation.
2. `apps/api/src/http/errorHandler.ts` folds every `ZodError` into 400 plus the fixed text `请求参数无效。`, dropping the field and the reason. The Chinese client renders that text verbatim, so the failure carried no diagnosable information.
3. The migration card performed no local validation, so the only feedback was that generic error after a round trip.

**Resolution**:

- `DashScopeWorkspaceIdSchema` now validates one DNS label: lowercase letters, digits and inner hyphens only, at most 63 characters. Both `llm-…` and `ws-…` pass, while full host names, uppercase and leading or trailing hyphens are still rejected.
- The migration card and the AI configuration field now explain where the value comes from, the placeholder changed from `llm-xxxxxxxxxxxx` to `ws-xxxxxxxxxxxx`, and the card validates against the shared contract before submitting: an invalid shape reports `业务空间域名前缀无效…` without sending a request.
- `docs/configuration*.md` and `apps/api/.env.example` document that the value is the part before the first dot of the console API Host and that the region must match that host.

**Verification**: under `packages/contracts`, `node --test --test-isolation=none "test/settings/settings.test.mjs"` runs the new `accepts every Model Studio workspace domain prefix and rejects non-label values` case, which asserts that `ws-…` derives a dedicated domain, that `llm-…` still works, and that full host names, uppercase, and leading or trailing hyphens are rejected. The `apps/mobile` `TopLevelTabScreens.test.tsx` migration case now uses `ws-echowave` end to end, and the new `rejects a full API Host locally instead of posting an invalid parameter` case asserts local rejection without a request. Root `pnpm check` passes.

**Boundaries**: this fix only covers value validation and diagnosability. The region is still chosen manually and must match the host; the dedicated-domain preview in the card remains the only cross-check, and the fix does not derive the region from the host.

## EW-006: the AI configuration roster omits knowledge reranking

**Symptom**: the capability list under More → AI configuration has no knowledge reranking entry, so its binding state is invisible and there is no way to bind it. With the reranking switch on, More only shows `重排已开启，但百炼业务空间或重排模型尚未配置。` and the query log prints `Knowledge rerank degraded to vector order { reason: 'NOT_CONFIGURED', candidateCount: 20 }`.

**Affected paths**: the capability binding section of the mobile AI configuration screen, the `应用默认配置（N 项）` bulk default action, and every flow that derives "missing capabilities" from that list.

**Root cause**: the capability roster in `SettingsScreen.tsx` is a hardcoded array that never contained `knowledge_rerank` (`HEAD` and the working tree agree), even though `capabilityLabel` already carried its label. The Server fully supports the capability: `AiCapabilitySchema`, `AI_CAPABILITY_DEFAULTS.knowledge_rerank` (fixed `qwen3.7-text-rerank`), `CAPABILITY_MODEL_REQUIREMENTS`, and `POST /api/settings/capabilities/knowledge_rerank` are all in place. The missing entry has two consequences: the binding editor is unreachable, and `missingCapabilities` never contains reranking, so the bulk default action never fills it. Reranking therefore had to come from the migration endpoint's `ensureKnowledgeRerankBinding` or the one-shot SQL migration `045`, and both require an existing `knowledge_embedding` binding on a dashscope connection at the moment they run.

**Resolution**: `{ id: 'knowledge_rerank' }` is back in the capability roster, positioned to match `AiCapabilitySchema` order (directly after knowledge embedding).

**Verification**: `SettingsScreen.test.tsx` under `apps/mobile` updates the bulk-default counts (7→8, 6→7, and "已应用 5 项"→6) and adds an assertion that the bulk action calls `saveCapability('knowledge_rerank', { model: 'qwen3.7-text-rerank' })`. Root `pnpm check` passes.

**Boundaries**: the reranking model stays fixed and its model field stays a static value. This fix only makes the capability visible and bindable; it neither changes the reranking protocol nor replaces the migration endpoint's automatic top-up for existing tenants.

## EW-007: saving a capability binding fails with a unique-constraint 500

**Symptom**: saving a capability binding (the app's save action, the bulk default action, or `PUT /api/settings/capabilities/:capability`) returns 500 and the server logs:

```text
Unhandled API error error: duplicate key value violates unique constraint "ai_capability_bindings_tenant_id_capability_key"
Key (tenant_id, capability)=(00000000-0000-4000-8000-000000000001, knowledge_rerank) already exists.
  at async SettingsRepository.saveBinding (apps/api/src/settings/repository.ts)
  at async apps/api/src/http/routes/settings.ts:112
```

The same capability keeps reporting `重排已开启，但百炼业务空间或重排模型尚未配置。` and the query log prints `Knowledge rerank degraded to vector order { reason: 'NOT_CONFIGURED', candidateCount: 20 }`. The observed row had `current_revision_id` NULL with `revision_count = 1`: the binding had no published revision but already carried one unpublished revision.

**Affected paths**: `PUT /api/settings/capabilities/:capability`, the capability binding saves and bulk default action in the AI configuration screen, and any flow that republishes an existing capability binding.

**Root cause**: `SettingsRepository.saveBinding` decided whether a capability was already bound with an inner join (`JOIN ... ON revision.id = binding.current_revision_id`). When a binding row's `current_revision_id` is NULL — a shell row left behind by an interrupted write — that query returns no rows, so the code took the "create binding" branch, collided with `UNIQUE (tenant_id, capability)`, rolled back, and raised a 500. Reusing the row is not enough on its own either: numbering the new revision from 1 because no revision is published collides with `(tenant_id, binding_id, revision_no)`, because a stray revision on a shell row does not disappear when the pointer is NULL. Both collisions made such a row impossible to repair through the app or the API. The same data is filtered out by the inner joins in `resolveCapability` and `listBindings`, which is why the capability reported as unconfigured.

**Resolution**: `saveBinding` now looks the row up with a `LEFT JOIN` and treats "row exists without a published revision" as a repairable state: it reuses that row's id and numbers the new revision as `max(revision_no) + 1` over the revisions that binding actually has, inserting a binding row only when none exists. Optimistic locking is unchanged: the published revision is compared first, and a write carrying `expectedRevision` is rejected while no revision is published.

**Verification**: `apps/api` `test/settings/repository.test.mjs` gains three cases: an unpublished row carrying a stray revision is repaired — reusing the row, not inserting a duplicate binding row, and numbering the new revision 2 rather than 1, with the lookup asserted to use `LEFT JOIN` — a published binding receives the next revision while a stale `expectedRevision` throws `CONFLICT` and rolls back, and a never-bound capability still inserts the binding row. Root `pnpm check` passes.

**Boundaries**: `resolveCapability` and `listBindings` still treat "no published revision" as unusable, which is the correct semantics — without a revision there is no provider or model — so such a capability shows as unconfigured until it is repaired. The migration endpoint's `ensureKnowledgeRerankBinding` only creates a binding when the row is entirely absent and does not repair shell rows; this fix makes the app and API save paths responsible for the repair.

## Reporting a new defect

Record the exact command, working directory, verbatim error, and observed versus expected behavior. Mark the status as fixed only after a verification command has actually passed; otherwise keep it open and state the blocker. Keep both language versions of this file in the same change.
