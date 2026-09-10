# Android Device Regression

**English** | [简体中文](./mobile-e2e.zh-CN.md)

EchoWave uses Codex + Maestro for repeatable regression on one ADB-connected Android device over USB or wireless debugging. The stable suite covers locally controlled UI and CRUD. Real and Showcase suites explicitly call the configured ASR, post-analysis, business-analysis, object-storage, and knowledge models and may incur real charges.

Device E2E is outside `pnpm check`. Missing hardware, Platform Tools, Maestro, or provider credentials does not block ordinary development verification.

## One-time setup

1. Install Node.js 24, pnpm 11.3, Java 17+, Android Platform Tools, and the native Windows Maestro CLI. The runner reports missing tools but never installs or changes them.
2. Enable USB or wireless debugging, authorize, unlock, and connect exactly one device reported as `device` by `adb devices`.
3. Build and install the dedicated Development Build from `apps/mobile`:

   ```powershell
   Set-Location apps/mobile
   pnpm dlx eas-cli@latest build --platform android --profile e2e
   ```

   The `e2e` profile preserves `com.echowave.app`, the EAS project, and Firebase identity while forcing runtime Server selection.

4. Configure `apps/api/.env`. Stable tests require current `hybrid` mode but do not modify providers, credentials, bindings, or mode. Real tests additionally require PostgreSQL, DashScope, OSS, DeepSeek, FFmpeg, and VAD.
5. Keep `apps/api/.data/audio/74f0d9e3-1adc-4d35-8737-215558532046.mp3`.

## Commands

Run from the repository root:

```powershell
pnpm e2e:android:preflight
pnpm e2e:android
pnpm e2e:android:real
pnpm e2e:android:showcase
pnpm e2e:android:full
```

- `preflight` checks tools, the unique device, installed App, fixtures, API, and Metro. API/Metro absence is a warning because the suite starts them when needed.
- `e2e:android` runs stable tests without the complete model pipeline.
- `e2e:android:real` is the explicit external-call path and allows up to 20 minutes for one full audio chain.
- `e2e:android:showcase` records public-facing onboarding, workspace analysis, RAG, reliability, and lifecycle stories and also incurs provider cost.
- `e2e:android:full` runs `pnpm check`, then stable and real suites.

Resume a new run from the narrowest Flow with `pnpm e2e:android -- --from 02-resource-crud`. `--from` takes the filename without `.yaml`; it still creates a new RUN_ID, migrates, seeds idempotently, prepares services/device, and executes common setup. It never reuses uncleared resources from an old run.

The runner reads API `PORT`, uses `adb reverse` for API and 8081, and copies exact audio/Markdown fixtures into Downloads. Healthy API/Metro instances are reused; otherwise hidden child process trees are started and only those trees are stopped on failure, success, or Ctrl+C. In reverse mode, the device uses `127.0.0.1:<port>`, not a LAN Metro address.

## Flow stability

Every top-level Flow runs `.maestro/subflows/prepare-e2e-app.yaml`, loads the Development Build, connects only when the connection page is visible, waits for onboarding restoration, skips basic onboarding on first run, and returns to Groups. Dedicated onboarding flows replay guides explicitly.

Use Maestro `id` only for React Native `testID`; use text for unique stable accessibility labels and dedicated IDs for tabs, repeated actions, icons, and dynamic rows. Dismiss the keyboard before testing/searching/saving after final input. Wait on visible state and use `scrollUntilVisible`; never hide timing failures with fixed sleeps.

## Coverage and data

Stable flows under `.maestro/flows/stable` cover connection, five primary areas, status pages, group/knowledge/data-source CRUD and links, audio selection/playback/menu actions, seeded analysis detail, invalid Server, lifecycle, and explicit in-progress placeholders.

Real flows under `.maestro/flows/real` cover upload, ASR, speaker/timestamps, emotion/role, business analysis, report publication, knowledge ingestion/embedding, grounded answer, and openable citation. Push validates disabled or registered state but sends no real notification.

Showcase flows organize the same capabilities into five public stories and capture named states. Every run uses an ASCII ID such as `E2E_20260906T010203Z_A1B2C3`. Successful cleanup touches only exact IDs and names recorded in `context.json`; failure preserves evidence. `seed:dev` restoring fixed demo records is a known shared-backend effect. The product analyzes uploaded audio files and has no microphone-recording feature, so the suite does not invent microphone permission tests.

## Showcase video

Generate a 150-second, 1920×1080, 30fps bilingual review video from a Showcase or stable run:

```powershell
pnpm showcase:video -- --run E2E_20260906T010203Z_A1B2C3 --prepare-tools
```

Output under `.artifacts/showcase-video/<run-id>/` includes the main and clean videos, Chinese neural narration, music/effects, ASS subtitles, script, thumbnail, manifest, and QA report. Restricted Windows environments may render an existing plan with `scripts/showcase/render-video-from-plan.ps1`. Mask overlays are for known floating debug controls only; disable overlays in the actual Showcase preview.

## Evidence, triage, and repair gate

`.artifacts/maestro/<runId>/` stores context, health, JUnit, HTML summary, screenshots, video, command JSON, Maestro/API/Metro logs, and run-window logcat. Reused services cannot provide earlier logs and say so explicitly.

A failed Flow automatically runs a temporary read-only `codex exec`, producing `triage.json` and `triage.md` classified as application, Flow, backend, provider, device, or environment. It cannot edit source, weaken assertions, or skip failure.

```powershell
pnpm e2e:android:triage -- --run E2E_20260906T010203Z_A1B2C3
pnpm e2e:android:repair -- --run E2E_20260906T010203Z_A1B2C3 --confirm E2E_20260906T010203Z_A1B2C3
```

Repair requires two exact matching valid run IDs and existing triage. It preserves a dirty tree, fixes only the confirmed root cause, reruns the failed Flow/group, and follows repository format/diff/check rules for source changes.

## Device acceptance

For a new device or Android version:

- Run preflight and one stable Flow, then adjust only device-specific DocumentsUI access if needed.
- Pass the stable suite twice without relying on first-run business data.
- Pass the real suite once.
- Intentionally test a bad Server and assertion to verify complete evidence, accurate read-only classification, and no source edits.
- Verify the exact-ID repair gate on a dedicated test defect.

Official references: [Maestro installation](https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli), [React Native](https://docs.maestro.dev/platform-support/react-native), [`addMedia`](https://docs.maestro.dev/reference/commands-available/addmedia), [debug artifacts](https://docs.maestro.dev/troubleshooting/debug-output), and [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).
