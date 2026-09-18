# EchoWave Bug Fix Record

**English** | [简体中文](./bug-fixes.zh-CN.md)

This document records verified defects with their reproduction, root cause, resolution, and verification evidence. It complements topic guides and the [Android E2E troubleshooting record](./mobile-e2e-troubleshooting.md): topic guides describe intended behavior, while this file describes failures that already happened and how they were closed.

## Fixed defects

| ID       | Symptom                                                                                           | Scope                          | Status |
| -------- | ------------------------------------------------------------------------------------------------- | ------------------------------ | ------ |
| `EW-001` | Web dev server fails with `Unable to resolve module ./apps/mobile/node_modules/expo-router/entry` | Windows + pnpm workspace links | Fixed  |
| `EW-002` | Trusted answer cites `[9]` while the returned citation list ends at `[8]`                         | Knowledge answer rendering     | Fixed  |
| `EW-003` | Query screen and history panel log `Text strings must be rendered within a <Text> component`      | Knowledge answer rendering     | Fixed  |

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

## Reporting a new defect

Record the exact command, working directory, verbatim error, and observed versus expected behavior. Mark the status as fixed only after a verification command has actually passed; otherwise keep it open and state the blocker. Keep both language versions of this file in the same change.
