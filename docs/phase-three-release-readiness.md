# Phase 3: release readiness

Status: local implementation complete; staging, physical-device and therapist
sign-off pending. This is not a release approval. No deployment or migration was
performed. Exercise thresholds, repetition rules and star rules are unchanged.

## Changes

- Fixed a WebKit keyboard defect in the shared dialog. Tab previously skipped
  the exercise link and escaped to browser chrome. Forward and reverse focus now
  move through visible, enabled controls explicitly; Escape restores the opener.
- The patient suite supports Chromium, WebKit and Firefox. Each engine checks six
  patient routes at 320, 390, 768 and 1440 pixels, 48px controls, axe WCAG A/AA
  rules, dialog focus, profile recovery, populated charts and preparation.
  Camera-capable builds additionally check preview, session
  pause/reconnection/completion and tracker failures.
- Added browser regressions for failed completion and failed star awards. Both
  keep the pending result across reload, retry stable repetition IDs, and clear
  recovery storage only after success. A failed completion must not award stars.
- Added a command that starts its own production server, runs all three engines,
  records results, and shuts the server down. An occupied port fails the run.
- Added a real Supabase contract verifier with explicit staging configuration,
  two non-admin test accounts and no privileged key.

## Automated evidence

Verified on 2026-09-06 (Asia/Bangkok), based on `cc6f583` plus this branch's
release-readiness changes. The report records the base revision and working tree;
the accompanying commit contains the tested dialog and browser suite.

| Check | Result |
| --- | --- |
| `npm test` | 209 tests passed |
| `npm run build` | Passed, including TypeScript compilation |
| `npm run typecheck` | Passed after the dialog fix |
| `npm run lint` | 0 errors / 43 existing warnings |
| `npm run test:release` | Passed all supported checks in Chromium, WebKit and Firefox; Windows WebKit camera lifecycle explicitly unsupported |
| `npm run test:staging -- --check-config` | Correctly refused missing configuration; no requests sent |
| Live staging database | Pending approved project and two test-account credentials |
| Physical phones / assistive technology | Pending manual checks below |
| Therapist review | Pending per-exercise sign-off below |

Run from the repository root:

```sh
npm ci
npx playwright install chromium webkit firefox
npm test
npm run build
npm run typecheck
npm run lint
npm run test:release
```

The existing public Supabase variables must be available for the app build and
fixture cookie configuration. Browser database and account requests are
intercepted. There are no real patient writes, emails or uploads in this suite.
Chromium uses its fake camera; Firefox uses a generated canvas stream. WebKit
also uses a canvas stream when its installed build exposes the media APIs.
On this Windows machine, WebKit exposes neither `MediaStream` nor
`getUserMedia`; its camera lifecycle and tracker-start checks are explicitly
reported as unsupported. It still checks preparation, unavailable-camera and
simulated permission-denial handling, along with navigation and save recovery.
The pose worker is simulated for exercise flows. These checks do not establish
physical camera compatibility, tracking accuracy or screen-reader usability.

`E2E_PORT` changes the release runner's port (default 3101). For a single engine
against an already-running server, set `E2E_BROWSER` to `chromium`, `webkit` or
`firefox`, set `E2E_BASE_URL`, and run `npm run test:e2e`.

Evidence is ignored by Git:

- `test-results/release-browser-report.json`: run time, source commit, modified
  tracked files, each browser's exit status and explicit coverage limitations.
  A successful exit means the supported checks passed; inspect camera coverage
  before using the report as release evidence. A dirty working tree is recorded;
  the source commit alone does not identify uncommitted changes.
- `test-results/<browser>/*.png`: screenshots of routes and session states.
- `test-results/phase-three-eslint.json`: lint findings from this verification.

Playwright's WebKit is a separate test build, not the installed Safari browser;
physical iPhone Safari remains a separate check. See [Playwright's browser
documentation](https://playwright.dev/docs/browsers#webkit). The keyboard review
used the [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md).

## Staging database verification

1. Select an approved staging project and compare its deployed migrations with
   `supabase/README.md`. This verifier does not apply migrations.
2. Provision two dedicated, confirmed, non-admin patients and one exercise.
   Keep both accounts idle during verification so star totals are deterministic.
3. Copy `.env.staging.example` to ignored `.env.staging.local` and fill in its
   values locally. `STAGING_EXPECTED_HOST` must match the selected project's host.
   The script never falls back to the app's `.env.local`. An alternative file
   can be selected with `STAGING_ENV_FILE`.
4. Run `npm run test:staging -- --check-config` to validate without networking,
   then `npm run test:staging` to run the real contract check.
5. Review `test-results/staging-report.json`. Success creates one labelled test
   session, exactly two repetition rows and one additional star. Test data stays
   in the dedicated account as evidence. A failed run can also leave partial
   data; its report records the session ID as soon as creation succeeds. Each
   new invocation creates another test session. No patient data is deleted.

The verifier checks account isolation, the allowed session-start insert,
repetition retry after an offline request and after a response lost following a
committed write, immutable completion, concurrent/repeated single-star awards,
and denial of direct star/ledger updates. It exercises the real database API
contract, not the browser's recovery UI. Complete the following browser check
against the same staging deployment to verify those parts together.

### Real browser save and retry

- Record the app revision, exercise ID, initial star count and device/browser.
- Start an exercise with the physical camera and count the completed repetitions.
- Disconnect network access before completion. Finish the session and check that
  results remain pending without a synced-star success message.
- Reconnect, reload the page, and use Retry saving. Confirm that recovery clears
  and Progress shows the completed session.
- Inspect the dedicated account in Supabase: one session, one row per completed
  repetition, unique repetition IDs, completed fields, `stars_awarded = true`,
  and a star total exactly one above the baseline. Refresh and retry an ambiguous
  response again; the counts must stay unchanged.
- Sign in as the second test patient: the first patient's pending recovery and
  session history must not appear.

## Physical-device and accessibility record

Use the staging app over HTTPS. A phone visiting a desktop's plain HTTP LAN URL
is not equivalent to localhost and is unsuitable for this camera check.
For each device, record model, OS version, browser version, app revision, date,
tester, outcome and issue/evidence link. All rows below are currently **pending**.

| Device / mode | Required checks |
| --- | --- |
| iPhone / Safari | Camera consent/denial/retry, correct front preview, portrait/landscape, browser toolbar and safe-area clearance |
| Android / Chrome | Same camera/layout checks, including a supported lower-performance device |
| Both phones | Leave the app or lock the screen mid-hold and mid-countdown; returning must remain paused, keep completed reps and exclude the interruption from active time |
| Both phones | Interrupt/reconnect the camera, resume, complete, exit, and verify the OS camera indicator switches off after completion/exit |
| Both phones | Perform the staging offline/reload/retry sequence above; check slow-network and tracker-start failure guidance |
| iPhone / VoiceOver | Navigate Garden, Exercises, Progress, Profile and a session; verify names, headings, selected navigation, cues and save errors are understandable without sight |
| Android / TalkBack | Repeat the same flow; verify controls can be reached and activated, modal background is unavailable, and focus returns after closing |
| Keyboard and enlarged text | Reach all dialog controls in both directions; retain visible focus; check 200% text/zoom and long exercise names without clipping essential controls |
| Reduced motion | Enable OS reduced motion, verify navigation/results remain understandable, and review exercise demonstration motion with the therapist |

For voice output, record whether changing movement cues or repetitions interrupt
the screen reader or become too repetitive. Automated axe results do not answer
this usability question. Mark issues with a reproducible trigger and expected
behavior; fix and repeat the affected checks before marking the row passed.

## Therapist review packet

Use `supabase/scripts/release-exercise-review.sql` in the approved staging SQL
editor to export the configured exercise definitions. It reads exercise content
only. Review the corresponding preparation, demonstration, live guidance,
results and unlock behavior in the app. No clinical approval has been inferred.

Create one record per exercise:

| Field | Reviewer entry |
| --- | --- |
| Exercise ID / name / configuration date | Pending |
| Reviewer / role / review date / app revision | Pending |
| Intended patients and positioning instructions | Pending |
| Body or hand tracking; demonstration and visibility limits | Pending |
| Target reps, hold duration, rest/target angles and angle ranges | Pending |
| Observed repetition counting compared with manual counting | Pending |
| Feedback wording, including uncertain/lost tracking | Pending |
| Target-pose-time threshold and duration cap for unlocking | Pending |
| Required changes and retest evidence | Pending |
| Decision: approved / changes required / excluded from release | Pending |

Implementation facts to explain to the reviewer:

- Session `form_quality_score` is labelled target-pose time: the rounded fraction
  of analysed active time in the target state. It is not clinical form accuracy.
- Per-repetition `form_score` is separate from that session metric.
- A dynamic exercise with a configured numeric rest angle uses full-cycle
  counting. Its hold duration is guidance, not required for counting. Other
  configurations use hold counting (`isCyclicExercise` / `createRepCounter` in
  `lib/poseDetection.ts`).
- Unlocks use the configured minimum target-pose-time score and optional active
  duration cap. Review whether those measures make sense for each exercise,
  especially movement cycles (`lib/levels.ts`). No thresholds were changed here.

## Exit criteria

Phase 3 is complete only when the automated checks pass for the release revision,
the staging contract and real-camera save/retry pass, the physical-device and
assistive-technology records are filled in, therapist decisions are recorded, and
any blocking findings are fixed and retested. Merge and deployment are separate
actions. Preserve this evidence with the candidate revision before release.
