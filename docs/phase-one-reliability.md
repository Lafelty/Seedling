# Phase 1: reliability and truthful progress

This change implements the approved first phase only. It does not redesign the
app, change therapist thresholds, deploy a release, or add planting integrations.

## Behavior changes

- Exercise starts only after camera/tracking initialization and a confirmed
  session record. Camera failures give recovery guidance. Disconnecting the
  camera pauses the session; reconnecting retains completed repetitions.
- Session duration counts active time, excluding countdowns and pauses.
  Interrupted holds/movement cycles do not inherit time spent paused.
- Results save in order: repetition rows, session completion, then star award.
  Success is shown only after the required writes succeed. Retries reuse rep
  UUIDs and the existing idempotent completion/star RPCs.
- A failed save retains a per-account recovery snapshot on the device. The
  garden links back to a Retry screen. Snapshots contain session measurements,
  not camera frames or authentication data. Successful saving removes them.
  Clearing browser storage removes pending snapshots; when storage is blocked,
  the patient is told to keep the results page open.
- Failed progress reads preserve the local cache and show Retry. Completion
  dates are paginated; late month responses cannot overwrite the selected month.
- The existing session percentage is labeled **target-pose time**, not clinical
  form accuracy. Per-repetition movement matching remains a separate measure.
  Locked-pose descriptions now use the preceding exercise's actual thresholds.
- The four-star real-tree milestone no longer claims planting is confirmed.
- The missing spacing token and narrow progress-card overflow are fixed.
- Next.js/related dependencies are patched; unused TensorFlow dependencies are
  removed. ESLint now uses the supported flat configuration.

## Verification

- `npm test`: 209 tests passing, including new save-failure, retry, account
  isolation, active-time, interrupted-hold, cache, pagination and unlock tests.
- Production build and TypeScript checks pass.
- ESLint has no errors. Existing compiler-readiness checks remain visible as
  warnings; they are not represented as a completed component refactor.
- `npm audit`: zero reported vulnerabilities at verification time.
- Chromium checks with intercepted APIs and simulated camera/pose input cover
  save failure/reload/retry, recovery links, cached stars on read failure,
  unavailable level history, denied camera access, failed tracker startup,
  pause/resume, camera reconnection and camera shutdown after completion.
- Recovery/progress layouts checked at 320px and progress at 1440px.

## Before release

No database migration is required. The existing `complete_session` and
`award_stars` RPCs and repetition-ID insert grant must already be deployed, as
documented in `supabase/migrations/20260725000000_session_write_lockdown.sql`.

Browser tests use mocked database responses: they do not verify live Supabase
permissions, deliver guardian emails, or validate medical accuracy. Run a
staging session with real camera hardware and the deployed database, including
an offline-save retry. Have a therapist review the unchanged target-pose-time
thresholds for cyclic exercises before treating them as clinically meaningful.
