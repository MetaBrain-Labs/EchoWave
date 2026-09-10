# Android E2E Troubleshooting Record

**English** | [简体中文](./mobile-e2e-troubleshooting.zh-CN.md)

This document records conclusions and current constraints from EchoWave regression on Windows, a physical Android device, and the development backend. It complements the full [Android Device Regression guide](./mobile-e2e.md).

## Key conclusions

- `Seeded EchoWave audio workspace development data.` means seed succeeded. Inspect `.artifacts/maestro/<runId>/summary.json`, Flow `commands.json`, screenshots, and hierarchy for the actual later failure.
- The runner uses `adb reverse`; the device reaches Metro/API through `127.0.0.1:<port>`, not a manually entered LAN Metro address.
- API port comes from `apps/api/.env` `PORT` and has been `3201` in runs; never assume `3001`.
- `--from` creates a new run but not resources from skipped flows. A Flow referencing `${SOURCE_NAME}` or `${GROUP_NAME}` must create it itself or use seed data.
- Failure, success, and Ctrl+C clean only API, Metro, and log process trees started by the run. Current cleanup releases 3201/8081 without killing unrelated port owners.

## Failure classification

| Stage        | Symptom                                        | Root cause                                                                      | Resolution                                                                             |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Preflight    | No unique authorized device                    | ADB has none or wireless debugging is not connected/authorized                  | Connect and keep exactly one `device` entry                                            |
| Preflight    | Two wireless endpoints for one phone           | ADB registered the same device twice                                            | Disconnect the extra endpoint; the runner never guesses                                |
| Preflight    | API/Metro `WARN: not running`                  | Informational preflight state                                                   | Suite starts them as needed                                                            |
| Migration    | `relation "tenants" already exists` / `42P07`  | Migration state and actual schema diverged around non-idempotent table creation | Repair migration state; it is not a Maestro failure                                    |
| Seed         | Missing `transcript_segment_id` / `42703`      | Seed/schema drift                                                               | Correct migration order or field before rerunning seed                                 |
| After seed   | Seed success followed by E2E failure           | UI Flow failed later                                                            | Inspect exact Flow artifact step                                                       |
| Flow 01      | `unexpected end of stream` at `127.0.0.1:8081` | Metro not ready, wrong transport address, or stale process                      | Use reverse localhost and wait for readiness                                           |
| Connection   | Test button does not advance                   | Address/port/wait condition differs from page state                             | Use actual `.env` port and operate only when connection page is visible                |
| UI Flow      | Element not found                              | Scroll, keyboard, system dialog, or async page shifted UI                       | Use stable IDs, visible waits, and `scrollUntilVisible`; no fixed sleeps               |
| Search sheet | Keyboard covers input/action                   | Android transparent modal lacked avoidance                                      | Use native `KeyboardAvoidingView` padding and preserve screenshot coverage             |
| DocumentsUI  | No expected confirm button                     | Providers label it Confirm, OK, or Open                                         | Shared picker flow accepts supported labels; audio enters Downloads through `adb push` |
| Flow 05      | Dynamic source not found after `--from 05`     | Flow 02 that created it was skipped                                             | Use independent seeded source/group after scrolling                                    |
| Cleanup      | 3201/8081 remains occupied                     | Wrapper exited before recursive child cleanup                                   | Clean the owned process tree on every terminal signal                                  |
| Triage rerun | `spawnSync powershell.exe EPERM`               | Restricted Codex sandbox cannot launch PowerShell                               | Classify as environment; rerun in the user's PowerShell                                |

## Recorded runs

- `E2E_20260906T134817.803Z_227EF3`: duplicate migration table and invalid millisecond run ID.
- `E2E_20260906T135630Z_4A261B`: seed referenced missing `transcript_segment_id`.
- `E2E_20260906T140318Z_6F418B`: migration/seed succeeded; later Flow failed.
- `E2E_20260906T172514Z_38BDB1`: Flow 01 Metro/connection issue with `triage.md`.
- `E2E_20260907T124718Z_A6C9B4`: Flow 05 missing dynamic source; ports released after failure.

Evidence paths:

```text
.artifacts/maestro/<runId>/summary.json
.artifacts/maestro/<runId>/context.json
.artifacts/maestro/<runId>/flows/<flow>/.../commands.json
.artifacts/maestro/<runId>/flows/<flow>/.../screenshots/
.artifacts/maestro/<runId>/flows/<flow>/.../screen-hierarchy/
.artifacts/maestro/<runId>/triage.md
.artifacts/maestro/<runId>/api.log
.artifacts/maestro/<runId>/metro.log
```

## Troubleshooting sequence

1. Run `pnpm e2e:android:preflight` and verify Java, Maestro, ADB, Development Build, and one authorized device.
2. Start a new run from the narrowest file, for example `pnpm e2e:android -- --from 05-onboarding-validation`.
3. After a seed-success message, inspect `summary.json`, Flow `commands.json`, screenshot, and hierarchy for the failing step.
4. Read API `PORT` from `apps/api/.env`; Metro is 8081. Do not enter a LAN Metro address in reverse mode.
5. Re-run read-only analysis with `pnpm e2e:android:triage -- --run <runId>`.
6. Only after reviewing `triage.md`, authorize repair with exact matching IDs: `pnpm e2e:android:repair -- --run <runId> --confirm <runId>`.

## Verified state

- `pnpm e2e:android:test`: 19/19 orchestration tests passed at the recorded checkpoint.
- `git diff --check`: passed.
- `pnpm check`: passed for the process-cleanup batch; the Flow 05 change was YAML/static-test only.
- Final physical-device Flow 05 rerun was blocked in the restricted Codex sandbox by `spawnSync powershell.exe EPERM` and requires the user's PowerShell.

## Remaining boundaries

Real suites call configured ASR, OSS, DeepSeek, and post-analysis services and may incur charges. `seed:dev` restores fixed demo data on a shared development backend. Failed runs preserve evidence; successful cleanup touches only exact context records. The product analyzes uploaded files and has no microphone-recording capability, so no microphone permission test is claimed.
